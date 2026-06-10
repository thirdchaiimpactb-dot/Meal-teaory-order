export type MenuIndex = {
  items: Record<string, { name: string; basePrice: number; isAvailable: boolean; groupIds: string[] }>;
  groups: Record<string, { name: string; isRequired: boolean; maxSelect: number }>;
  options: Record<string, { groupId: string; name: string; priceDelta: number; isAvailable: boolean }>;
};

export type CartItem = { menuItemId: string; qty: number; optionItemIds: string[]; note?: string };

export type PricedItem = {
  menuItemId: string;
  nameSnapshot: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  options: { group: string; name: string; price_delta: number }[];
  note?: string;
};

export class PricingError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const baht = (n: number) => Math.round(n * 100) / 100;

export function priceOrder(cart: CartItem[], menu: MenuIndex): { items: PricedItem[]; total: number } {
  if (cart.length === 0) throw new PricingError("EMPTY_CART");
  const items = cart.map((c) => {
    const item = menu.items[c.menuItemId];
    if (!item) throw new PricingError("UNKNOWN_ITEM");
    if (!item.isAvailable) throw new PricingError("ITEM_UNAVAILABLE");
    if (!Number.isInteger(c.qty) || c.qty < 1 || c.qty > 99) throw new PricingError("BAD_QTY");

    const perGroup = new Map<string, number>();
    let unitPrice = item.basePrice;
    const options = c.optionItemIds.map((oid) => {
      const opt = menu.options[oid];
      if (!opt) throw new PricingError("UNKNOWN_OPTION");
      if (!opt.isAvailable) throw new PricingError("OPTION_UNAVAILABLE");
      if (!item.groupIds.includes(opt.groupId)) throw new PricingError("OPTION_NOT_ALLOWED");
      const n = (perGroup.get(opt.groupId) ?? 0) + 1;
      perGroup.set(opt.groupId, n);
      if (n > menu.groups[opt.groupId].maxSelect) throw new PricingError("TOO_MANY_IN_GROUP");
      unitPrice = baht(unitPrice + opt.priceDelta);
      return { group: menu.groups[opt.groupId].name, name: opt.name, price_delta: opt.priceDelta };
    });

    for (const gid of item.groupIds) {
      if (menu.groups[gid].isRequired && !perGroup.has(gid)) {
        throw new PricingError("REQUIRED_GROUP_MISSING");
      }
    }

    return {
      menuItemId: c.menuItemId,
      nameSnapshot: item.name,
      qty: c.qty,
      unitPrice,
      lineTotal: baht(unitPrice * c.qty),
      options,
      note: c.note,
    };
  });
  return { items, total: baht(items.reduce((s, i) => s + i.lineTotal, 0)) };
}
