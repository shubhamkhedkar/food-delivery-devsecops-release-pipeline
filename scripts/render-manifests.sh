#!/usr/bin/env bash
# Render the kind and production overlays into rendered/ and validate them with kubeconform
# in strict mode. CRD schemas (ServiceMonitor, PrometheusRule) come from the community catalog.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
K8S_VERSION="${K8S_VERSION:-1.34.0}"
CRDS='https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'
OUT="$ROOT/rendered"
mkdir -p "$OUT"
for overlay in kind production; do
  kustomize build "$ROOT/deploy/k8s/overlays/$overlay" >"$OUT/$overlay.yaml"
done
kubeconform -strict -summary -kubernetes-version "$K8S_VERSION" \
  -schema-location default -schema-location "$CRDS" \
  "$OUT/kind.yaml" "$OUT/production.yaml"
