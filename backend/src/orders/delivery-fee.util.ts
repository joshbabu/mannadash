/**
 * Distance-based delivery fee, replacing the old flat ₹30. Tiered rather than a linear
 * per-km rate, matching how Swiggy/Zomato-style pricing actually reads to a customer —
 * cheap for a genuinely nearby order, a per-km rate kicks in once a rider has real
 * ground to cover, with a cap so an edge-of-radius order doesn't look punitive.
 *
 * Pure function — no DB, no restaurant-specific config (yet). If a restaurant should ever
 * override its own fee schedule, this is the seam to add a param.
 */
const BASE_FEE = 25; // flat fee inside the "practically next door" tier
const BASE_TIER_KM = 3;
const PER_KM_BEYOND_BASE = 6;
const MID_TIER_KM = 7; // 3–7km: the per-km rate above
const FAR_TIER_RATE = 8; // beyond 7km, the rate steepens slightly (further = harder to staff for)
const MAX_FEE = 90; // cap — matches the ~10km service radius restaurants are expected to serve

export function calculateDeliveryFee(distanceMeters: number): number {
  const km = distanceMeters / 1000;

  if (km <= BASE_TIER_KM) return BASE_FEE;

  let fee = BASE_FEE + (Math.min(km, MID_TIER_KM) - BASE_TIER_KM) * PER_KM_BEYOND_BASE;
  if (km > MID_TIER_KM) {
    fee += (km - MID_TIER_KM) * FAR_TIER_RATE;
  }

  return Math.min(MAX_FEE, Math.round(fee));
}
