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
let api = new ApiClient(config);
let menu = { categories: [], items: [], groups: [], options: [], links: [] };
let cart = [];
let currentOrder = JSON.parse(localStorage.getItem("dormOrder.lastOrder") || "null");
let activeCategoryId = "";
let searchTerm = "";

const el = (id) => document.getElementById(id);
const isMobile = () => window.innerWidth <= 900;

let refreshing = false;
let fastPollHandle = null;

function withLoading(btn, fn) {
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "กำลังโหลด...";
  return fn().finally(() => { btn.disabled = false; btn.textContent = orig; });
}

function openCartDrawer() {
  el("cartPanel").classList.add("drawer-open");
  el("drawerOverlay").classList.add("visible");
  el("cartBar").classList.add("hidden");
}

function closeCartDrawer() {
  el("cartPanel").classList.remove("drawer-open");
  el("drawerOverlay").classList.remove("visible");
  if (cart.length > 0) el("cartBar").classList.remove("hidden");
}

function openPaymentDrawer() {
  el("paymentPanel").classList.remove("hidden");
  el("paymentPanel").offsetHeight; // force reflow
  el("paymentPanel").classList.add("drawer-open");
  el("drawerOverlay").classList.add("visible");
}

function closePaymentDrawer() {
  el("paymentPanel").classList.remove("drawer-open");
  el("drawerOverlay").classList.remove("visible");
  setTimeout(() => {
    if (!el("paymentPanel").classList.contains("drawer-open")) {
      el("paymentPanel").classList.add("hidden");
    }
  }, 330);
}

function showNotice(message, type = "") {
  const box = el("notice");
  box.className = `notice ${type}`.trim();
  box.textContent = message;
  box.classList.toggle("hidden", !message);
}

function optionGroupsForItem(itemId) {
  return menu.links
    .filter((link) => link.menu_item_id === itemId)
    .map((link) => menu.groups.find((g) => g.id === link.option_group_id))
    .filter(Boolean);
}

function optionsForGroup(groupId) {
  return menu.options
    .filter((option) => option.group_id === groupId && option.is_available)
    .sort((a, b) => a.sort_order - b.sort_order);
}

function itemUnitPrice(item, optionIds) {
  const delta = optionIds.reduce((sum, id) => {
    const option = menu.options.find((o) => o.id === id);
    return sum + Number(option?.price_delta || 0);
  }, 0);
  return Number(item.base_price) + delta;
}

function activeCategoryIds() {
  return new Set(
    menu.items.filter((i) => i.is_available).map((i) => i.category_id)
  );
}

function renderCategoryTabs() {
  const root = el("categoryTabs");
  if (!root) return;
  const hasItems = activeCategoryIds();
  const visibleCats = menu.categories.filter((c) => hasItems.has(c.id));
  const tabs = [
    `<button class="category-chip ${activeCategoryId ? "" : "active"}" data-category="">ทั้งหมด</button>`,
    ...visibleCats.map((cat) =>
      `<button class="category-chip ${activeCategoryId === cat.id ? "active" : ""}" data-category="${cat.id}">${escapeHtml(cat.name)}</button>`
    ),
  ];
  root.innerHTML = tabs.join("");
  root.querySelectorAll("[data-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategoryId = btn.dataset.category || "";
      renderCategoryTabs();
      renderMenu();
    });
  });
}

function itemMatchesFilters(item) {
  if (activeCategoryId && item.category_id !== activeCategoryId) return false;
  if (!searchTerm) return true;
  const haystack = `${item.name || ""} ${item.description || ""}`.toLowerCase();
  return haystack.includes(searchTerm.toLowerCase());
}

