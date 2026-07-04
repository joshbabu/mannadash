import { useState } from 'react';
import { api } from '../api';

// Default delivery point for the MVP demo — matches the restaurant list's default search center
const DEFAULT_LAT = 17.45;
const DEFAULT_LNG = 78.39;

export default function CheckoutScreen({ restaurant, orderItems, menuItems, onBack, onOrderPlaced }) {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const lines = orderItems.map((oi) => {
    const item = menuItems.find((m) => m.id === oi.menuItemId);
    return { ...oi, name: item?.name, price: Number(item?.price || 0) };
  });
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);

  async function placeOrder() {
    if (!address.trim()) {
      setError('Add a delivery address so the rider knows where to go');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const order = await api.placeOrder({
        restaurantId: restaurant.id,
        items: orderItems,
        deliveryAddress: address,
        latitude: DEFAULT_LAT,
        longitude: DEFAULT_LNG,
      });
      onOrderPlaced(order);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen">
      <button className="btn-secondary" onClick={onBack} style={{ marginTop: 12, marginBottom: 12 }}>
        ← Back to menu
      </button>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Your order</h1>

      <div className="card">
        {lines.map((l) => (
          <div className="row" key={l.menuItemId} style={{ marginBottom: 8 }}>
            <span>{l.quantity} × {l.name}</span>
            <span>₹{(l.price * l.quantity).toFixed(0)}</span>
          </div>
        ))}
        <div style={{ borderTop: '1px solid #e5ddc9', margin: '10px 0' }} />
        <div className="row" style={{ fontWeight: 600 }}>
          <span>Subtotal</span>
          <span>₹{subtotal.toFixed(0)}</span>
        </div>
        <p className="muted" style={{ color: '#6b6156', marginTop: 4 }}>+ delivery fee, calculated at checkout</p>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15, marginBottom: 10 }}>Delivery address</h3>
        <textarea
          rows={3}
          placeholder="Flat / house number, street, landmark"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd' }}
        />
      </div>

      {error && <div className="error-banner">{error}</div>}

      <button className="btn-primary" onClick={placeOrder} disabled={loading}>
        {loading ? 'Placing order…' : 'Place order'}
      </button>
    </div>
  );
}
