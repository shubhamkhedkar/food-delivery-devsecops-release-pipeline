#!/usr/bin/env bash
# Boots the pipeline's Jenkins controller image (ci/jenkins) on 127.0.0.1 with throwaway
# placeholder credentials, then proves:
#   1. configuration-as-code loads cleanly (security realm, matrix auth, CSRF, agent label,
#      NodeJS / SonarScanner / Dependency-Check tools, SonarQube server, 4 credential IDs)
#   2. Jenkins' own declarative linter accepts the Jenkinsfile
# The container is removed afterwards; nothing is built, published or deployed.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER="${DOCKER:-docker}"
IMAGE="${JENKINS_IMAGE:-platewise-jenkins:local}"
PORT="${LINT_PORT:-18090}"
NAME="platewise-jenkins-lint-$$"
URL="http://127.0.0.1:$PORT"
WORK="$(mktemp -d)"
trap '$DOCKER rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
pass() { echo "ok  - $*"; }
fail() { echo "FAIL: $*" >&2; $DOCKER logs "$NAME" 2>&1 | grep -E "SEVERE|Exception|ConfiguratorException" | head -20 >&2 || true; exit 1; }
rand() { head -c 24 /dev/urandom | base64 | tr -d '/+=\n'; }

$DOCKER build -q -t "$IMAGE" "$ROOT/ci/jenkins" >/dev/null
pass "built $IMAGE (pinned Jenkins LTS + $(grep -c . "$ROOT/ci/jenkins/plugins.txt") plugins)"

ADMIN_PASSWORD="$(rand)"
{
  echo "JENKINS_ADMIN_PASSWORD=$ADMIN_PASSWORD"
  echo "RELEASE_APPROVER_PASSWORD=$(rand)"
  echo "JENKINS_URL=$URL/"
  echo "JENKINS_ADMIN_EMAIL=ci@platewise.invalid"
  echo "SONAR_HOST_URL=http://sonarqube.invalid:9000"
  echo "SONAR_TOKEN=$(rand)"
  echo "NVD_API_KEY=$(rand)"
  echo "GITHUB_PUSH_USER=platewise-ci"
  echo "GITHUB_PUSH_TOKEN=$(rand)"
} >"$WORK/env"
chmod 600 "$WORK/env"
printf 'apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n' >"$WORK/kubeconfig"
chmod 644 "$WORK/kubeconfig"
$DOCKER run -d --name "$NAME" -p "127.0.0.1:$PORT:8080" --env-file "$WORK/env" \
  -v "$WORK/kubeconfig:/run/secrets/kubeconfig:ro" "$IMAGE" >/dev/null
for _ in $(seq 1 150); do
  curl -fsS -o /dev/null "$URL/login" 2>/dev/null && break
  $DOCKER inspect -f '{{.State.Running}}' "$NAME" | grep -q true || fail "jenkins exited"
  sleep 2
done
curl -fsS -o /dev/null "$URL/login" || fail "jenkins did not start"
if $DOCKER logs "$NAME" 2>&1 | grep -qE "ConfiguratorException|io.jenkins.plugins.casc.*(SEVERE|Exception)"; then fail "JCasC errors"; fi
pass "Jenkins $(curl -fsSI "$URL/login" | awk -F': ' 'tolower($1)=="x-jenkins"{print $2}' | tr -d '\r') booted; configuration-as-code applied without errors"

printf 'machine 127.0.0.1 login admin password %s\n' "$ADMIN_PASSWORD" >"$WORK/netrc"
chmod 600 "$WORK/netrc"
api() { curl -gfsS --netrc-file "$WORK/netrc" -b "$WORK/jar" -c "$WORK/jar" "$@"; }
code=$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/json")
[[ "$code" == "403" ]] || fail "anonymous access returned $code"
api "$URL/whoAmI/api/json" | jq -e '.authenticated == true and .name == "admin"' >/dev/null || fail "admin login"
api "$URL/api/json?tree=useCrumbs,numExecutors" | jq -e '.useCrumbs == true and .numExecutors == 0' >/dev/null || fail "CSRF / executors"
labels=$(api "$URL/computer/docker-agent-1/api/json?tree=assignedLabels[name]" | jq -r '[.assignedLabels[].name] | join(",")')
[[ "$labels" == *docker* ]] || fail "agent label: $labels"
pass "anonymous denied (403), admin authenticates, CSRF on, 0 controller executors, agent label 'docker'"

crumb="$(api "$URL/crumbIssuer/api/xml?xpath=concat(//crumbRequestField,\":\",//crumb)")"
cat >"$WORK/assert.groovy" <<'GROOVY'
import jenkins.model.Jenkins
def j = Jenkins.get()
def out = []
out << "nodejs=" + j.getDescriptorByType(jenkins.plugins.nodejs.tools.NodeJSInstallation.DescriptorImpl).installations*.name.join(",")
out << "scanner=" + j.getDescriptorByType(hudson.plugins.sonar.SonarRunnerInstallation.DescriptorImpl).installations*.name.join(",")
out << "odc=" + j.getDescriptorByType(org.jenkinsci.plugins.DependencyCheck.tools.DependencyCheckInstallation.DescriptorImpl).installations*.name.join(",")
out << "sonar=" + hudson.plugins.sonar.SonarGlobalConfiguration.get().installations*.name.join(",")
out << "creds=" + com.cloudbees.plugins.credentials.CredentialsProvider.lookupCredentialsInItemGroup(
  com.cloudbees.plugins.credentials.common.StandardCredentials, j, null, []).collect { it.id }.sort().join(",")
println out.join("\n")
GROOVY
facts="$(api -X POST -H "$crumb" --data-urlencode "script@$WORK/assert.groovy" "$URL/scriptText")"
for want in "nodejs=node24" "scanner=sonar-scanner" "odc=dependency-check" "sonar=sonarqube" \
  "creds=github-push,nvd-api-key,platewise-kubeconfig,sonar-token"; do
  grep -qxF "$want" <<<"$facts" || fail "JCasC assertion '$want' not met; got: $facts"
done
pass "tools node24 / sonar-scanner / dependency-check, SonarQube server and 4 credential IDs configured"

result="$(api -X POST -H "$crumb" -F "jenkinsfile=<$ROOT/Jenkinsfile" "$URL/pipeline-model-converter/validate")"
[[ "$result" == *"Jenkinsfile successfully validated."* ]] || fail "linter: $result"
pass "Jenkinsfile validated by the declarative linter"
echo "jenkins lint passed"
