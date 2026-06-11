#!/usr/bin/env bash
# ทดสอบ flow เต็ม: สั่ง -> จ่าย(devSlip) -> รับ -> เสร็จ -> รับของ + เคสล้มเหลวหลัก
# ใช้กับ local stack: ต้อง supabase start + supabase functions serve --env-file supabase/functions/.env อยู่ก่อน
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:54321}"
ANON_KEY="${ANON_KEY:?ใส่ ANON_KEY จาก supabase status}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:?ใส่ SERVICE_ROLE_KEY จาก supabase status}"
TEA="${TEA:-a0000000-0000-0000-0000-000000000099}"  # นมเผือก 25 บาท ไม่มี required option

PASS=0
FAIL=0
LAST_RESPONSE=""

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing command: $1" >&2
    exit 2
  }
}

check() {
  local desc="$1"
  local actual="$2"
  local expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    PASS=$((PASS + 1))
    echo "PASS: $desc"
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $desc — got '$actual' want '$expected'"
    if [[ -n "$LAST_RESPONSE" ]]; then
      echo "response: $LAST_RESPONSE"
    fi
  fi
}

post_json() {
  local url="$1"
  local body="$2"
  shift 2
  curl -fsS -X POST "$url" \
    -H "Content-Type: application/json" \
    "$@" \
    -d "$body"
}

patch_rest() {
  local table_filter="$1"
  local body="$2"
  curl -fsS -X PATCH "$BASE/rest/v1/$table_filter" \
    -H "apikey: $SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=minimal" \
    -d "$body" >/dev/null
}

need curl
need jq

curl -fsS "$BASE/rest/v1/" -H "apikey: $ANON_KEY" >/dev/null || {
  echo "Supabase local API ยังไม่พร้อมที่ $BASE"
  echo "ให้รัน: supabase start"
  exit 2
}

curl -fsS -X OPTIONS "$BASE/functions/v1/create-order" >/dev/null || {
  echo "Supabase functions ยังไม่พร้อมที่ $BASE/functions/v1"
  echo "ให้รัน: supabase functions serve --env-file supabase/functions/.env"
  exit 2
}

# ทำให้ smoke ไม่ขึ้นกับเวลาร้านจริง และกัน LINE group push จากข้อมูล local ที่เคยตั้งไว้
patch_rest "shop_settings?id=eq.1" \
  '{"is_accepting":true,"open_time":"00:00","close_time":"23:59","line_group_id":null,"notify_on_accept":true}'

# เตรียม staff user ใหม่ทุกครั้งเพื่อให้รันซ้ำได้
STAFF_EMAIL="staff-smoke-$(date +%s)-$RANDOM@shop.local"
STAFF_PASSWORD="staff1234"
post_json "$BASE/auth/v1/admin/users" \
  "{\"email\":\"$STAFF_EMAIL\",\"password\":\"$STAFF_PASSWORD\",\"email_confirm\":true}" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" >/dev/null

LAST_RESPONSE=$(post_json "$BASE/auth/v1/token?grant_type=password" \
  "{\"email\":\"$STAFF_EMAIL\",\"password\":\"$STAFF_PASSWORD\"}" \
  -H "apikey: $ANON_KEY")
JWT=$(echo "$LAST_RESPONSE" | jq -r '.access_token // empty')
if [[ -z "$JWT" ]]; then
  echo "login staff ไม่สำเร็จ"
  echo "response: $LAST_RESPONSE"
  exit 2
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
REF="SMOKE-$(date +%s)-$RANDOM"

# 1. สั่ง
LAST_RESPONSE=$(post_json "$BASE/functions/v1/create-order" \
  "{\"idToken\":\"dev:U_smoke_e2e\",\"pickup_type\":\"ASAP\",\"items\":[{\"menuItemId\":\"$TEA\",\"qty\":2,\"optionItemIds\":[]}]}")
