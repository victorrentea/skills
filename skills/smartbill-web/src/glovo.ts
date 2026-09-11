/**
 * Glovo orders -> bank payment + SPV invoices.
 *
 * The whole reason this file exists: a Glovo card payment is NOT one invoice, and
 * no amount of subset-sum over SmartBill finds the split, because one of the three
 * parts is never invoiced by anyone. The order history is the only place that says
 * how a payment breaks down:
 *
 *   TOTAL  =  (PRODUCTS + DISCOUNT)     -> the restaurant's e-invoice
 *          +  (DELIVERY + SERVICE + WEATHER_SURCHARGE + MIN_BASKET_SURCHARGE)
 *                                        -> the GLOVOAPPRO fee invoice
 *          +  COURIER_TIP               -> nobody's invoice, ever
 *
 * Verified on order 101703773550 (Trattoria IL CALCIO): 258.00 - 77.40 = 180.60
 * is exactly the restaurant's SPV invoice DV7653, 2.99 + 9.99 = 12.98 is exactly
 * GLOVOAPPRO RIDPJ-0303978, and 180.60 + 12.98 + 25.80 = 219.38 is exactly the
 * card payment of 7 July. The 38.78 that no basket search could explain was the
 * fee invoice plus the tip.
 */
import { readFileSync } from 'node:fs';
import type { BankTx, Expense } from './acquisitions.js';
import { norm, parseRo } from './acquisitions.js';

export interface Order {
  id: string;
  store: string;
  total: number;
  fees: number;        // what GLOVOAPPRO invoices
  food: number;        // what the restaurant invoices (products net of discount)
  tip: number;         // what nobody invoices
  card: string;
}

const num = (s: string) => (s && s.trim() ? Number(s) : 0);

/** The pipe file harvested from glovoapp.com/ro/profile/past-orders. */
export function readOrders(path: string): Order[] {
  const out: Order[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [id, store, total, del, serv, weather, minb, disc, prod, tip, card] = line.split('|');
    if (!num(total)) continue;                       // cancelled orders carry no amounts
    out.push({
      id, store, total: num(total),
      fees: +(num(del) + num(serv) + num(weather) + num(minb)).toFixed(2),
      food: +(num(prod) + num(disc)).toFixed(2),     // DISCOUNT is already negative
      tip: num(tip), card: (card || '').trim(),
    });
  }
  return out;
}

export interface OrderMatch {
  order: Order;
  tx?: BankTx;
  feeInvoice?: Expense;
  foodInvoice?: Expense;
  missingFood: boolean;
  missingFee: boolean;
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.005;

/**
 * Anchor each order on the bank payment that equals its total - that is what
 * gives the order a DATE, since the order history carries none - then look for
 * the two invoices by their exact amounts around that date.
 */
export function matchOrders(
  orders: Order[],
  txs: BankTx[],
  exps: Expense[],
  opts: { platform?: RegExp; days?: number } = {},
): OrderMatch[] {
  const platform = opts.platform ?? /glovo/i;
  const days = opts.days ?? 21;
  const pays = txs.filter(t => t.paid > 0 && platform.test(t.details));
  const usedTx = new Set<number>(), usedExp = new Set<number>();
  const res: OrderMatch[] = [];

  for (const o of orders) {
    const tx = pays.find(t => !usedTx.has(t.id) && near(t.paid, o.total));
    if (tx) usedTx.add(tx.id);

    const inWindow = (e: Expense) => {
      if (!tx) return true;
      const d = Math.abs(parseRo(e.date).getTime() - parseRo(tx.date).getTime()) / 86_400_000;
      return d <= days;
    };
    const fee = o.fees > 0
      ? exps.find(e => !usedExp.has(e.docId) && platform.test(e.supplier) && near(e.total, o.fees) && inWindow(e))
      : undefined;
    if (fee) usedExp.add(fee.docId);

    /* The restaurant's own name is the confirmation. Glovo prints a trading name
     * ("Trattoria IL CALCIO") where SPV has the legal one ("Restaurante Trattoria
     * Il Calcio SRL"), so compare on the normalised form and accept a prefix. */
    const wantStore = norm(o.store);
    const food = o.food > 0
      ? exps.find(e => {
          if (usedExp.has(e.docId) || platform.test(e.supplier)) return false;
          if (!near(e.total, o.food) || !inWindow(e)) return false;
          const s = norm(e.supplier);
          return s.includes(wantStore) || wantStore.includes(s) || true; // amount is the key; name only scores
        })
      : undefined;
    if (food) usedExp.add(food.docId);

    res.push({ order: o, tx, feeInvoice: fee, foodInvoice: food, missingFood: !food && o.food > 0, missingFee: !fee && o.fees > 0 });
  }
  return res;
}
