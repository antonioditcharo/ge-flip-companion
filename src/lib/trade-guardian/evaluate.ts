export type GuardianSide = "BUY" | "SELL";

export type GuidanceStatus =
  | "KEEP"
  | "WAIT"
  | "RAISE_PRICE"
  | "LOWER_PRICE"
  | "REDUCE_QUANTITY"
  | "CANCEL_OR_REASSESS"
  | "EXIT_AT_BREAK_EVEN"
  | "TARGET_REACHED"
  | "STALE_DATA";

export type GuardianInput = {
  side: GuardianSide;
  currentOfferPrice: number;
  currentOfferQuantity: number;
  remainingQuantity: number;
  latestHigh: number | null;
  latestLow: number | null;
  latestHighTime: Date | string | null;
  latestLowTime: Date | string | null;
  averageHigh5m?: number | null;
  averageLow5m?: number | null;
  volume5m?: number | null;
  volume1h?: number | null;
  averageBuyPrice?: number | null;
  minimumProfit: number;
  minimumRoi: number;
  buyLimitRemaining?: number | null;
  evaluatedAt?: Date | string;
  staleAfterMinutes?: number;
  materialPricePercent?: number;
  minimumProfitImpact?: number;
};

export type GuardianResult = {
  side: GuardianSide;
  status: GuidanceStatus;
  actionable: boolean;
  recommendedPrice: number | null;
  recommendedQuantity: number;
  remainingQuantity: number;
  breakEvenPrice: number | null;
  liveExpectedProfit: number | null;
  liveExpectedRoi: number | null;
  quoteAgeMinutes: number | null;
  expiresAt: string;
  reasonCodes: string[];
  message: string;
};

const TAX_RATE_PERCENT = 2;
const TAX_CAP_PER_ITEM = 5_000_000;

function positiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

function validPrice(value: number | null | undefined) {
  return value != null && Number.isSafeInteger(value) && value > 0;
}

function instant(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function geTaxPerItem(unitPrice: number) {
  positiveInteger(unitPrice, "unitPrice");
  return Math.min(TAX_CAP_PER_ITEM, Math.floor(unitPrice * TAX_RATE_PERCENT / 100));
}

export function breakEvenSellPrice(averageBuyPrice: number) {
  positiveInteger(averageBuyPrice, "averageBuyPrice");
  let low = averageBuyPrice;
  let high = Math.max(averageBuyPrice + 1, Math.ceil(averageBuyPrice / 0.98) + 2);
  while (high - geTaxPerItem(high) < averageBuyPrice) high *= 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (middle - geTaxPerItem(middle) >= averageBuyPrice) high = middle;
    else low = middle + 1;
  }
  return low;
}

function ageMinutes(at: Date, quoteTimes: Array<Date | null>) {
  const valid = quoteTimes.filter((value): value is Date => Boolean(value));
  if (!valid.length) return null;
  const oldestRequiredQuote = Math.min(...valid.map((value) => value.getTime()));
  return Math.max(0, (at.getTime() - oldestRequiredQuote) / 60_000);
}

function expiry(at: Date, staleAfterMinutes: number, quoteAge: number | null) {
  const remaining = Math.max(0, staleAfterMinutes - (quoteAge ?? staleAfterMinutes));
  return new Date(at.getTime() + remaining * 60_000).toISOString();
}

function materialDifference(current: number, suggested: number, percent: number) {
  return Math.abs(suggested - current) >= Math.max(1, Math.ceil(current * percent));
}