OID=$(echo "$LAST_RESPONSE" | jq -r '.order_id // empty')
check "create-order total=50" "$(echo "$LAST_RESPONSE" | jq -r '.total // empty')" "50"
check "qr ขึ้นต้น 000201" "$(echo "$LAST_RESPONSE" | jq -r '.qr_payload // empty' | cut -c1-6)" "000201"
if [[ -z "$OID" ]]; then
  echo "สร้างออเดอร์ไม่สำเร็จ"
  exit 1
fi

# 2. จ่ายยอดผิดต้องไม่ผ่าน
LAST_RESPONSE=$(curl -sS -X POST "$BASE/functions/v1/verify-slip" \
  -H "Content-Type: application/json" \
  -d "{\"idToken\":\"dev:U_smoke_e2e\",\"order_id\":\"$OID\",\"devSlip\":{\"transRef\":\"$REF-bad\",\"amount\":10,\"transDate\":\"$NOW\"}}")
check "ยอดไม่พอ -> AMOUNT_MISMATCH" "$(echo "$LAST_RESPONSE" | jq -r '.error // empty')" "AMOUNT_MISMATCH"

# 3. จ่ายถูก -> PAID
LAST_RESPONSE=$(post_json "$BASE/functions/v1/verify-slip" \
  "{\"idToken\":\"dev:U_smoke_e2e\",\"order_id\":\"$OID\",\"devSlip\":{\"transRef\":\"$REF\",\"amount\":50,\"transDate\":\"$NOW\"}}")
check "จ่ายสำเร็จ -> PAID" "$(echo "$LAST_RESPONSE" | jq -r '.status // empty')" "PAID"

# 4. staff เดินสถานะ ACCEPT -> READY -> COMPLETE
for STEP in "ACCEPT:COOKING" "READY:READY" "COMPLETE:COMPLETED"; do
  ACTION="${STEP%%:*}"
  WANT="${STEP##*:}"
  LAST_RESPONSE=$(post_json "$BASE/functions/v1/update-order-status" \
    "{\"order_id\":\"$OID\",\"action\":\"$ACTION\"}" \
    -H "Authorization: Bearer $JWT")
  check "$ACTION -> $WANT" "$(echo "$LAST_RESPONSE" | jq -r '.status // empty')" "$WANT"
done

# 5. flow ปฏิเสธ + คืนเงิน
LAST_RESPONSE=$(post_json "$BASE/functions/v1/create-order" \
  "{\"idToken\":\"dev:U_smoke_e2e\",\"pickup_type\":\"ASAP\",\"items\":[{\"menuItemId\":\"$TEA\",\"qty\":1,\"optionItemIds\":[]}]}")
OID2=$(echo "$LAST_RESPONSE" | jq -r '.order_id // empty')
if [[ -z "$OID2" ]]; then
  echo "สร้างออเดอร์ที่สองไม่สำเร็จ"
  echo "response: $LAST_RESPONSE"
  exit 1
fi

post_json "$BASE/functions/v1/verify-slip" \
  "{\"idToken\":\"dev:U_smoke_e2e\",\"order_id\":\"$OID2\",\"devSlip\":{\"transRef\":\"$REF-2\",\"amount\":25,\"transDate\":\"$NOW\"}}" >/dev/null

LAST_RESPONSE=$(post_json "$BASE/functions/v1/update-order-status" \
  "{\"order_id\":\"$OID2\",\"action\":\"REJECT\",\"reject_reason\":\"วัตถุดิบหมด\"}" \
  -H "Authorization: Bearer $JWT")
check "REJECT -> REFUND_PENDING" "$(echo "$LAST_RESPONSE" | jq -r '.status // empty')" "REFUND_PENDING"

LAST_RESPONSE=$(post_json "$BASE/functions/v1/update-order-status" \
  "{\"order_id\":\"$OID2\",\"action\":\"CONFIRM_REFUND\"}" \
  -H "Authorization: Bearer $JWT")
check "CONFIRM_REFUND -> REFUNDED" "$(echo "$LAST_RESPONSE" | jq -r '.status // empty')" "REFUNDED"

echo
echo "ผ่าน $PASS / ตก $FAIL"
[[ "$PASS" -eq 9 && "$FAIL" -eq 0 ]]
