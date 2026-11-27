#!/usr/bin/env bash
# Local-only rehearsal of the production rollout on a throwaway 2-node kind cluster:
# restricted Pod Security, pods that refuse to start without the signing-key Secret,
# HPA-owned replicas, default-deny NetworkPolicies, order ids verified by every replica,
# and a rolling restart under the PDB. Uses its own temporary kubeconfig, so it can never
# touch a real cluster.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLUSTER="${KIND_CLUSTER:-platewise-smoke}"
IMAGE="${IMAGE:-platewise:local}"
CLIENT_IMAGE="${CLIENT_IMAGE:-curlimages/curl:8.23.0}"
KEEP="${KEEP:-0}"
WORK="$(mktemp -d)"
export KUBECONFIG="$WORK/kubeconfig"
NS=platewise
CLIENT_NS=platewise-smoke

cleanup() {
  if [[ "$KEEP" != "1" ]]; then kind delete cluster --name "$CLUSTER" >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
fail() {
  echo "FAIL: $*" >&2
  kubectl -n "$NS" get pods,hpa,netpol -o wide >&2 || true
  kubectl -n "$NS" logs deploy/platewise --tail 20 >&2 || true
  exit 1
}
pass() { echo "ok  - $*"; }

# Restricted-PSS compliant curl Job in $CLIENT_NS; $2 = "true" sets the label the NetworkPolicy admits.
client_job() {
  local name="$1" allowed="$2" script="$3"
  cat <<YAML | kubectl apply -f - >/dev/null
apiVersion: batch/v1
kind: Job
metadata:
  name: ${name}
  namespace: ${CLIENT_NS}
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 150
  template:
    metadata:
      labels:
        platewise.dev/smoke-client: "${allowed}"
    spec:
      restartPolicy: Never
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 100
        seccompProfile: {type: RuntimeDefault}
      containers:
        - name: curl
          image: ${CLIENT_IMAGE}
          imagePullPolicy: Never
          command: $(jq -cn --arg s "$script" '["sh", "-ec", $s]')
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: {drop: ["ALL"]}
YAML
}
wait_job() { # name -> 0 if Complete, 1 if Failed
  local name="$1"
  for _ in $(seq 1 170); do
    [[ "$(kubectl -n "$CLIENT_NS" get job "$name" -o jsonpath='{.status.succeeded}')" == "1" ]] && return 0
    [[ "$(kubectl -n "$CLIENT_NS" get job "$name" -o jsonpath='{.status.failed}')" == "1" ]] && return 1
    sleep 1
  done
  return 1
}
settle() { # wait until only the new ReplicaSet's pods remain (old ones drain for DRAIN_SECONDS)
  local want="$1"
  for _ in $(seq 1 60); do
    [[ "$(kubectl -n "$NS" get pods -l app.kubernetes.io/name=platewise --no-headers 2>/dev/null | wc -l)" == "$want" ]] && return 0
    sleep 2
  done
  fail "old pods did not terminate"
}
run_client() { # name script description
  client_job "$1" true "$2"
  wait_job "$1" || { kubectl -n "$CLIENT_NS" logs "job/$1" >&2 || true; fail "$3"; }
  kubectl -n "$CLIENT_NS" logs "job/$1" 2>/dev/null | sed 's/^/      /'
}

kind create cluster --name "$CLUSTER" --config "$ROOT/deploy/kind/cluster.yaml" --wait 180s >/dev/null
kubectl wait --for=condition=Ready nodes --all --timeout=180s >/dev/null
pass "kind cluster $CLUSTER up ($(kubectl version -o json | jq -r .serverVersion.gitVersion), $(kubectl get nodes --no-headers | wc -l) nodes)"

docker image inspect "$CLIENT_IMAGE" >/dev/null 2>&1 || docker pull -q "$CLIENT_IMAGE" >/dev/null
kind load docker-image "$IMAGE" "$CLIENT_IMAGE" --name "$CLUSTER" >/dev/null
pass "images side-loaded (no registry involved)"

kustomize build "$ROOT/deploy/k8s/overlays/kind" | kubectl apply -f - >/dev/null
pass "kind overlay applied ($(kustomize build "$ROOT/deploy/k8s/overlays/kind" | grep -c '^kind:') objects)"

for _ in $(seq 1 60); do
  missing="$(kubectl -n "$NS" get events --field-selector reason=FailedMount -o jsonpath='{.items[*].message}' 2>/dev/null || true)"
  [[ "$missing" == *platewise-order-signing* ]] && break
  sleep 2
done
[[ "$missing" == *platewise-order-signing* ]] || fail "expected FailedMount events for the missing signing-key Secret"
[[ "$(kubectl -n "$NS" get deploy platewise -o jsonpath='{.status.readyReplicas}')" == "" ]] || fail "pods became ready without the signing key"
pass "without the signing-key Secret no pod starts (FailedMount, 0 ready)"

kubectl -n "$NS" create secret generic platewise-order-signing \
  --from-literal=signing-key="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" >/dev/null
for _ in $(seq 1 60); do
  [[ "$(kubectl -n "$NS" get deploy platewise -o jsonpath='{.spec.replicas}')" == "2" ]] && break
  sleep 2
done
kubectl -n "$NS" rollout status deploy/platewise --timeout=180s >/dev/null || fail "rollout"
[[ "$(kubectl -n "$NS" get deploy platewise -o jsonpath='{.status.readyReplicas}')" == "2" ]] || fail "expected 2 ready replicas"
pass "Secret created out of band; HPA minReplicas 2/2 ready under Pod Security 'restricted'"

if kubectl -n "$NS" run psa-probe --image="$CLIENT_IMAGE" --image-pull-policy=Never --restart=Never \
  --overrides='{"spec":{"containers":[{"name":"psa-probe","image":"'"$CLIENT_IMAGE"'","securityContext":{"privileged":true}}]}}' \
  --dry-run=server -o name >/dev/null 2>&1; then
  fail "a privileged pod was admitted into the restricted namespace"
fi
pass "privileged pod rejected by Pod Security admission"

kubectl create namespace "$CLIENT_NS" >/dev/null
kubectl label namespace "$CLIENT_NS" pod-security.kubernetes.io/enforce=restricted >/dev/null
SVC_IP="$(kubectl -n "$NS" get svc platewise -o jsonpath='{.spec.clusterIP}')"
POD_IPS="$(kubectl -n "$NS" get pods -l app.kubernetes.io/name=platewise -o jsonpath='{.items[*].status.podIP}')"
# shellcheck disable=SC2016  # expanded inside the client pod
wait_ready='n=0; until curl -fsS -m 3 -o /dev/null http://SVC/healthz/ready; do n=$((n+1)); [ "$n" -ge 15 ] && exit 1; sleep 2; done'
wait_ready="${wait_ready//SVC/$SVC_IP}"
# shellcheck disable=SC2016  # expanded inside the client pod
order_flow='
curl -fsS http://SVC/healthz/ready | grep -q "\"signingKey\":\"file\""
curl -fsS http://SVC/ | grep -q "id=\"root\""
curl -fsS "http://SVC/api/restaurants?cuisine=Seafood" | grep -q coastal-curry-co
order=$(curl -fsS -H "content-type: application/json" \
  -d "{\"restaurantId\":\"biryani-bazaar\",\"items\":[{\"id\":\"bb-chicken-dum\",\"qty\":2}],\"customerName\":\"Kind Smoke\"}" http://SVC/api/orders)
id=$(echo "$order" | sed -E "s/.*\"orderId\":\"([^\"]+)\".*/\1/")
for ip in PODS; do curl -fsS "http://$ip:8080/api/orders/$id" | grep -q "\"customer\":\"Kind Smoke\""; echo "pod $ip verified the order"; done
curl -fsS http://SVC/metrics | grep -q platewise_orders_total'
order_flow="${order_flow//SVC/$SVC_IP}"
order_flow="${order_flow//PODS/$POD_IPS}"
run_client smoke-orders "$wait_ready
$order_flow" "in-cluster order flow"
pass "in-cluster client (allowed by NetworkPolicy): key read from the mounted Secret file, SPA, search, order placed via the Service and verified by both replicas"

netpol_enforceable=1
if [[ -r /proc/config.gz ]] && ! zcat /proc/config.gz | grep -qE '^CONFIG_NETFILTER_NETLINK_QUEUE=(y|m)'; then
  netpol_enforceable=0
fi
if [[ "$netpol_enforceable" == "1" ]]; then
  client_job smoke-denied false "${wait_ready//-ge 15/-ge 5}"
  if wait_job smoke-denied; then fail "unlabelled client reached the app: NetworkPolicy not enforced"; fi
  pass "unlabelled client blocked by default-deny NetworkPolicy"
else
  echo "skip - NetworkPolicy deny check: host kernel lacks CONFIG_NETFILTER_NETLINK_QUEUE"
fi

[[ "$(kubectl -n "$NS" get pdb platewise -o jsonpath='{.status.disruptionsAllowed}')" == "1" ]] || fail "PDB should allow 1 disruption"
kubectl -n "$NS" rollout restart deploy/platewise >/dev/null
kubectl -n "$NS" rollout status deploy/platewise --timeout=240s >/dev/null || fail "rolling restart"
settle 2
[[ "$(kubectl -n "$NS" get deploy platewise -o jsonpath='{.status.readyReplicas}')" == "2" ]] || fail "replicas after restart"
pass "PDB allows 1 disruption; rolling restart (maxUnavailable 0) back to 2/2"

[[ "$(kubectl -n "$NS" get pods -l app.kubernetes.io/name=platewise -o jsonpath='{.items[0].spec.containers[0].securityContext.readOnlyRootFilesystem}')" == "true" ]] || fail "read-only root"
[[ "$(kubectl -n "$NS" get pods -l app.kubernetes.io/name=platewise -o jsonpath='{.items[0].spec.automountServiceAccountToken}')" == "false" ]] || fail "service-account token mounted"
pass "pods run with a read-only root filesystem and no service-account token"

echo "kind smoke test passed"
