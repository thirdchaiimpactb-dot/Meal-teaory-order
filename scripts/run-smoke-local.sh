#!/usr/bin/env bash
# One-command local smoke runner for people who do not want to juggle 3 terminals.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOG_DIR="${TMPDIR:-/tmp}/dorm-order-system"
FUNCTION_LOG="$LOG_DIR/functions-serve.log"
mkdir -p "$LOG_DIR"

cleanup() {
  if [[ -n "${FUNCTION_PID:-}" ]] && kill -0 "$FUNCTION_PID" >/dev/null 2>&1; then
    kill "$FUNCTION_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1"
    exit 2
  }
}

wait_for() {
  local desc="$1"
  local cmd="$2"
  local seconds="${3:-30}"
  local i
  echo -n "รอ $desc"
  for ((i = 1; i <= seconds; i++)); do
    if eval "$cmd" >/dev/null 2>&1; then
      echo " พร้อม"
      return 0
    fi
    echo -n "."
    sleep 1
  done
  echo ""
  echo "$desc ยังไม่พร้อมหลังรอ ${seconds} วินาที"
  return 1
}

extract_keys() {
  local status="$1"
  ANON_KEY="$(printf "%s\n" "$status" | awk -F '│' '/Publishable/ {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $3); print $3; exit}')"
  SERVICE_ROLE_KEY="$(printf "%s\n" "$status" | awk -F '│' '/Secret/ {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $3); print $3; exit}')"
  if [[ -z "${ANON_KEY:-}" || -z "${SERVICE_ROLE_KEY:-}" ]]; then
    echo "อ่าน ANON_KEY / SERVICE_ROLE_KEY จาก supabase status ไม่ได้"
    echo "$status"
    exit 2
  fi
}

need curl
need jq
need supabase

echo "1) ตรวจ Supabase local API"
if ! curl -fsS -I "http://127.0.0.1:54321/rest/v1/" >/dev/null 2>&1; then
  echo "Supabase local API ยังไม่เปิด กำลังลองรัน supabase start..."
  supabase start
fi
wait_for "Supabase local API" "curl -fsS -I http://127.0.0.1:54321/rest/v1/" 60

echo "2) อ่าน local keys"
STATUS_OUTPUT="$(supabase status)"
extract_keys "$STATUS_OUTPUT"

echo "3) เปิด Edge Functions"
if curl -fsS -X OPTIONS "http://127.0.0.1:54321/functions/v1/create-order" >/dev/null 2>&1; then
  echo "Edge Functions เปิดอยู่แล้ว"
else
  : > "$FUNCTION_LOG"
  SUPABASE_TELEMETRY_DISABLED=1 HOME="${HOME:-/tmp}" \
    supabase functions serve --env-file supabase/functions/.env >"$FUNCTION_LOG" 2>&1 &
  FUNCTION_PID=$!
  if ! wait_for "Edge Functions" "curl -fsS -X OPTIONS http://127.0.0.1:54321/functions/v1/create-order" 90; then
    echo ""
    echo "functions serve log:"
    tail -80 "$FUNCTION_LOG"
    exit 2
  fi
fi

echo "4) รัน unit tests"
deno task test

echo "5) รัน smoke test"
ANON_KEY="$ANON_KEY" SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" ./scripts/smoke.sh
