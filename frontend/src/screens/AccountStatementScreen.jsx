import { useEffect, useState } from 'react';
import { api } from '../api';

export default function AccountStatementScreen({ onBack }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getMyOrders().then(setOrders).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, []);

  // Only orders that actually represent real money changing hands count toward the
  // statement total — a cancelled order was never actually paid for
  const settledOrders = orders.filter((o) => o.status !== 'cancelled');
  const totalSpent = settledOrders.reduce((sum, o) => sum + Number(o.total), 0);

  return (
    <div className="screen">
      <button className="btn-secondary" onClick={onBack} style={{ marginBottom: 16 }}>
        ← Back
      </button>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Account statement</h1>
      <p className="muted" style={{ marginBottom: 16 }}>Every order, in one place — cancelled orders are shown but excluded from your total.</p>

      {error && <div className="error-banner">{error}</div>}
      {loading && <p className="muted">Loading…</p>}

      {!loading && orders.length === 0 && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p>No orders yet.</p>
        </div>
      )}

      {!loading && orders.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="muted" style={{ fontSize: 12 }}>Total spent ({settledOrders.length} order{settledOrders.length === 1 ? '' : 's'})</p>
          <p style={{ fontSize: 26, fontWeight: 800, color: 'var(--charcoal)' }}>₹{totalSpent.toFixed(0)}</p>
        </div>
      )}

      <div className="stack">
        {orders.map((o) => (
          <div key={o.id} className="card" style={{ opacity: o.status === 'cancelled' ? 0.6 : 1 }}>
            <div className="row">
              <div>
                <p style={{ fontWeight: 700, color: 'var(--charcoal)' }}>{o.restaurant?.name}</p>
                <p className="muted" style={{ fontSize: 13 }}>
                  {new Date(o.placedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}
                  {o.paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online'}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontWeight: 800, color: 'var(--charcoal)' }}>₹{Number(o.total).toFixed(0)}</p>
                <p className="muted" style={{ fontSize: 12, textTransform: 'capitalize' }}>{o.status.replaceAll('_', ' ')}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
