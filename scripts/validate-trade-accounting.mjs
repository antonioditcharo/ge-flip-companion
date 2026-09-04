import assert from "node:assert/strict";

const TAX_RATE_PERCENT = 2n;
const TAX_DIVISOR = 100n;
const TAX_CAP_PER_ITEM = 5_000_000n;

function geTaxPerItem(unitPrice) {
  const price = BigInt(unitPrice);

  if (price <= 0n) {
    throw new RangeError("Unit price must be positive.");
  }

  const uncappedTax = price * TAX_RATE_PERCENT / TAX_DIVISOR;
  return uncappedTax < TAX_CAP_PER_ITEM
    ? uncappedTax
    : TAX_CAP_PER_ITEM;
}

function geTaxForFill(unitPrice, quantity) {
  const count = BigInt(quantity);

  if (count <= 0n) {
    throw new RangeError("Quantity must be positive.");
  }

  return geTaxPerItem(unitPrice) * count;
}

function profitForFills({ buys, sells }) {
  const buyCost = buys.reduce(
    (total, fill) =>
      total + BigInt(fill.unitPrice) * BigInt(fill.quantity),
    0n,
  );

  const grossProceeds = sells.reduce(
    (total, fill) =>
      total + BigInt(fill.unitPrice) * BigInt(fill.quantity),
    0n,
  );

  const tax = sells.reduce(
    (total, fill) =>
      total + geTaxForFill(fill.unitPrice, fill.quantity),
    0n,
  );

  return {
    buyCost,
    grossProceeds,
    tax,
    profit: grossProceeds - tax - buyCost,
  };
}

assert.equal(geTaxPerItem(1), 0n);
assert.equal(geTaxPerItem(49), 0n);
assert.equal(geTaxPerItem(50), 1n);
assert.equal(geTaxPerItem(1_000), 20n);
assert.equal(geTaxPerItem(249_999_999), 4_999_999n);
assert.equal(geTaxPerItem(250_000_000), 5_000_000n);
assert.equal(geTaxPerItem(300_000_000), 5_000_000n);

assert.equal(geTaxForFill(1_000, 100), 2_000n);
assert.equal(
  geTaxForFill(300_000_000, 2),
  10_000_000n,
);

assert.throws(() => geTaxPerItem(0), RangeError);
assert.throws(() => geTaxForFill(100, 0), RangeError);

assert.deepEqual(
  profitForFills({
    buys: [{ unitPrice: 5, quantity: 50_000 }],
    sells: [
      { unitPrice: 6, quantity: 25_000 },
      { unitPrice: 6, quantity: 25_000 },
    ],
  }),
  {
    buyCost: 250_000n,
    grossProceeds: 300_000n,
    tax: 0n,
    profit: 50_000n,
  },
);

assert.deepEqual(
  profitForFills({
    buys: [
      { unitPrice: 130_000, quantity: 3 },
      { unitPrice: 132_289, quantity: 4 },
    ],
    sells: [
      { unitPrice: 140_000, quantity: 3 },
      { unitPrice: 144_518, quantity: 4 },
    ],
  }),
  {
    buyCost: 919_156n,
    grossProceeds: 998_072n,
    tax: 19_960n,
    profit: 58_956n,
  },
);

const partialFills = profitForFills({
  buys: [
    { unitPrice: 72, quantity: 5_000 },
    { unitPrice: 72, quantity: 8_000 },
  ],
  sells: [
    { unitPrice: 76, quantity: 4_000 },
    { unitPrice: 77, quantity: 9_000 },
  ],
});

assert.equal(partialFills.buyCost, 936_000n);
assert.equal(partialFills.grossProceeds, 997_000n);
assert.equal(partialFills.tax, 13_000n);
assert.equal(partialFills.profit, 48_000n);

console.log("Trade accounting validation passed.");
console.table([
  {
    case: "49 GP rounding",
    tax: geTaxPerItem(49).toString(),
  },
  {
    case: "50 GP breakpoint",
    tax: geTaxPerItem(50).toString(),
  },
  {
    case: "250m GP cap",
    tax: geTaxPerItem(250_000_000).toString(),
  },
  {
    case: "Two 300m GP items",
    tax: geTaxForFill(300_000_000, 2).toString(),
  },
  {
    case: "Earth rune reconstruction",
    profit: "50000",
  },
]);
