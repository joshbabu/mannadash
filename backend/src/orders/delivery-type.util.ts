export type DeliveryType = 'standard' | 'express' | 'eco';

/**
 * Three delivery speed/cost tiers. Kept in one place, same reasoning as
 * delivery-fee.util.ts, so the numbers are easy to find and tune later without hunting
 * through the service.
 *
 * Express isn't just a price tag — it gets REAL priority in the rider-assignment sweep
 * (see OrdersService.retryUnassignedReadyOrders), so an Express order genuinely gets
 * matched to an available rider before a Standard or Eco one sitting in the same backlog.
 * That's the honest, buildable version of "faster" with a single shared rider pool: no
 * dedicated Express riders yet, but real queue priority when riders are scarce.
 */
export const DELIVERY_TYPE_CONFIG: Record<DeliveryType, {
  surcharge: number; // added to total; negative means a discount
  priorityWeight: number; // lower sorts first in the assignment queue
  etaAdjustmentSeconds: number; // added to the estimated delivery time (negative = faster)
  label: string;
}> = {
  express: { surcharge: 29, priorityWeight: 0, etaAdjustmentSeconds: -10 * 60, label: 'Express' },
  standard: { surcharge: 0, priorityWeight: 1, etaAdjustmentSeconds: 0, label: 'Standard' },
  eco: { surcharge: -5, priorityWeight: 2, etaAdjustmentSeconds: 10 * 60, label: 'Eco Saver' },
};

export function isValidDeliveryType(value: unknown): value is DeliveryType {
  return value === 'standard' || value === 'express' || value === 'eco';
}
