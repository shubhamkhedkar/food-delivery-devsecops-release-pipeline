#!/usr/bin/env bash
# Called by the Jenkins "Release manifest" stage after the image is pushed: pins the
# production overlay to the new image by tag AND digest and commits it on the release branch.
# Rolling it out (kubectl apply -k, or a GitOps controller watching the branch) is a separate,
# manually approved step.
# Usage: release-bump.sh <image> <tag> <sha256:digest>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${1:?image}"
TAG="${2:?tag}"
DIGEST="${3:?digest}"
OVERLAY="$ROOT/deploy/k8s/overlays/production"
BRANCH="${RELEASE_BRANCH:-main}"

[[ "$DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo "invalid digest: $DIGEST" >&2; exit 1; }
[[ "$TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || { echo "invalid tag: $TAG" >&2; exit 1; }
[[ "$IMAGE" =~ ^[a-z0-9.-]+(:[0-9]+)?(/[a-z0-9._-]+)+$ ]] || { echo "invalid image: $IMAGE" >&2; exit 1; }

cd "$OVERLAY"
kustomize edit set image "platewise=$IMAGE:$TAG@$DIGEST"
cd "$ROOT"
if git diff --quiet -- "$OVERLAY"; then
  echo "overlay already at $TAG"
  exit 0
fi
git -c user.name="platewise-ci" -c user.email="ci@platewise.invalid" \
  commit -m "release: platewise $TAG [release-bump]" -- "$OVERLAY/kustomization.yaml"
if [[ "${PUSH:-1}" == "1" ]]; then git push origin "HEAD:$BRANCH"; fi
echo "pinned production overlay to $IMAGE:$TAG@$DIGEST"
