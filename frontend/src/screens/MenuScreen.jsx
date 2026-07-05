import { useEffect, useState } from 'react';
import { api } from '../api';

export default function MenuScreen({ restaurant, onBack, onCheckout }) {
  const [items, setItems] = useState([]);
  const [cart, setCart] = useState({}); // menuItemId -> quantity
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getMenuItems(restaurant.id)
      .then(setItems)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [restaurant.id]);

  function changeQty(itemId, delta) {
    setCart((prev) => {
      const next = { ...prev };
      const newQty = (next[itemId] || 0) + delta;
      if (newQty <= 0) delete next[itemId];
      else next[itemId] = newQty;
      return next;
    });
  }

  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const cartTotal = items.reduce((sum, item) => sum + (cart[item.id] || 0) * Number(item.price), 0);

  function goToCheckout() {
    const orderItems = Object.entries(cart).map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
    onCheckout(restaurant, orderItems, items);
  }

  return (
    <div className="screen">
      <button className="btn-secondary" onClick={onBack} style={{ marginTop: 12, marginBottom: 12 }}>
        ← Back
      </button>
      <h1 style={{ fontSize: 24 }}>{restaurant.name}</h1>
      <p className="muted">{restaurant.cuisineType}</p>

      {error && <div className="error-banner">{error}</div>}
      {loading && <p className="muted">Loading menu…</p>}
      {!loading && !error && items.length === 0 && (
        <div className="card" style={{ textAlign: 'center', marginTop: 16 }}>
          <p style={{ margin: 0 }}>No items on the menu yet.</p>
          <p className="muted" style={{ color: '#6b6156', marginTop: 4 }}>Check back once the restaurant adds its menu.</p>
        </div>
      )}

      <div className="stack" style={{ marginTop: 16 }}>
        {items.map((item) => (
          <div key={item.id} className="card">
            <div className="row">
              <div>
                <h3 style={{ fontSize: 16 }}>{item.name}</h3>
                <p className="muted" style={{ color: '#6b6156' }}>₹{Number(item.price).toFixed(0)}</p>
              </div>
              {!item.isAvailable ? (
                <span className="muted" style={{ color: '#8a8378' }}>Sold out</span>
              ) : cart[item.id] ? (
                <div className="qty-control">
                  <button onClick={() => changeQty(item.id, -1)}>−</button>
                  <span style={{ minWidth: 16, textAlign: 'center' }}>{cart[item.id]}</span>
                  <button onClick={() => changeQty(item.id, 1)}>+</button>
                </div>
              ) : (
                <button className="btn-secondary" style={{ color: 'var(--chili-dark)', borderColor: 'var(--chili)' }} onClick={() => changeQty(item.id, 1)}>
                  Add
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {cartCount > 0 && (
        <div style={{ position: 'fixed', bottom: 20, left: 20, right: 20, maxWidth: 440, margin: '0 auto' }}>
          <button className="btn-primary" onClick={goToCheckout}>
            View cart · {cartCount} item{cartCount > 1 ? 's' : ''} · ₹{cartTotal.toFixed(0)}
          </button>
        </div>
      )}
    </div>
  );
}