function renderMenu() {
  const root = el("menuRoot");
  root.innerHTML = "";
  for (const cat of menu.categories) {
    const items = menu.items
      .filter((item) => item.category_id === cat.id && item.is_available && itemMatchesFilters(item))
      .sort((a, b) => a.sort_order - b.sort_order);
    if (!items.length) continue;
    const section = document.createElement("section");
    section.className = "category";
    section.innerHTML = `<h2>${escapeHtml(cat.name)}</h2><div class="menu-list"></div>`;
    const list = section.querySelector(".menu-list");
    for (const item of items) {
      const card = document.createElement("article");
      card.className = "menu-card";
      const groups = optionGroupsForItem(item.id);
      const imgHtml = item.image_url
        ? `<img class="menu-img" src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}" loading="lazy">`
        : `<div class="menu-img-placeholder"><img src="./assets/meal-sticker.png" alt=""></div>`;
      card.innerHTML = `
        ${imgHtml}
        <div class="menu-card-main">
          <div>
            <h3>${escapeHtml(item.name)}</h3>
            <div class="muted">${escapeHtml(item.description || "เลือกตัวเลือกได้ตามต้องการ")}</div>
          </div>
          <div class="price">เริ่ม ${money(item.base_price)}</div>
        </div>
        <div class="options"></div>
        <div class="field"><textarea placeholder="หมายเหตุ"></textarea></div>
        <div class="row">
          <input type="number" min="1" max="99" value="1" style="width:82px">
          <button class="add-button">เพิ่มลงตะกร้า</button>
        </div>
      `;
      const optRoot = card.querySelector(".options");
      for (const group of groups) {
        const choices = optionsForGroup(group.id);
        const wrap = document.createElement("div");
        wrap.className = "option-group";
        wrap.innerHTML = `<strong>${escapeHtml(group.name)}${group.is_required ? " *" : ""}</strong>`;
        const inputType = group.max_select === 1 ? "radio" : "checkbox";
        for (const choice of choices) {
          const id = `${item.id}-${choice.id}`;
          wrap.insertAdjacentHTML("beforeend", `
            <label class="choice" for="${id}">
              <input id="${id}" type="${inputType}" name="${item.id}-${group.id}" value="${choice.id}">
              <span>${escapeHtml(choice.name)}${Number(choice.price_delta) ? ` +${money(choice.price_delta)}` : ""}</span>
            </label>
          `);
        }
        optRoot.appendChild(wrap);
      }
      card.querySelector("button").addEventListener("click", () => addToCart(item, card));
      list.appendChild(card);
    }
    root.appendChild(section);
  }
  if (!root.innerHTML) root.innerHTML = `<div class="notice warn">ไม่พบเมนูที่ตรงกับการค้นหา</div>`;
}

function addToCart(item, card) {
  const optionIds = [...card.querySelectorAll(".options input:checked")].map((i) => i.value);
  for (const group of optionGroupsForItem(item.id)) {
    const chosen = optionIds.filter((id) => menu.options.find((o) => o.id === id)?.group_id === group.id);
    if (group.is_required && chosen.length === 0) {
      showNotice(`กรุณาเลือก ${group.name}`, "warn");
      return;
    }
    if (chosen.length > group.max_select) {
      showNotice(`${group.name} เลือกได้ไม่เกิน ${group.max_select} รายการ`, "warn");
      return;
    }
  }
  const qty = Number(card.querySelector("input[type=number]").value || 1);
  const note = card.querySelector("textarea").value.trim();
  const unit = itemUnitPrice(item, optionIds);
  cart.push({ menuItemId: item.id, name: item.name, qty, optionItemIds: optionIds, note, unit });
  renderCart();
  showNotice(`${item.name} ถูกเพิ่มลงตะกร้า`, "good");
}

function renderCart() {
  const root = el("cartLines");
  const total = cart.reduce((sum, item) => sum + item.unit * item.qty, 0);
  el("cartTotal").textContent = money(total);
  if (isMobile()) {
    const bar = el("cartBar");
    if (cart.length > 0 && !el("cartPanel").classList.contains("drawer-open")) {
      el("cartBarCount").textContent = `${cart.length} รายการ`;
      el("cartBarTotal").textContent = money(total);
      bar.classList.remove("hidden");
    } else if (cart.length === 0) {
      bar.classList.add("hidden");
      closeCartDrawer();
    }
  }
  root.innerHTML = cart.map((item, index) => {
    const names = item.optionItemIds.map((id) => menu.options.find((o) => o.id === id)?.name).filter(Boolean);
    return `
      <div class="cart-line">
        <div class="cart-line-top">
          <strong>${escapeHtml(item.name)} x${item.qty}</strong>
          <button class="secondary" data-remove="${index}">ลบ</button>
        </div>
        <div class="muted">${escapeHtml(names.join(", "))}</div>
        ${item.note ? `<div>${escapeHtml(item.note)}</div>` : ""}
        <strong>${money(item.unit * item.qty)}</strong>
      </div>
    `;
  }).join("") || `<div class="muted">ยังไม่มีรายการ</div>`;
  document.body.classList.toggle("has-cart", cart.length > 0);
  root.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      cart.splice(Number(btn.dataset.remove), 1);
      renderCart();
    });
  });
}

async function getIdToken() {
  if (config.liffId && window.liff) {
    try {
      await window.liff.init({ liffId: config.liffId });
      if (window.liff.isLoggedIn()) {
        const token = window.liff.getIDToken();
        if (token) return token;
      }
    } catch (_) {
      // LIFF unavailable — fall through to phone-based identity
    }
  }
  return "";
}

