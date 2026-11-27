#!/usr/bin/env bash
# Static checks for everything that is not application code. Runs offline except for the
# kubeconform CRD schemas. Used by the Jenkins "Config and policy" stage and by check-all.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
step() { printf '\n==> %s\n' "$1"; }

step "Dockerfile lint (hadolint)"
hadolint Dockerfile ci/jenkins/Dockerfile

step "ShellCheck (scripts + rendered EC2 bootstrap templates)"
shellcheck scripts/*.sh
./scripts/lint-userdata.sh

step "Python lint (ruff)"
ruff check scripts
ruff format --check scripts

step "YAML lint"
yamllint -s .

step "Compose file renders"
ORDER_SIGNING_KEY=placeholder GRAFANA_ADMIN_PASSWORD=placeholder docker compose config -q

step "Kustomize render + kubeconform (strict)"
./scripts/render-manifests.sh

step "Policy as code (conftest/OPA): policy unit tests, then manifests, Dockerfiles, compose"
conftest verify --policy policy
conftest test --namespace kubernetes --policy policy rendered/kind.yaml rendered/production.yaml
conftest test --namespace dockerfile --policy policy Dockerfile ci/jenkins/Dockerfile
conftest test --namespace compose --policy policy compose.yaml

step "Prometheus config, rules, rule unit tests (promtool); PrometheusRule in sync"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp -r monitoring/prometheus/. "$tmp/"
sed -e "s#/etc/prometheus/#$tmp/#g" monitoring/prometheus/prometheus.yml >"$tmp/prometheus.yml"
promtool check config "$tmp/prometheus.yml"
promtool check rules monitoring/prometheus/rules/*.yml
(cd monitoring/prometheus/tests && promtool test rules ./*.test.yml)
python3 scripts/sync-prometheusrule.py --check

step "Grafana dashboards are valid JSON with unique uids"
for f in monitoring/grafana/dashboards/*.json; do jq -e '.uid and .title and (.panels | length > 0)' "$f" >/dev/null; done
[[ "$(jq -r .uid monitoring/grafana/dashboards/*.json | sort | uniq -d | wc -l)" == "0" ]]
echo "$(find monitoring/grafana/dashboards -name '*.json' | wc -l) dashboard(s) OK"

step "Terraform: fmt, init (no backend), validate, TFLint, mocked terraform test"
(
  cd infra/terraform
  terraform fmt -check -recursive
  terraform init -backend=false -input=false >/dev/null
  terraform validate
  tflint --init >/dev/null
  tflint --recursive
  terraform test
)

echo
echo "Config and policy checks passed."
