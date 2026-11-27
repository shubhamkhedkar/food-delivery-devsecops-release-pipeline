#!/usr/bin/env bash
# Every offline quality gate in one go. Nothing here pushes an image, talks to a cloud
# account or a real cluster, or deploys anything. Docker-based rehearsals are separate:
#   make compose-smoke kind-smoke
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
step() { printf '\n==> %s\n' "$1"; }

step "App: npm ci, ESLint, unit tests + coverage gate (Vitest), production build, npm audit"
(
  cd app
  npm ci --ignore-scripts --no-audit --no-fund --silent
  npm run --silent lint
  npm test
  npm run --silent build
  npm audit --audit-level=low
)

./scripts/check-config.sh

step "Checkov (Dockerfiles, rendered Kubernetes manifests, Terraform)"
checkov -f Dockerfile -f ci/jenkins/Dockerfile --framework dockerfile --quiet --compact
checkov -f rendered/production.yaml -f rendered/kind.yaml --framework kubernetes --quiet --compact
checkov -d infra/terraform --framework terraform --quiet --compact --skip-path tests

step "Trivy filesystem scan (vulnerabilities, secrets, misconfigurations)"
trivy fs --quiet --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --exit-code 1 \
  --skip-dirs app/node_modules --skip-dirs rendered --skip-dirs infra/terraform/.terraform .

step "Secret scan (gitleaks: git history + working tree)"
if git rev-parse --git-dir >/dev/null 2>&1 && git rev-parse HEAD >/dev/null 2>&1; then
  gitleaks git --no-banner --redact .
fi
gitleaks dir --no-banner --redact .

echo
echo "All offline checks passed."