async function loadMenu() {
  if (!api.ready) {
    showNotice("กรุณาตั้งค่า Supabase URL และ anon key ก่อนใช้งาน", "warn");
    openConfigDialog(document.querySelector("#configDialog"), document.querySelector("#configForm"));
    return;
  }
  const [status, categories, items, groups, options, links] = await Promise.all([
    api.rest("public_shop_status?select=*"),
    api.rest("menu_categories?select=*&is_active=eq.true&order=sort_order.asc"),
    api.rest("menu_items?select=*&order=sort_order.asc"),
    api.rest("option_groups?select=*"),
    api.rest("option_items?select=*&order=sort_order.asc"),
    api.rest("menu_item_option_groups?select=*"),
  ]);
  const shop = status[0];
  el("shopName").textContent = config.shopName || shop?.shop_name || "กะเพราไฟลุก by MEAL TEAory";
  el("shopStatus").textContent = shop?.is_accepting ? "เปิดรับ" : "ปิดรับ";
  el("shopStatus").className = `status-pill ${shop?.is_accepting ? "paid" : "refund"}`;
  el("heroStatus").textContent = shop?.is_accepting ? "เปิดรับออเดอร์" : "ปิดรับออเดอร์";
  el("heroStatus").className = `status-pill ${shop?.is_accepting ? "paid" : "refund"}`;
  menu = { categories, items, groups, options, links };
  renderCategoryTabs();
  renderMenu();
}

async function createOrder() {
  if (!cart.length) return showNotice("กรุณาเลือกเมนูก่อน", "warn");
  const idToken = await getIdToken();
  const phone = el("phone").value.trim();
  if (!idToken && !phone) {
    return showNotice("กรุณาใส่เบอร์โทรเพื่อให้ร้านติดต่อกลับได้", "warn");
  }
  const body = {
    idToken,
    pickup_type: "ASAP",
    phone: phone || undefined,
    items: cart.map((item) => ({
      menuItemId: item.menuItemId,
      qty: item.qty,
      optionItemIds: item.optionItemIds,
      note: item.note || undefined,
    })),
  };
  const order = await api.fn("create-order", body);
  currentOrder = { ...order, idToken: body.idToken, phone: body.phone };
  localStorage.setItem("dormOrder.lastOrder", JSON.stringify(currentOrder));
  cart = [];
  renderCart();
  showPayment(order);
  showNotice(`สร้างออเดอร์ #${order.order_no} แล้ว`, "good");
}

