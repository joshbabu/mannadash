import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api, SOCKET_URL } from '../api';
import StarRating from '../components/StarRating';
import LiveMap from '../components/LiveMap';

const STAGES = [
  { key: 'placed', label: 'Order placed' },
  { key: 'accepted', label: 'Accepted by restaurant' },
  { key: 'preparing', label: 'Preparing your food' },
  { key: 'ready_for_pickup', label: 'Ready for pickup' },
  { key: 'picked_up', label: 'Rider on the way' },
  { key: 'delivered', label: 'Delivered' },
];

// Backend returns PostGIS points as GeoJSON: { type: 'Point', coordinates: [lng, lat] }
function parseGeoPoint(geo) {
  if (!geo?.coordinates) return null;
  return { lng: geo.coordinates[0], lat: geo.coordinates[1] };
}

export default function TrackOrderScreen({ orderId, onBack, onPayNow }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [riderPosition, setRiderPosition] = useState(null);
  const [restaurantRating, setRestaurantRating] = useState(0);
  const [deliveryRating, setDeliveryRating] = useState(0);
  const [comment, setComment] = useState('');
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [ratingError, setRatingError] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);

  useEffect(() => {
    let socket;

    api
      .getOrder(orderId)
      .then(setOrder)
      .catch((err) => setError(err.message));

    socket = io(SOCKET_URL);
    socket.on('connect', () => socket.emit('subscribeToOrder', orderId));
    socket.on('orderUpdate', (updated) => setOrder(updated));
    socket.on('riderLocation', ({ lat, lng }) => setRiderPosition({ lat, lng }));

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

  async function submitRating() {
    setRatingError('');
    setSubmittingRating(true);
    try {
      await api.rateOrder(orderId, { restaurantRating, deliveryRating, comment: comment || undefined });
      setRatingSubmitted(true);
    } catch (err) {
      // Treat "already rated" as success from the UI's perspective — nothing more to do
      if (err.message.toLowerCase().includes('already been rated')) {
        setRatingSubmitted(true);
      } else {
        setRatingError(err.message);
      }
    } finally {
      setSubmittingRating(false);
    }
  }

  return (
    <div className="screen">
      <button className="btn-secondary" onClick={onBack} style={{ marginTop: 12, marginBottom: 12 }}>
        ← Back
      </button>
      <h1 style={{ fontSize: 22 }}>{order.restaurant.name}</h1>
      <p className="muted">Order total ₹{Number(order.total).toFixed(0)}</p>
      {!isCancelled && order.status !== 'delivered' && order.estimatedDeliveryAt && (
        <p className="muted">
          Estimated delivery by{' '}
          {new Date(order.estimatedDeliveryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </p>
      )}

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

      {order.deliveryPartner && order.deliveryLocation && !['delivered', 'cancelled'].includes(order.status) && (
        <div style={{ marginBottom: 14 }}>
          <LiveMap
            riderPosition={riderPosition}
            destination={parseGeoPoint(order.deliveryLocation)}
          />
          {!riderPosition && <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>Waiting for your rider's live location…</p>}
        </div>
      )}

      {order.status === 'delivered' && (
        <div className="card">
          {ratingSubmitted ? (
            <p style={{ margin: 0, fontWeight: 600, color: 'var(--curry)' }}>Thanks for rating your order!</p>
          ) : (
            <>
              <h3 style={{ fontSize: 16, marginBottom: 12 }}>How was your order?</h3>
              {ratingError && <div className="error-banner" style={{ background: 'rgba(228,87,46,0.1)', color: 'var(--chili-dark)', border: '1px solid var(--chili)' }}>{ratingError}</div>}
              <StarRating label="Food quality" value={restaurantRating} onChange={setRestaurantRating} />
              <StarRating label="Delivery experience" value={deliveryRating} onChange={setDeliveryRating} />
              <textarea
                placeholder="Any comments? (optional)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', marginBottom: 12 }}
              />
              <button
                className="btn-primary"
                onClick={submitRating}
                disabled={submittingRating || restaurantRating === 0 || deliveryRating === 0}
              >
                {submittingRating ? 'Submitting…' : 'Submit rating'}
              </button>
            </>
          )}
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
