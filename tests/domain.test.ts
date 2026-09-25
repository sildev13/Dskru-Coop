import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { initialState } from "../src/lib/seed";
import { completePurchase, createPurchase } from "../src/lib/domain";
const purchase = (qty = 1) => ({
  items: [{ id: "water", qty }],
  paymentMethod: "cash" as const,
  requestId: randomUUID(),
});
test("checkout snapshots server prices and completion is idempotent", () => {
  const state = initialState();
  const input = purchase(2);
  const order = createPurchase(state, input);
  assert.equal(order.total, 14);
  assert.equal(order.status, "pending");
  assert.equal(state.items[0].stock, 48);
  assert.equal(createPurchase(state, input).id, order.id);
  assert.equal(state.transactions.length, 1);
  state.items[0].price = 20;
  completePurchase(state, order.id);
  completePurchase(state, order.id);
  assert.equal(state.items[0].stock, 46);
  assert.equal(state.settings.cooperativeBalance, 14);
  assert.equal(order.items[0].price, 7);
});
test("competing payments cannot oversell and failed confirmation changes nothing", () => {
  const state = initialState();
  state.items[0].stock = 1;
  const first = createPurchase(state, purchase());
  const second = createPurchase(state, purchase());
  completePurchase(state, first.id);
  const before = structuredClone(state);
  assert.throws(() => completePurchase(state, second.id), /ไม่เพียงพอ/);
  assert.deepEqual(state, before);
});
test("all stock is checked before any deduction", () => {
  const state = initialState();
  const order = createPurchase(state, {
    ...purchase(),
    items: [
      { id: "water", qty: 2 },
      { id: "milk", qty: 1 },
    ],
  });
  state.items[1].stock = 0;
  assert.throws(() => completePurchase(state, order.id));
  assert.equal(state.items[0].stock, 48);
  assert.equal(state.settings.cooperativeBalance, 0);
});
test("decimal currency uses whole satang", () => {
  const state = initialState();
  state.items[0].price = 0.1;
  const order = createPurchase(state, purchase(3));
  assert.equal(order.total, 0.3);
  state.settings.cooperativeBalance = 0.2;
  completePurchase(state, order.id);
  assert.equal(state.settings.cooperativeBalance, 0.5);
});
test("closed shop, duplicate lines, negative quantity and cancelled orders are rejected", () => {
  const state = initialState();
  state.settings.storeOpen = false;
  assert.throws(() => createPurchase(state, purchase()));
  state.settings.storeOpen = true;
  assert.throws(() => createPurchase(state, purchase(-1)));
  assert.throws(() =>
    createPurchase(state, {
      ...purchase(),
      items: [
        { id: "water", qty: 1 },
        { id: "water", qty: 1 },
      ],
    }),
  );
  const order = createPurchase(state, purchase());
  order.status = "cancelled";
  assert.throws(() => completePurchase(state, order.id));
});
