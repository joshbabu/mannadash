import { calculateDeliveryFee } from './delivery-fee.util';

describe('calculateDeliveryFee', () => {
  it('charges the flat base fee at and inside the 3km tier', () => {
    expect(calculateDeliveryFee(0)).toBe(25);
    expect(calculateDeliveryFee(1200)).toBe(25);
    expect(calculateDeliveryFee(3000)).toBe(25);
  });

  it('charges the mid-tier per-km rate between 3km and 7km', () => {
    expect(calculateDeliveryFee(5000)).toBe(37); // 25 + 2*6
    expect(calculateDeliveryFee(7000)).toBe(49); // 25 + 4*6
  });

  it('steepens to the far-tier rate beyond 7km', () => {
    expect(calculateDeliveryFee(9000)).toBe(65); // 49 + 2*8
  });

  it('reaches exactly ₹113 at 15km — the number the ₹115 cap was specifically set around, not an arbitrary round figure', () => {
    expect(calculateDeliveryFee(15000)).toBe(113); // 49 + 8*8
  });

  it('caps at ₹115 beyond that, rather than scaling indefinitely', () => {
    expect(calculateDeliveryFee(20000)).toBe(115);
    expect(calculateDeliveryFee(100000)).toBe(115);
  });
});
