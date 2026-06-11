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

function renderCategoryTabs() {
  const root = el("categoryTabs");
  if (!root) return;
  const tabs = [
    `<button class="category-chip ${activeCategoryId ? "" : "active"}" data-category="">ทั้งหมด</button>`,
    ...menu.categories.map((cat) =>
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
    await window.liff.init({ liffId: config.liffId });
    if (!window.liff.isLoggedIn()) window.liff.login();
    const token = window.liff.getIDToken();
    if (token) return token;
  }
  return el("devToken").value.trim();
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
  const pickupType = el("pickupType").value;
  if (pickupType === "SCHEDULED" && !el("pickupTime").value) {
    return showNotice("กรุณาเลือกเวลารับ", "warn");
  }
  const body = {
    idToken: await getIdToken(),
    pickup_type: pickupType,
    phone: el("phone").value.trim() || undefined,
    pickup_time: pickupType === "SCHEDULED" ? new Date(el("pickupTime").value).toISOString() : undefined,
    items: cart.map((item) => ({
      menuItemId: item.menuItemId,
      qty: item.qty,
      optionItemIds: item.optionItemIds,
      note: item.note || undefined,
    })),
  };
  const order = await api.fn("create-order", body);
  currentOrder = { ...order, idToken: body.idToken };
  localStorage.setItem("dormOrder.lastOrder", JSON.stringify(currentOrder));
  cart = [];
  renderCart();
  showPayment(order);
  showNotice(`สร้างออเดอร์ #${order.order_no} แล้ว`, "good");
}

function showPayment(order) {
  el("paymentPanel").classList.remove("hidden");
  el("paymentTitle").textContent = `ออเดอร์ #${order.order_no}`;
  el("paymentTotal").textContent = money(order.total);
  el("qrPayload").value = order.qr_payload;
  el("qrImage").src = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(order.qr_payload)}`;
  refreshTracking();
  el("paymentPanel").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function verifySlip(dev = false) {
  if (!currentOrder) return showNotice("ยังไม่มีออเดอร์ที่ต้องตรวจสลิป", "warn");
  const body = { idToken: currentOrder.idToken, order_id: currentOrder.order_id };
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

async function refreshTracking() {
  if (!currentOrder) return;
  try {
    const data = await api.fn("get-order", {
      idToken: currentOrder.idToken,
      order_id: currentOrder.order_id,
    });
    const order = data.order;
    el("paymentStatus").textContent = statusLabel(order.status);
    el("paymentStatus").className = `status-pill ${statusClass(order.status)}`;
    el("tracking").innerHTML = `
      <h3>สถานะ</h3>
      <p><strong>${statusLabel(order.status)}</strong> · สร้างเมื่อ ${dateTime(order.created_at)}</p>
      ${order.pickup_type === "SCHEDULED" ? `<p>เวลารับ ${dateTime(order.pickup_time)}</p>` : `<p>เวลารับ รับเลย</p>`}
      ${order.reject_reason ? `<p>เหตุผล: ${escapeHtml(order.reject_reason)}</p>` : ""}
      <ul class="item-list">
        ${data.items.map((i) => `<li>${escapeHtml(i.name_snapshot)} x${i.qty} · ${money(i.line_total)}</li>`).join("")}
      </ul>
    `;
  } catch (e) {
    el("tracking").innerHTML = `<div class="notice warn">${escapeHtml(e.message)}</div>`;
  }
}

function bindEvents() {
  bindConfigDialog((next) => {
    config = next;
    api = new ApiClient(config);
    loadMenu().catch((e) => showNotice(e.message, "warn"));
  });
  el("pickupType").addEventListener("change", () => {
    el("pickupTimeWrap").classList.toggle("hidden", el("pickupType").value !== "SCHEDULED");
  });
  el("menuSearch").addEventListener("input", (event) => {
    searchTerm = event.target.value.trim();
    renderMenu();
  });
  el("createOrder").addEventListener("click", () => createOrder().catch((e) => showNotice(e.message, "warn")));
  el("clearCart").addEventListener("click", () => { cart = []; renderCart(); });
  el("verifySlip").addEventListener("click", () => verifySlip(false).catch((e) => showNotice(e.message, "warn")));
  el("devPay").addEventListener("click", () => verifySlip(true).catch((e) => showNotice(e.message, "warn")));
  el("trackLast").addEventListener("click", () => {
    currentOrder = JSON.parse(localStorage.getItem("dormOrder.lastOrder") || "null");
    if (currentOrder) showPayment(currentOrder);
    else showNotice("ยังไม่มีออเดอร์ล่าสุดในเครื่องนี้", "warn");
  });
}

bindEvents();
renderCart();
loadMenu().catch((e) => showNotice(e.message, "warn"));
setInterval(refreshTracking, 10000);
