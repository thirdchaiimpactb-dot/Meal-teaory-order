// EMVCo Merchant-Presented QR สำหรับ PromptPay (dynamic — ระบุยอด)

function tlv(id: string, value: string): string {
  return id + value.length.toString().padStart(2, "0") + value;
}

// CRC16-CCITT (init 0xFFFF, poly 0x1021) ตามสเปก EMVCo
export function crc16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function promptPayPayload(promptpayId: string, amountTHB: number): string {
  const digits = promptpayId.replace(/\D/g, "");
  const proxy = digits.length === 13
    ? tlv("02", digits)                                // เลขบัตรประชาชน/เลขผู้เสียภาษี
    : tlv("01", "0066" + digits.replace(/^0/, ""));    // เบอร์มือถือ
  const body =
    tlv("00", "01") +
    tlv("01", "12") +
    tlv("29", tlv("00", "A000000677010111") + proxy) +
    tlv("53", "764") +
    tlv("54", amountTHB.toFixed(2)) +
    tlv("58", "TH");
  const withCrcId = body + "6304";
  return withCrcId + crc16(withCrcId);
}