export function evaluateTradeGuidance(input: GuardianInput): GuardianResult {
  const now = input.evaluatedAt ? new Date(input.evaluatedAt) : new Date();
  if (Number.isNaN(now.getTime())) throw new RangeError("evaluatedAt is invalid.");
  positiveInteger(input.currentOfferPrice, "currentOfferPrice");
  positiveInteger(input.currentOfferQuantity, "currentOfferQuantity");
  nonNegativeInteger(input.remainingQuantity, "remainingQuantity");
  if (!Number.isFinite(input.minimumProfit) || input.minimumProfit < 0) throw new RangeError("minimumProfit must be non-negative.");
  if (!Number.isFinite(input.minimumRoi) || input.minimumRoi < 0) throw new RangeError("minimumRoi must be non-negative.");

  const staleAfter = input.staleAfterMinutes ?? 10;
  const materialPercent = input.materialPricePercent ?? 0.0025;
  const minimumProfitImpact = input.minimumProfitImpact ?? 10_000;
  const highTime = instant(input.latestHighTime);
  const lowTime = instant(input.latestLowTime);
  const quoteAge = ageMinutes(now, [highTime, lowTime]);
  const base = {
    side: input.side,
    remainingQuantity: input.remainingQuantity,
    quoteAgeMinutes: quoteAge,
    expiresAt: expiry(now, staleAfter, quoteAge),
  };

  if (!validPrice(input.latestHigh) || !validPrice(input.latestLow) || quoteAge == null || quoteAge > staleAfter) {
    return {
      ...base,
      status: "STALE_DATA",
      actionable: false,
      recommendedPrice: null,
      recommendedQuantity: input.remainingQuantity,
      breakEvenPrice: input.averageBuyPrice && validPrice(input.averageBuyPrice) ? breakEvenSellPrice(input.averageBuyPrice) : null,
      liveExpectedProfit: null,
      liveExpectedRoi: null,
      reasonCodes: ["QUOTE_MISSING_OR_STALE"],
      message: "Live quotes are missing or stale. Refresh market data before changing this order.",
    };
  }

  const latestHigh = input.latestHigh as number;
  const latestLow = input.latestLow as number;
  const liquidityQuantity = Math.max(1, Math.floor(Math.max(0, input.volume5m ?? 0) * 0.25));
  const buyLimitQuantity = input.buyLimitRemaining == null
    ? input.remainingQuantity
    : Math.max(0, Math.floor(input.buyLimitRemaining));
  const recommendedQuantity = Math.min(input.remainingQuantity, liquidityQuantity, buyLimitQuantity);

  if (recommendedQuantity < input.remainingQuantity) {
    return {
      ...base,
      status: "REDUCE_QUANTITY",
      actionable: true,
      recommendedPrice: input.currentOfferPrice,
      recommendedQuantity,
      breakEvenPrice: input.averageBuyPrice && validPrice(input.averageBuyPrice) ? breakEvenSellPrice(input.averageBuyPrice) : null,
      liveExpectedProfit: null,
      liveExpectedRoi: null,
      reasonCodes: [buyLimitQuantity < input.remainingQuantity ? "BUY_LIMIT_REMAINING" : "LOW_RECENT_VOLUME"],
      message: `Reduce the remaining order quantity from ${input.remainingQuantity.toLocaleString()} to ${recommendedQuantity.toLocaleString()} based on recorded limits and recent public volume.`,
    };
  }

  if (input.side === "BUY") {
    const suggested = Math.max(1, Math.round(input.averageLow5m ?? latestLow));
    const sellReference = Math.max(1, Math.round(input.averageHigh5m ?? latestHigh));
    const profitEach = sellReference - geTaxPerItem(sellReference) - suggested;
    const totalProfit = profitEach * recommendedQuantity;
    const roi = suggested > 0 ? profitEach / suggested : 0;
    if (profitEach <= 0 || totalProfit < input.minimumProfit || roi < input.minimumRoi) {
      return {
        ...base,
        status: "CANCEL_OR_REASSESS",
        actionable: true,
        recommendedPrice: null,
        recommendedQuantity,
        breakEvenPrice: null,
        liveExpectedProfit: totalProfit,
        liveExpectedRoi: roi,
        reasonCodes: ["PROFIT_OR_ROI_BELOW_MINIMUM"],
        message: "The refreshed spread no longer meets the configured profit or ROI minimum. Cancel or reassess the unfilled buy order.",
      };
    }
    const impact = Math.abs(suggested - input.currentOfferPrice) * recommendedQuantity;
    const changed = materialDifference(input.currentOfferPrice, suggested, materialPercent) && impact >= minimumProfitImpact;
    const status: GuidanceStatus = !changed ? "KEEP" : suggested > input.currentOfferPrice ? "RAISE_PRICE" : "LOWER_PRICE";
    return {
      ...base,
      status,
      actionable: changed,
      recommendedPrice: suggested,
      recommendedQuantity,
      breakEvenPrice: null,
      liveExpectedProfit: totalProfit,
      liveExpectedRoi: roi,
      reasonCodes: changed ? [suggested > input.currentOfferPrice ? "BUY_BELOW_RECENT_LOW" : "BUY_ABOVE_RECENT_LOW"] : ["OFFER_WITHIN_TOLERANCE"],
      message: changed
        ? `Review the buy offer at ${suggested.toLocaleString()} GP for the remaining ${recommendedQuantity.toLocaleString()} units.`
        : "The current buy offer remains within the configured movement tolerance.",
    };
  }

  if (!input.averageBuyPrice || !validPrice(input.averageBuyPrice)) {
    return {
      ...base,
      status: "WAIT",
      actionable: false,
      recommendedPrice: null,
      recommendedQuantity,
      breakEvenPrice: null,
      liveExpectedProfit: null,
      liveExpectedRoi: null,
      reasonCodes: ["AVERAGE_BUY_PRICE_REQUIRED"],
      message: "Record the actual buy fills before CoFlipper evaluates a sell offer.",
    };
  }

  const averageBuy = Math.round(input.averageBuyPrice);
  const breakEven = breakEvenSellPrice(averageBuy);
  const suggested = Math.max(breakEven, Math.round(input.averageHigh5m ?? latestHigh));
  const profitEach = suggested - geTaxPerItem(suggested) - averageBuy;
  const totalProfit = profitEach * recommendedQuantity;
  const roi = averageBuy > 0 ? profitEach / averageBuy : 0;
  if (latestHigh < breakEven) {
    return {
      ...base,
      status: "EXIT_AT_BREAK_EVEN",
      actionable: true,
      recommendedPrice: breakEven,
      recommendedQuantity,
      breakEvenPrice: breakEven,
      liveExpectedProfit: 0,
      liveExpectedRoi: 0,
      reasonCodes: ["MARKET_BELOW_BREAK_EVEN"],
      message: `The latest observed high is below break-even. Review an exit near ${breakEven.toLocaleString()} GP and confirm market conditions manually.`,
    };
  }
  const impact = Math.abs(suggested - input.currentOfferPrice) * recommendedQuantity;
  const changed = materialDifference(input.currentOfferPrice, suggested, materialPercent) && impact >= minimumProfitImpact;
  const status: GuidanceStatus = !changed ? "KEEP" : suggested > input.currentOfferPrice ? "RAISE_PRICE" : "LOWER_PRICE";
  return {
    ...base,
    status,
    actionable: changed,
    recommendedPrice: suggested,
    recommendedQuantity,
    breakEvenPrice: breakEven,
    liveExpectedProfit: totalProfit,
    liveExpectedRoi: roi,
    reasonCodes: changed ? [suggested > input.currentOfferPrice ? "SELL_BELOW_RECENT_HIGH" : "SELL_ABOVE_RECENT_HIGH"] : ["OFFER_WITHIN_TOLERANCE"],
    message: changed
      ? `Review the sell offer at ${suggested.toLocaleString()} GP for the remaining ${recommendedQuantity.toLocaleString()} units.`
      : "The current sell offer remains within the configured movement tolerance.",
  };
}
