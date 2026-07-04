import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api, SOCKET_URL } from '../api';

const STAGES = [
  { key: 'placed', label: 'Order placed' },
  { key: 'accepted', label: 'Accepted by restaurant' },
  { key: 'preparing', label: 'Preparing your food' },
  { key: 'ready_for_pickup', label: 'Ready for pickup' },
  { key: 'picked_up', label: 'Rider on the way' },
  { key: 'delivered', label: 'Delivered' },
];

export default function TrackOrderScreen({ orderId, onBack, onPayNow }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let socket;

    api
      .getOrder(orderId)
      .then(setOrder)
      .catch((err) => setError(err.message));

    socket = io(SOCKET_URL);
    socket.on('connect', () => socket.emit('subscribeToOrder', orderId));
    socket.on('orderUpdate', (updated) => setOrder(updated));

    return () => socket.disconnect();
  }, [orderId]);

  if (error) {
    return (
      <div className="screen">
        <button className="btn-secondary" onClick={onBack} style={{ marginTop: 12 }}>← Back</button>
        <div className="error-banner" style={{ marginTop: 16 }}>{error}</div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="screen">
        <p className="muted" style={{ marginTop: 40, textAlign: 'center' }}>Loading your order…</p>
      </div>
    );
  }

  const isCancelled = order.status === 'cancelled';
  const currentIndex = STAGES.findIndex((s) => s.key === order.status);

  return (
    <div className="screen">
      <button className="btn-secondary" onClick={onBack} style={{ marginTop: 12, marginBottom: 12 }}>
        ← Back
      </button>
      <h1 style={{ fontSize: 22 }}>{order.restaurant.name}</h1>
      <p className="muted">Order total ₹{Number(order.total).toFixed(0)}</p>

      {isCancelled ? (
        <div className="error-banner" style={{ marginTop: 20 }}>This order was cancelled.</div>
      ) : (
        <div className="tiffin-stack">
          {[...STAGES].reverse().map((stage, i) => {
            const stageIndex = STAGES.length - 1 - i;
            const filled = stageIndex < currentIndex;
            const current = stageIndex === currentIndex;
            return (
              <div key={stage.key}>
                {i === STAGES.length - 1 && <div className="tiffin-handle" />}
                <div className={`tiffin-tier ${filled ? 'filled' : ''} ${current ? 'current' : ''}`}>
                  {stage.label}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: 15, marginBottom: 8 }}>Delivering to</h3>
        <p style={{ margin: 0 }}>{order.deliveryAddress}</p>
      </div>

      {order.deliveryPartner && (
        <div className="card">
          <h3 style={{ fontSize: 15, marginBottom: 4 }}>Your rider</h3>
          <p style={{ margin: 0 }}>{order.deliveryPartner.name} · {order.deliveryPartner.vehicleType}</p>
        </div>
      )}

      {order.paymentStatus === 'pending' && (
        <button className="btn-primary" onClick={() => onPayNow(order)}>
          Pay ₹{Number(order.total).toFixed(0)}
        </button>
      )}
      {order.paymentStatus === 'paid' && (
        <div className="pill" style={{ background: 'var(--curry)', color: '#fff' }}>Paid</div>
      )}
    </div>
  );
}
