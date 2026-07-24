import { useEffect, useState } from 'react';
import { api } from '../api';
import { isRestaurantOpenNow } from '../utils/restaurant-hours';
import ComplaintModal from './ComplaintModal';

export default function OrderHistoryScreen({ onSelectOrder, onReorder, onViewRestaurant }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwChanged, setPwChanged] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [complaintModalOrderId, setComplaintModalOrderId] = useState(null);
  const [complaintsByOrderId, setComplaintsByOrderId] = useState({});

  async function changePassword() {
    setPwError('');
    setChangingPw(true);
    try {
      await api.changePassword({ currentPassword: currentPw, newPassword: newPw });
      setCurrentPw('');
      setNewPw('');
      setPwChanged(true);
      setTimeout(() => setPwChanged(false), 3000);
    } catch (err) {
      setPwError(err.message);
    } finally {
      setChangingPw(false);
    }
  }


  useEffect(() => {
    api
      .getMyOrders()
      .then(setOrders)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    api.getMyComplaints().then((complaints) => {
      const grouped = {};
      for (const c of complaints) {
        const orderId = c.order.id;
        if (!grouped[orderId]) grouped[orderId] = [];
        grouped[orderId].push(c);
      }
      setComplaintsByOrderId(grouped);
    }).catch(() => {});
  }, []);

  function handleComplaintFiled(complaint) {
    setComplaintsByOrderId((prev) => ({
      ...prev,
      [complaintModalOrderId]: [...(prev[complaintModalOrderId] || []), complaint],
    }));
  }

  return (
    <div className="screen">
      <h1 style={{ fontSize: 26, marginTop: 12 }}>Your orders</h1>

      {error && <div className="error-banner">{error}</div>}
      {loading && [0, 1, 2].map((i) => (
        <div className="skeleton-card" key={i}>
          <div className="skeleton-block" style={{ height: 15, width: '45%', marginBottom: 10 }} />
          <div className="skeleton-block" style={{ height: 12, width: '65%', marginBottom: 8 }} />
          <div className="skeleton-block" style={{ height: 12, width: '25%' }} />
        </div>
      ))}
      {!loading && orders.length === 0 && <p className="muted">No orders yet — go find something good to eat.</p>}

      <div className="stack" style={{ marginTop: 12 }}>
        {orders.map((o) => (
          <div key={o.id} className="card">
            <button style={{ textAlign: 'left', width: '100%', background: 'none', padding: 0 }} onClick={() => onSelectOrder(o.id)}>
              <div className="row">
                <h3 style={{ fontSize: 16 }}>
                  {o.restaurant.name}
                  {!isRestaurantOpenNow(o.restaurant) && (
                    <span className="pill" style={{ background: '#f0e5e5', color: '#8a3a3a', marginLeft: 8, fontSize: 11 }}>Closed now</span>
                  )}
                </h3>
                <span
                  className="pill"
                  title={o.status === 'cancelled' && o.cancelReason === 'acceptance_timeout' ? "The restaurant didn't respond in time" : undefined}
                >
                  {o.status.replaceAll('_', ' ')}
                  {o.status === 'cancelled' && o.cancelReason === 'acceptance_timeout' ? ' ⏰' : ''}
                </span>
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
              style={{ marginTop: 10, marginRight: 8 }}
              onClick={() => onViewRestaurant(o.restaurant)}
            >
              View menu
            </button>
            <button
              className="btn-secondary"
              style={{ color: 'var(--chili-dark)', borderColor: 'var(--chili)', marginTop: 10 }}
              onClick={() => onReorder(o)}
            >
              🔁 Reorder
            </button>
            {(o.status === 'delivered' || o.status === 'cancelled') && (
              <button
                className="btn-secondary"
                style={{ marginTop: 10, marginLeft: 8 }}
                onClick={() => setComplaintModalOrderId(o.id)}
              >
                🚩 Report an issue
              </button>
            )}
            {complaintsByOrderId[o.id]?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {complaintsByOrderId[o.id].map((c) => (
                  <p key={c.id} className="muted" style={{ fontSize: 12 }}>
                    🚩 {c.category.replaceAll('_', ' ')} — <span style={{ textTransform: 'capitalize' }}>{c.status.replaceAll('_', ' ')}</span>
                    {c.restaurantResponse && <> · Response: "{c.restaurantResponse}"</>}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <p style={{ fontWeight: 700, margin: '0 0 8px' }}>Change password</p>
        {pwError && <div className="error-banner">{pwError}</div>}
        <div className="stack">
          <input placeholder="Current password" type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
          <input placeholder="New password (min 6 characters)" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn-secondary" onClick={changePassword} disabled={changingPw || !currentPw || newPw.length < 6}>
              {changingPw ? 'Changing…' : 'Change password'}
            </button>
            {pwChanged && <span style={{ color: 'var(--curry)', fontWeight: 600, fontSize: 14 }}>✓ Changed</span>}
          </div>
        </div>
      </div>
      {complaintModalOrderId && (
        <ComplaintModal
          orderId={complaintModalOrderId}
          onClose={() => setComplaintModalOrderId(null)}
          onFiled={handleComplaintFiled}
        />
      )}
    </div>
  );
}
