// Mirrors backend/src/orders/delivery-type.util.ts — keep both in sync if the numbers
// change there. The backend is always the authority; this is purely for instant UI
// feedback before the order is actually placed.
export const DELIVERY_TYPES = [
  { value: 'express', label: 'Express', surcharge: 29, etaNote: '~10 min faster', description: 'Real priority — gets the next available rider first' },
  { value: 'standard', label: 'Standard', surcharge: 0, etaNote: '', description: 'Usual delivery time' },
  { value: 'eco', label: 'Eco Saver', surcharge: -5, etaNote: '~10 min slower', description: 'A little slower, a little cheaper' },
];

export const TIP_PRESETS = [0, 20, 30, 50];
