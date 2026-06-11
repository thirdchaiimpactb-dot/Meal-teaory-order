import {
  ApiClient,
  bindConfigDialog,
  dateTime,
  escapeHtml,
  loadConfig,
  money,
  openConfigDialog,
  statusClass,
  statusLabel,
} from "./common.js";

let config = loadConfig();
let session = JSON.parse(localStorage.getItem("dormOrder.staffSession") || "null");
let api = new ApiClient(config, session?.access_token);
let orders = [];
let orderItems = [];
let settings = null;
let menuItems = [];

const el = (id) => document.getElementById(id);

function showNotice(message, type = "") {
  const box = el("notice");
  box.className = `notice ${type}`.trim();
  box.textContent = message;
  box.classList.toggle("hidden", !message);
}

async function login() {
  if (!api.ready) {
    showNotice("กรุณาตั้งค่า Supabase URL และ anon key ก่อน", "warn");
    openConfigDialog(document.querySelector("#configDialog"), document.querySelector("#configForm"));
    return;
  }
  const res = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: config.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: el("email").value.trim(), password: el("password").value }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error_description || body?.msg || "LOGIN_FAILED");
  session = body;
  localStorage.setItem("dormOrder.staffSession", JSON.stringify(session));
  api = new ApiClient(config, session.access_token);
  await loadDashboard();
}

function showDashboard(loggedIn) {
  el("loginPanel").classList.toggle("hidden", loggedIn);
  el("dashboard").classList.toggle("hidden", !loggedIn);
}

async function loadDashboard() {
  if (!api.ready) return showDashboard(false);
  if (!session?.access_token) return showDashboard(false);
  showDashboard(true);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const [orderRows, settingRows, itemRows] = await Promise.all([
    api.rest(`orders?select=*&order=created_at.desc&order_date=eq.${today}`),
    api.rest("shop_settings?select=*&id=eq.1"),
    api.rest("menu_items?select=*&order=sort_order.asc"),
  ]);
  orders = orderRows;
  settings = settingRows[0];
  menuItems = itemRows;
  const ids = orders.map((o) => o.id);
  orderItems = ids.length
    ? await api.rest(`order_items?select=*&order_id=in.(${ids.join(",")})&order=id.asc`)
    : [];
  renderMetrics();
  renderOrders();
  renderSettings();
  renderMenuAdmin();
}

function orderTotalForMetric(order) {
  if (["PAID", "COOKING", "READY", "COMPLETED"].includes(order.status)) return Number(order.total || 0);
  return 0;
}

function renderMetrics() {
  el("metricOrders").textContent = orders.length;
  el("metricSales").textContent = money(orders.reduce((sum, o) => sum + orderTotalForMetric(o), 0));
  el("metricActive").textContent = orders.filter((o) => ["PAID", "COOKING", "READY"].includes(o.status)).length;
  el("metricRefund").textContent = orders.filter((o) => o.status === "REFUND_PENDING").length;
}

function itemsFor(orderId) {
  return orderItems.filter((item) => item.order_id === orderId);
}

function matchesFilters(order) {
  const term = el("search").value.trim().toLowerCase();
  const status = el("statusFilter").value;
  if (status && order.status !== status) return false;
  if (!term) return true;
  return String(order.order_no).includes(term) || String(order.customer_id || "").toLowerCase().includes(term);
}

function pickupLabel(order) {
  return order.pickup_type === "SCHEDULED" ? dateTime(order.pickup_time) : "รับเลย";
}

function renderOrderCard(order) {
  const itemLines = itemsFor(order.id).map((item) => {
    const opts = (item.options || []).map((o) => o.name).join(", ");
    return `<li>${escapeHtml(item.name_snapshot)} x${item.qty}${opts ? ` (${escapeHtml(opts)})` : ""}${item.note ? ` - ${escapeHtml(item.note)}` : ""}</li>`;
  }).join("");
  const actions = [];
  if (order.status === "PAID") {
    actions.push(`<button class="good" data-action="ACCEPT" data-id="${order.id}">รับ</button>`);
    actions.push(`<button class="danger" data-action="REJECT" data-id="${order.id}">ปฏิเสธ</button>`);
  }
  if (order.status === "COOKING") {
    actions.push(`<button class="good" data-action="READY" data-id="${order.id}">เสร็จแล้ว</button>`);
    actions.push(`<button class="danger" data-action="REJECT" data-id="${order.id}">ปฏิเสธ</button>`);
  }
  if (order.status === "READY") actions.push(`<button class="good" data-action="COMPLETE" data-id="${order.id}">รับของแล้ว</button>`);
  if (order.status === "REFUND_PENDING") actions.push(`<button class="warn" data-action="CONFIRM_REFUND" data-id="${order.id}">คืนเงินแล้ว</button>`);
  if (order.status === "PENDING_PAYMENT") actions.push(`<button class="warn" data-action="MANUAL_PAID" data-id="${order.id}">ยืนยันสลิปเอง</button>`);
  return `
    <article class="order-card">
      <div class="cart-line-top">
        <h3>#${order.order_no}</h3>
        <span class="status-pill ${statusClass(order.status)}">${statusLabel(order.status)}</span>
      </div>
      <div class="row">
        <strong>${money(order.total)}</strong>
        <span class="muted">${pickupLabel(order)}</span>
      </div>
      <ul class="item-list">${itemLines}</ul>
      ${order.reject_reason ? `<div class="muted">เหตุผล: ${escapeHtml(order.reject_reason)}</div>` : ""}
      <div class="row">${actions.join("")}</div>
    </article>
  `;
}

