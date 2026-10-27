#!/bin/sh
# Starts the server image as production does and checks what a deployment relies on:
# migrations at boot (twice), /health with the release, the session guard, the worker loop,
# the inference process and the bundled files. No provider call, no secret.
# Usage: scripts/smoke-server-image.sh <image> <database URL as seen from a container> [release]
set -eu
image=$1
database=$2
release=${3:-smoke}
port=${SMOKE_PORT:-3099}
api=sillage-smoke-api
inference=sillage-smoke-inference
run="docker run --rm --add-host=host.docker.internal:host-gateway --read-only --tmpfs /tmp:size=64m --cap-drop ALL"
cleanup() { docker rm -f "$api" "$inference" >/dev/null 2>&1 || true; }
trap cleanup EXIT
fail() { echo "SMOKE FAILED: $1" >&2; docker logs "$api" 2>&1 | tail -20 >&2 || true; exit 1; }
healthy() {
  for _ in $(seq 1 40); do
    body=$(curl -fsS "http://127.0.0.1:$port/health" 2>/dev/null) && { echo "$body"; return 0; }
    sleep 1
  done
  return 1
}

cleanup
docker run -d --name "$api" --add-host=host.docker.internal:host-gateway --read-only \
  --tmpfs /tmp:size=64m --cap-drop ALL --memory 192m -p "$port:3001" \
  -e DATABASE_URL="$database" -e PORT=3001 -e RELEASE_SHA="$release" "$image" >/dev/null
body=$(healthy) || fail "API not healthy"
echo "$body" | grep -q "\"release\":\"$release\"" || fail "/health does not serve RELEASE_SHA"
status=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/v1/me")
[ "$status" = 401 ] || fail "/v1/me without a session answered $status"

# A restart replays the boot: migrations already applied must be a no-op.
docker restart "$api" >/dev/null
healthy >/dev/null || fail "API not healthy after a restart"

$run -e DATABASE_URL="$database" "$image" timeout 8 node dist/worker.js && fail "worker exited early" || [ $? = 124 ] || fail "worker crashed"
$run "$image" sh -c 'test -f dist/inference.js && test -f dist/model-process.js && test -f dist/modules/auth/token.cli.js && test -f drizzle/meta/_journal.json' \
  || fail "bundle or migrations missing from the image"

docker run -d --name "$inference" --read-only --tmpfs /tmp "$image" node dist/inference.js >/dev/null
for _ in $(seq 1 20); do
  docker exec "$inference" node -e "fetch('http://127.0.0.1:3002/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && inference_ok=1 && break
  sleep 1
done
[ "${inference_ok:-}" = 1 ] || fail "inference not healthy"
echo "Server image smoke test passed ($release)."
