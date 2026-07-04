import { useEffect, useState } from 'react';
import { api } from '../api';

export default function OrderHistoryScreen({ onSelectOrder }) {
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
          <button key={o.id} className="card" style={{ textAlign: 'left', width: '100%' }} onClick={() => onSelectOrder(o.id)}>
            <div className="row">
              <h3 style={{ fontSize: 16 }}>{o.restaurant.name}</h3>
              <span className="pill">{o.status.replace('_', ' ')}</span>
            </div>
            <p className="muted" style={{ color: '#6b6156' }}>₹{Number(o.total).toFixed(0)} · {new Date(o.placedAt).toLocaleDateString()}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
