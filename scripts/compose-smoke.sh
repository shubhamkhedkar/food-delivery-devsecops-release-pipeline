#!/usr/bin/env bash
# Brings up the local stack, proves it end to end and tears it down: the hardened app
# container, a full order flow, order ids that survive a container restart (shared signing
# key), Prometheus scraping + rules + business metrics, and Grafana provisioning.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DOCKER="${DOCKER:-docker}"
PROJECT="platewise-smoke-$$"
GRAFANA_ADMIN_PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -d '/+=')"
ORDER_SIGNING_KEY="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
export GRAFANA_ADMIN_PASSWORD ORDER_SIGNING_KEY
WORK="$(mktemp -d)"
printf 'machine 127.0.0.1 login admin password %s\n' "$GRAFANA_ADMIN_PASSWORD" >"$WORK/netrc"
chmod 600 "$WORK/netrc"
APP=http://127.0.0.1:8080

compose() { $DOCKER compose -p "$PROJECT" "$@"; }
cleanup() {
  if [[ "${KEEP:-0}" != "1" ]]; then compose down -v --remove-orphans >/dev/null 2>&1 || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
pass() { echo "ok  - $*"; }
fail() { echo "FAIL: $*" >&2; compose ps >&2 || true; compose logs --tail 30 >&2 || true; exit 1; }
promq() { curl -fsS -G --data-urlencode "query=$1" http://127.0.0.1:9090/api/v1/query; }
retry() { # attempts, command...
  local n="$1"; shift
  for _ in $(seq 1 "$n"); do "$@" >/dev/null 2>&1 && return 0; sleep 1; done
  return 1
}
post() { curl -sS -o "$WORK/body" -w '%{http_code}' -H 'content-type: application/json' -d "$2" "$APP$1"; }

compose up -d --build --quiet-pull >/dev/null 2>&1 || fail "compose up"
pass "stack started: $(compose ps --services | sort | tr '\n' ' ')"
retry 60 curl -fsS "$APP/healthz/ready" || fail "app not ready"
[[ "$(curl -fsS "$APP/healthz/ready" | jq -r .signingKey)" == "env" ]] || fail "signing key not taken from the environment"
pass "app ready on 127.0.0.1:8080 with the signing key from the environment"

cid="$(compose ps -q platewise)"
[[ "$($DOCKER inspect -f '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}}' "$cid")" == "65532:65532 true [ALL]" ]] ||
  fail "container hardening: $($DOCKER inspect -f '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}}' "$cid")"
[[ "$($DOCKER inspect -f '{{.State.Health.Status}}' "$cid")" =~ ^(healthy|starting)$ ]] || fail "container health"
pass "container runs as 65532:65532, read-only root, all capabilities dropped, HEALTHCHECK passing"

headers="$(curl -fsS -D - -o /dev/null "$APP/")"
grep -qi "^content-security-policy: default-src 'self'" <<<"$headers" || fail "CSP header"
grep -qi '^x-frame-options: DENY' <<<"$headers" || fail "X-Frame-Options"
curl -fsS "$APP/" | grep -q '<div id="root">' || fail "SPA shell"
pass "SPA served with CSP and X-Frame-Options"

[[ "$(curl -fsS "$APP/api/restaurants?veg=true&sort=rating" | jq -r '.restaurants[0].id')" == "misal-mandal" ]] || fail "search"
[[ "$(post /api/quote '{"restaurantId":"tawa-junction","items":[{"id":"tj-dal-makhani","qty":2}],"coupon":"WELCOME50"}')" == "200" ]] || fail "quote"
[[ "$(jq -c '[.subtotal,.discount,.deliveryFee,.gst,.total]' "$WORK/body")" == "[45800,10000,3500,1890,43190]" ]] || fail "quote maths: $(cat "$WORK/body")"
[[ "$(post /api/quote '{"restaurantId":"tawa-junction","items":[{"id":"tj-dal-makhani","qty":99}]}')" == "400" ]] || fail "invalid quantity accepted"
pass "search, quote (₹458 - ₹100 WELCOME50 + fees + 5% GST = ₹431.90) and cart validation"

for i in 1 2 3; do
  [[ "$(post /api/orders '{"restaurantId":"misal-mandal","items":[{"id":"mm-misal-pav","qty":2},{"id":"mm-piyush","qty":1}],"customerName":"Smoke Test"}')" == "201" ]] || fail "order $i"
done
ORDER="$(jq -r .orderId "$WORK/body")"
[[ "$(curl -fsS "$APP/api/orders/$ORDER" | jq -r .status)" == "placed" ]] || fail "order status"
tampered="${ORDER%?????}AAAAA"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$APP/api/orders/$tampered")" == "404" ]] || fail "tampered order id accepted"
pass "3 orders placed (201), status tracked, tampered order id rejected (404)"

compose restart platewise >/dev/null
retry 60 curl -fsS "$APP/healthz/ready" || fail "app not ready after restart"
[[ "$(curl -fsS "$APP/api/orders/$ORDER" | jq -r .customer)" == "Smoke Test" ]] || fail "order lost across restart"
pass "order id still verifies after a container restart (signing key is configuration, not process state)"
for i in 1 2; do post /api/orders '{"restaurantId":"dosa-district","items":[{"id":"dd-masala-dosa","qty":1}],"coupon":"FREEDEL","customerName":"Smoke Test"}' >/dev/null; done

targets_up() { promq 'up{job=~"platewise|prometheus"} == 1' | jq -e '.data.result | length == 2'; }
retry 90 targets_up || fail "Prometheus targets not all up: $(promq up | jq -c '[.data.result[] | {job: .metric.job, v: .value[1]}]')"
pass "Prometheus scrapes platewise and itself (all up)"

rules="$(curl -fsS http://127.0.0.1:9090/api/v1/rules | jq '[.data.groups[].rules[]] | length')"
[[ "$rules" == "11" ]] || fail "expected 11 rules, got $rules"
pass "Prometheus loaded $rules recording/alerting rules"

has_orders() { promq 'sum(platewise_orders_total{restaurant="dosa-district"})' | jq -e '(.data.result[0].value[1] | tonumber) >= 2'; }
retry 60 has_orders || fail "order counters not visible in Prometheus"
pass "business metrics (orders by restaurant) visible in PromQL"

retry 60 curl -fsS http://127.0.0.1:3000/api/health || fail "grafana health"
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/api/search)"
[[ "$code" == "401" ]] || fail "anonymous Grafana API access returned $code"
gapi() { curl -fsS --netrc-file "$WORK/netrc" "http://127.0.0.1:3000$1"; }
dashboards="$(gapi '/api/search?tag=platewise' | jq -r '[.[].uid] | sort | join(",")')"
[[ "$dashboards" == "platewise-overview" ]] || fail "dashboards: $dashboards"
gapi /api/datasources/uid/prometheus/health | jq -e '.status == "OK"' >/dev/null || fail "datasource health"
pass "Grafana: anonymous denied (401), Prometheus datasource healthy, dashboard provisioned: $dashboards"

echo "compose smoke test passed"