function renderOrders() {
  const visible = orders.filter(matchesFilters);
  const paid = visible.filter((o) => o.status === "PAID" || o.status === "PENDING_PAYMENT");
  const cooking = visible.filter((o) => o.status === "COOKING");
  const ready = visible.filter((o) => ["READY", "REFUND_PENDING"].includes(o.status));
  el("paidCol").innerHTML = paid.map(renderOrderCard).join("") || `<div class="muted">ไม่มีออเดอร์ใหม่</div>`;
  el("cookingCol").innerHTML = cooking.map(renderOrderCard).join("") || `<div class="muted">ยังไม่มีรายการ</div>`;
  el("readyCol").innerHTML = ready.map(renderOrderCard).join("") || `<div class="muted">ยังไม่มีรายการ</div>`;
  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => changeStatus(btn.dataset.id, btn.dataset.action));
  });
}

async function changeStatus(orderId, action) {
  const body = { order_id: orderId, action };
  if (action === "REJECT") {
    const reason = prompt("เหตุผลที่ปฏิเสธออเดอร์");
    if (!reason) return;
    body.reject_reason = reason;
  }
  await api.fn("update-order-status", body, session.access_token);
  showNotice("อัปเดตสถานะแล้ว", "good");
  await loadDashboard();
}

function renderSettings() {
  if (!settings) return;
  el("accepting").value = String(settings.is_accepting);
  el("prepMinutes").value = settings.est_prep_minutes;
  el("openTime").value = String(settings.open_time).slice(0, 5);
  el("closeTime").value = String(settings.close_time).slice(0, 5);
  el("promptpayId").value = settings.promptpay_id;
}

async function saveSettings() {
  await api.rest("shop_settings?id=eq.1", {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      is_accepting: el("accepting").value === "true",
      est_prep_minutes: Number(el("prepMinutes").value),
      open_time: el("openTime").value,
      close_time: el("closeTime").value,
      promptpay_id: el("promptpayId").value.trim(),
    }),
  });
  showNotice("บันทึกตั้งค่าร้านแล้ว", "good");
  await loadDashboard();
}

function renderMenuAdmin() {
  el("menuAdmin").innerHTML = menuItems.map((item) => `
    <div class="menu-admin-row" data-item-id="${item.id}">
      <div class="menu-admin-img-wrap">
        ${item.image_url
          ? `<img class="menu-admin-thumb" src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}">`
          : `<div class="menu-admin-thumb menu-admin-no-img">ยังไม่มีรูป</div>`}
        <label class="menu-admin-upload-btn secondary" title="อัปโหลดรูปอาหาร">
          <input type="file" accept="image/jpeg,image/png,image/webp" hidden data-upload="${item.id}">
          เปลี่ยนรูป
        </label>
      </div>
      <div class="menu-admin-info">
        <strong>${escapeHtml(item.name)}</strong>
        <div class="muted">${money(item.base_price)}</div>
      </div>
      <button class="${item.is_available ? "secondary" : "good"}" data-menu="${item.id}" data-next="${!item.is_available}">
        ${item.is_available ? "ปิดขาย" : "เปิดขาย"}
      </button>
    </div>
  `).join("");
  document.querySelectorAll("[data-menu]").forEach((btn) => {
    btn.addEventListener("click", () => toggleMenu(btn.dataset.menu, btn.dataset.next === "true"));
  });
  document.querySelectorAll("[data-upload]").forEach((input) => {
    input.addEventListener("change", () => uploadMenuImage(input.dataset.upload, input.files[0]));
  });
}

async function toggleMenu(id, next) {
  await api.rest(`menu_items?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ is_available: next }),
  });
  await loadDashboard();
}

async function uploadMenuImage(itemId, file) {
  if (!file) return;
  showNotice("กำลังอัปโหลดรูป...", "");
  const imageUrl = await api.uploadMenuImage(itemId, file);
  await api.rest(`menu_items?id=eq.${itemId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ image_url: imageUrl }),
  });
  showNotice("อัปโหลดรูปเสร็จแล้ว", "good");
  await loadDashboard();
}

function switchView(view) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  el("ordersView").classList.toggle("hidden", view !== "orders");
  el("settingsView").classList.toggle("hidden", view !== "settings");
  el("menuView").classList.toggle("hidden", view !== "menu");
}

function bindEvents() {
  bindConfigDialog((next) => {
    config = next;
    api = new ApiClient(config, session?.access_token);
    loadDashboard().catch((e) => showNotice(e.message, "warn"));
  });
  el("login").addEventListener("click", () => login().catch((e) => showNotice(e.message, "warn")));
  el("logout").addEventListener("click", () => {
    session = null;
    localStorage.removeItem("dormOrder.staffSession");
    api = new ApiClient(config);
    showDashboard(false);
  });
  el("refresh").addEventListener("click", () => loadDashboard().catch((e) => showNotice(e.message, "warn")));
  el("search").addEventListener("input", renderOrders);
  el("statusFilter").addEventListener("change", renderOrders);
  el("saveSettings").addEventListener("click", () => saveSettings().catch((e) => showNotice(e.message, "warn")));
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
}

bindEvents();
loadDashboard().catch((e) => showNotice(e.message, "warn"));
setInterval(() => {
  if (session?.access_token && !document.hidden) loadDashboard().catch(() => {});
}, 8000);
