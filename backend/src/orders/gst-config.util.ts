/**
 * Platform fee and GST — OFF by default, so nothing about today's pricing changes unless
 * these env vars are explicitly set. Two genuinely different things bundled under one
 * "Taxes & Charges" umbrella in the UI, same as the Swiggy/Zomato reference:
 *
 *  - PLATFORM_FEE_AMOUNT: MannaDash's own charge, not a tax. Doesn't need GST
 *    registration to turn on — it's just a business decision. Defaults to 0.
 *
 *  - GST_ENABLED + the two rate env vars: this is real tax law (CGST Act section 9(5) —
 *    the platform, not the individual restaurant, is liable to collect and remit GST on
 *    food orders once it's registered as an e-commerce operator). MUST stay false until
 *    MannaDash is actually GST-registered — turning this on before then would mean
 *    charging customers a tax that isn't actually going anywhere real. The specific rates
 *    below (5% on food, 18% on delivery) reflect the commonly-cited rates as of this
 *    writing, NOT verified tax advice — confirm the real applicable rates with an
 *    accountant before ever setting GST_ENABLED=true in production.
 *
 * Packaging fee is deliberately NOT here — unlike platform fee/GST, it's genuinely
 * restaurant-specific (Restaurant.packagingFee, set via the restaurant's own Settings),
 * not a platform-wide env var. This file still owns the platform-wide CAP on it though
 * (PACKAGING_FEE_CAP), matching the Zomato-style "restaurant sets it, platform limits it"
 * model — a restaurant can never stack an excessive packaging charge regardless of what
 * they configure. See clampPackagingFee().
 */

function envFlag(name: string): boolean {
  return process.env[name] === 'true';
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Defaults to ₹30 — a reasonable starting cap in the same range as Zomato's ₹45 ceiling,
// not verified against any specific competitive research; adjust via PACKAGING_FEE_CAP
// as a real business decision, not something to treat as fixed.
export function clampPackagingFee(restaurantPackagingFee: number | null | undefined): number {
  const cap = envNumber('PACKAGING_FEE_CAP', 30);
  const raw = Math.max(0, Number(restaurantPackagingFee) || 0);
  return Math.min(raw, cap);
}

export interface TaxesAndFees {
  platformFeeAmount: number;
  packagingFeeAmount: number;
  restaurantGstAmount: number;
  deliveryGstAmount: number;
  total: number;
}

export function computeTaxesAndFees(
  subtotal: number,
  deliveryFee: number,
  restaurantPackagingFee: number | null | undefined = null,
): TaxesAndFees {
  const platformFeeAmount = Math.max(0, envNumber('PLATFORM_FEE_AMOUNT', 0));
  const packagingFeeAmount = clampPackagingFee(restaurantPackagingFee);

  const gstEnabled = envFlag('GST_ENABLED');
  const restaurantGstAmount = gstEnabled
    ? Math.round(subtotal * (envNumber('GST_RESTAURANT_RATE_PERCENT', 5) / 100) * 100) / 100
    : 0;
  const deliveryGstAmount = gstEnabled
    ? Math.round(deliveryFee * (envNumber('GST_DELIVERY_RATE_PERCENT', 18) / 100) * 100) / 100
    : 0;

  return {
    platformFeeAmount,
    packagingFeeAmount,
    restaurantGstAmount,
    deliveryGstAmount,
    total: platformFeeAmount + packagingFeeAmount + restaurantGstAmount + deliveryGstAmount,
  };
}
