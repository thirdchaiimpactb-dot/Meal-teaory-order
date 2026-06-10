import { assertEquals, assertThrows } from "jsr:@std/assert";
import { priceOrder, PricingError, type MenuIndex } from "./pricing.ts";

const menu: MenuIndex = {
  items: {
    krapao: { name: "กะเพราไฟลุก", basePrice: 50, isAvailable: true, groupIds: ["meat", "spice", "egg"] },
    tea: { name: "ชาเย็น", basePrice: 25, isAvailable: true, groupIds: [] },
    soldout: { name: "ของหมด", basePrice: 40, isAvailable: false, groupIds: [] },
  },
  groups: {
    meat: { name: "เนื้อสัตว์", isRequired: true, maxSelect: 1 },
    spice: { name: "ระดับความเผ็ด", isRequired: true, maxSelect: 1 },
    egg: { name: "ไข่", isRequired: false, maxSelect: 1 },
  },
  options: {
    pork: { groupId: "meat", name: "หมูสับ", priceDelta: 0, isAvailable: true },
    beef: { groupId: "meat", name: "เนื้อ", priceDelta: 10, isAvailable: true },
    mid: { groupId: "spice", name: "เผ็ดปกติ", priceDelta: 0, isAvailable: true },
    friedEgg: { groupId: "egg", name: "ไข่ดาว", priceDelta: 10, isAvailable: true },
  },
};

Deno.test("คิดราคา: base + delta คูณจำนวน และรวม total", () => {
  const r = priceOrder(
    [
      { menuItemId: "krapao", qty: 2, optionItemIds: ["beef", "mid", "friedEgg"], note: "ไม่ใส่ถั่ว" },
      { menuItemId: "tea", qty: 1, optionItemIds: [] },
    ],
    menu,
  );
  assertEquals(r.items[0].unitPrice, 70);     // 50 + 10 + 0 + 10
  assertEquals(r.items[0].lineTotal, 140);
  assertEquals(r.items[0].nameSnapshot, "กะเพราไฟลุก");
  assertEquals(r.items[0].options, [
    { group: "เนื้อสัตว์", name: "เนื้อ", price_delta: 10 },
    { group: "ระดับความเผ็ด", name: "เผ็ดปกติ", price_delta: 0 },
    { group: "ไข่", name: "ไข่ดาว", price_delta: 10 },
  ]);
  assertEquals(r.total, 165);
});

Deno.test("ตะกร้าว่าง / ไม่รู้จักเมนู / เมนูหมด → โยน error ตาม code", () => {
  assertThrows(() => priceOrder([], menu), PricingError, "EMPTY_CART");
  assertThrows(() => priceOrder([{ menuItemId: "nope", qty: 1, optionItemIds: [] }], menu), PricingError, "UNKNOWN_ITEM");
  assertThrows(() => priceOrder([{ menuItemId: "soldout", qty: 1, optionItemIds: [] }], menu), PricingError, "ITEM_UNAVAILABLE");
});

Deno.test("จำนวนเกิน 99 / ไม่เป็นจำนวนเต็ม → BAD_QTY", () => {
  assertThrows(() => priceOrder([{ menuItemId: "tea", qty: 100, optionItemIds: [] }], menu), PricingError, "BAD_QTY");
  assertThrows(() => priceOrder([{ menuItemId: "tea", qty: 1.5, optionItemIds: [] }], menu), PricingError, "BAD_QTY");
});

Deno.test("option ที่ของหมด → OPTION_UNAVAILABLE และราคา delta ทศนิยมปัดถูก", () => {
  const m: MenuIndex = {
    items: { tea: { name: "ชาเย็น", basePrice: 25, isAvailable: true, groupIds: ["sweet"] } },
    groups: { sweet: { name: "หวาน", isRequired: false, maxSelect: 3 } },
    options: {
      half: { groupId: "sweet", name: "หวานครึ่ง", priceDelta: 0.5, isAvailable: true },
      gone: { groupId: "sweet", name: "หมด", priceDelta: 0, isAvailable: false },
    },
  };
  assertThrows(() => priceOrder([{ menuItemId: "tea", qty: 1, optionItemIds: ["gone"] }], m), PricingError, "OPTION_UNAVAILABLE");
  const r = priceOrder([{ menuItemId: "tea", qty: 3, optionItemIds: ["half"] }], m);
  assertEquals(r.items[0].unitPrice, 25.5);
  assertEquals(r.total, 76.5);   // 25.5 * 3 ไม่มี float drift
});

Deno.test("ไม่เลือกกลุ่มบังคับ → REQUIRED_GROUP_MISSING", () => {
  assertThrows(
    () => priceOrder([{ menuItemId: "krapao", qty: 1, optionItemIds: ["beef"] }], menu),
    PricingError,
    "REQUIRED_GROUP_MISSING",
  );
});

Deno.test("เลือกเกิน maxSelect หรือ option ไม่อยู่ในเมนูนั้น → error", () => {
  assertThrows(
    () => priceOrder([{ menuItemId: "krapao", qty: 1, optionItemIds: ["pork", "beef", "mid"] }], menu),
    PricingError,
    "TOO_MANY_IN_GROUP",
  );
  assertThrows(
    () => priceOrder([{ menuItemId: "tea", qty: 1, optionItemIds: ["pork"] }], menu),
    PricingError,
    "OPTION_NOT_ALLOWED",
  );
});
