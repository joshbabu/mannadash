import { useEffect, useState } from 'react';
import { api } from '../api';

export default function OrderHistoryScreen({ onSelectOrder, onReorder }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getMyOrders()
      .then(setOrders)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="screen">
      <h1 style={{ fontSize: 26, marginTop: 12 }}>Your orders</h1>

      {error && <div className="error-banner">{error}</div>}
      {loading && <p className="muted">Loading…</p>}
      {!loading && orders.length === 0 && <p className="muted">No orders yet — go find something good to eat.</p>}

      <div className="stack" style={{ marginTop: 12 }}>
        {orders.map((o) => (
          <div key={o.id} className="card">
            <button style={{ textAlign: 'left', width: '100%', background: 'none', padding: 0 }} onClick={() => onSelectOrder(o.id)}>
              <div className="row">
                <h3 style={{ fontSize: 16 }}>{o.restaurant.name}</h3>
                <span className="pill">{o.status.replaceAll('_', ' ')}</span>
              </div>
              <p className="muted" style={{ color: '#6b6156' }}>₹{Number(o.total).toFixed(0)} · {new Date(o.placedAt).toLocaleDateString()}</p>
              {o.items?.length > 0 && (
                <p className="muted" style={{ color: '#6b6156', fontSize: 13, margin: '2px 0 0' }}>
                  {o.items.reduce((n, i) => n + i.quantity, 0)} item{o.items.reduce((n, i) => n + i.quantity, 0) === 1 ? '' : 's'} · {o.items[0].menuItem?.name}
                  {o.items.length > 1 ? '…' : ''}
                </p>
              )}
            </button>
            <button
              className="btn-secondary"
              style={{ color: 'var(--chili-dark)', borderColor: 'var(--chili)', marginTop: 10 }}
              onClick={() => onReorder(o)}
            >
              🔁 Reorder
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
