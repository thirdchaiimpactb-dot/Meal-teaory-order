const DEFAULT_CONFIG = window.DORM_ORDER_CONFIG ?? {};
const CONFIG_KEY = "dormOrder.config";

export function loadConfig() {
  const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}");
  return { ...DEFAULT_CONFIG, ...saved };
}

export function saveConfig(next) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
}

export function money(n) {
  return `${Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} บาท`;
}

export function dateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function statusLabel(status) {
  return {
    PENDING_PAYMENT: "รอจ่าย",
    PAID: "จ่ายแล้ว",
    COOKING: "กำลังทำ",
    READY: "รอรับ",
    COMPLETED: "รับแล้ว",
    EXPIRED: "หมดเวลา",
    REFUND_PENDING: "รอคืนเงิน",
    REFUNDED: "คืนเงินแล้ว",
  }[status] ?? status;
}

export function statusClass(status) {
  if (status === "PENDING_PAYMENT") return "pending";
  if (status === "PAID" || status === "READY") return "paid";
  if (status === "COOKING") return "cooking";
  if (status === "REFUND_PENDING" || status === "REFUNDED") return "refund";
  return "";
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[c]));
}

export class ApiClient {
  constructor(config, accessToken = "") {
    this.config = config;
    this.accessToken = accessToken;
  }

  get ready() {
    return Boolean(this.config.supabaseUrl && this.config.anonKey);
  }

  headers(extra = {}) {
    const h = {
      apikey: this.config.anonKey,
      "Content-Type": "application/json",
      ...extra,
    };
    if (this.accessToken) h.Authorization = `Bearer ${this.accessToken}`;
    return h;
  }

  async rest(path, init = {}) {
    const res = await fetch(`${this.config.supabaseUrl}/rest/v1/${path}`, {
      ...init,
      headers: this.headers(init.headers),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message || body?.error || `HTTP_${res.status}`);
    return body;
  }

  async uploadMenuImage(itemId, file) {
    const ext = file.type.includes("png") ? "png" : file.type.includes("webp") ? "webp" : "jpg";
    const path = `${itemId}.${ext}`;
    const res = await fetch(`${this.config.supabaseUrl}/storage/v1/object/menu-images/${path}`, {
      method: "POST",
      headers: {
        apikey: this.config.anonKey,
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": file.type,
        "x-upsert": "true",
      },
      body: file,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `UPLOAD_${res.status}`);
    }
    return `${this.config.supabaseUrl}/storage/v1/object/public/menu-images/${path}`;
  }

  async fn(name, body, authToken = "") {
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${this.config.supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const error = new Error(data?.error || `HTTP_${res.status}`);
      error.code = data?.error;
      throw error;
    }
    return data;
  }
}

export function openConfigDialog(dialog, form) {
  const c = loadConfig();
  form.supabaseUrl.value = c.supabaseUrl || "";
  form.anonKey.value = c.anonKey || "";
  form.liffId.value = c.liffId || "";
  dialog.showModal();
}

export function bindConfigDialog(onSave) {
  const dialog = document.querySelector("#configDialog");
  const form = document.querySelector("#configForm");
  document.querySelector("#openConfig")?.addEventListener("click", () => openConfigDialog(dialog, form));
  document.querySelector("#closeConfig")?.addEventListener("click", () => dialog.close());
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = {
      ...loadConfig(),
      supabaseUrl: form.supabaseUrl.value.trim().replace(/\/$/, ""),
      anonKey: form.anonKey.value.trim(),
      liffId: form.liffId.value.trim(),
    };
    saveConfig(next);
    dialog.close();
    onSave?.(next);
  });
  return { dialog, form };
}