function showPayment(order) {
  el("paymentTitle").textContent = `ออเดอร์ #${order.order_no}`;
  el("paymentTotal").textContent = money(order.total);
  el("qrPayload").value = order.qr_payload;
  el("qrImage").src = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(order.qr_payload)}`;
  refreshTracking();
  if (isMobile()) {
    closeCartDrawer();
    openPaymentDrawer();
  } else {
    el("paymentPanel").classList.remove("hidden");
    el("paymentPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function verifySlip(dev = false) {
  if (!currentOrder) return showNotice("ยังไม่มีออเดอร์ที่ต้องตรวจสลิป", "warn");
  const body = {
    idToken: currentOrder.idToken,
    order_id: currentOrder.order_id,
    order_token: currentOrder.order_token,
    ...(currentOrder.phone ? { phone: currentOrder.phone } : {}),
  };
  if (dev) {
    body.devSlip = {
      transRef: `DEV-${Date.now()}`,
      amount: Number(currentOrder.total),
      transDate: new Date().toISOString(),
    };
  } else {
    const file = el("slipFile").files[0];
    if (!file) return showNotice("กรุณาเลือกรูปสลิป", "warn");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    body.imageBase64 = String(dataUrl).split(",")[1];
  }
  await api.fn("verify-slip", body);
  showNotice("ชำระเงินสำเร็จ ร้านได้รับออเดอร์แล้ว", "good");
  await refreshTracking();
}

function renderStatusCard(order, items) {
  const STATUS_CONFIG = {
    PAID:            { cls: "status-card-paid",     icon: "✅", title: "ร้านได้รับออเดอร์แล้ว",  sub: "รอยืนยันจากร้านสักครู่..." },
    COOKING:         { cls: "status-card-cooking",  icon: "🔥", title: "กำลังทำอาหาร",          sub: "รออีกสักครู่นะครับ" },
    READY:           { cls: "status-card-ready",    icon: "🍽️", title: "ไปรับได้เลย!",          sub: "อาหารพร้อมแล้ว มารับที่ร้านได้เลยครับ" },
    COMPLETED:       { cls: "status-card-done",     icon: "🙏", title: "รับของแล้ว ขอบคุณ!",    sub: "ขอบคุณที่ใช้บริการ" },
    REFUND_PENDING:  { cls: "status-card-refund",   icon: "💸", title: "รอคืนเงิน",             sub: "" },
    REFUNDED:        { cls: "status-card-refund",   icon: "💸", title: "คืนเงินแล้ว",           sub: "" },
    REJECTED:        { cls: "status-card-refund",   icon: "❌", title: "ออเดอร์ถูกปฏิเสธ",      sub: "" },
  };
  const cfg = STATUS_CONFIG[order.status] || { cls: "", icon: "📋", title: statusLabel(order.status), sub: "" };
  const itemsHtml = items.map((i) =>
    `<li>${escapeHtml(i.name_snapshot)} x${i.qty} · ${money(i.line_total)}</li>`
  ).join("");
  return `
    <div class="status-card ${cfg.cls}">
      <div class="status-card-icon">${cfg.icon}</div>
      <div class="status-card-title">${cfg.title}</div>
      ${cfg.sub ? `<div class="status-card-sub">${cfg.sub}</div>` : ""}
      ${order.reject_reason ? `<div class="status-card-sub">เหตุผล: ${escapeHtml(order.reject_reason)}</div>` : ""}
      <div class="status-card-meta">ออเดอร์ #${order.order_no} · ${money(order.total)} · ${order.pickup_type === "SCHEDULED" ? `เวลารับ ${dateTime(order.pickup_time)}` : "รับเลย"}</div>
      <ul class="item-list">${itemsHtml}</ul>
    </div>
  `;
}

async function refreshTracking() {
  if (!currentOrder || refreshing) return;
  refreshing = true;
  try {
    const data = await api.fn("get-order", {
      idToken: currentOrder.idToken,
      order_id: currentOrder.order_id,
      order_token: currentOrder.order_token,
    });
    const order = data.order;
    el("paymentStatus").textContent = statusLabel(order.status);
    el("paymentStatus").className = `status-pill ${statusClass(order.status)}`;

    const isPendingPayment = order.status === "PENDING_PAYMENT";
    el("paymentSection").classList.toggle("hidden", !isPendingPayment);
    const card = el("statusCard");
    if (isPendingPayment) {
      card.classList.add("hidden");
      card.innerHTML = "";
    } else {
      card.classList.remove("hidden");
      card.innerHTML = renderStatusCard(order, data.items);
    }

    // poll ถี่ขึ้น (4s) เมื่อรอร้านยืนยัน/ทำอาหาร
    const needsFast = ["PAID", "COOKING"].includes(order.status);
    if (needsFast && !fastPollHandle) {
      fastPollHandle = setInterval(refreshTracking, 4000);
    } else if (!needsFast && fastPollHandle) {
      clearInterval(fastPollHandle);
      fastPollHandle = null;
    }
  } catch (e) {
    const card = el("statusCard");
    card.classList.remove("hidden");
    card.innerHTML = `<div class="notice warn" style="margin:14px">${escapeHtml(e.message)}</div>`;
  } finally {
    refreshing = false;
  }
}

function bindEvents() {
  bindConfigDialog((next) => {
    config = next;
    api = new ApiClient(config);
    loadMenu().catch((e) => showNotice(e.message, "warn"));
  });
  el("openDrawerBtn").addEventListener("click", openCartDrawer);
  el("drawerOverlay").addEventListener("click", () => {
    if (el("cartPanel").classList.contains("drawer-open")) closeCartDrawer();
    else closePaymentDrawer();
  });
  el("closePayment").addEventListener("click", closePaymentDrawer);
  el("menuSearch").addEventListener("input", (event) => {
    searchTerm = event.target.value.trim();
    renderMenu();
  });
  el("createOrder").addEventListener("click", () =>
    withLoading(el("createOrder"), createOrder).catch((e) => showNotice(e.message, "warn")));
  el("clearCart").addEventListener("click", () => { cart = []; renderCart(); });
  el("verifySlip").addEventListener("click", () =>
    withLoading(el("verifySlip"), () => verifySlip(false)).catch((e) => showNotice(e.message, "warn")));
  el("devPay").addEventListener("click", () =>
    withLoading(el("devPay"), () => verifySlip(true)).catch((e) => showNotice(e.message, "warn")));

  // ซ่อน devPay บน production (ต้องตั้ง DEV_BYPASS_LINE=1 ที่ Supabase)
  const isLocal = (config.supabaseUrl || "").includes("localhost") || (config.supabaseUrl || "").includes("127.0.0.1");
  if (!isLocal) el("devPay").style.display = "none";
  el("trackLast").addEventListener("click", () => {
    currentOrder = JSON.parse(localStorage.getItem("dormOrder.lastOrder") || "null");
    if (currentOrder) showPayment(currentOrder);
    else showNotice("ยังไม่มีออเดอร์ล่าสุดในเครื่องนี้", "warn");
  });
}

bindEvents();
renderCart();
loadMenu().catch((e) => showNotice(e.message, "warn"));
setInterval(refreshTracking, 15000);
