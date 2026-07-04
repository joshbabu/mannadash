import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, SOCKET_URL } from '../api';

// What each status can move to next — mirrors the backend's allowed transitions.
// Note: picked_up/delivered are intentionally absent here — only the assigned rider can set those
// (see backend's authority split). The restaurant still SEES those stages live via the socket
// subscription below, it just can't trigger them itself.
const NEXT_STATUS = {
  placed: [{ label: 'Accept order', value: 'accepted' }, { label: 'Cancel', value: 'cancelled' }],
  accepted: [{ label: 'Start preparing', value: 'preparing' }, { label: 'Cancel', value: 'cancelled' }],
  preparing: [{ label: 'Mark food ready', value: 'ready_for_pickup' }, { label: 'Cancel', value: 'cancelled' }],
  ready_for_pickup: [{ label: 'Cancel', value: 'cancelled' }],
  picked_up: [],
  delivered: [],
  cancelled: [],
};

const AWARENESS_MESSAGE = {
  ready_for_pickup: 'Ready for pickup — waiting for the rider.',
  picked_up: 'Rider has picked up the order — on the way to the customer.',
  delivered: 'Delivered.',
};

export default function OrdersScreen({ restaurant }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [restaurantLocation, setRestaurantLocation] = useState(null);
  const [riderPickerOrderId, setRiderPickerOrderId] = useState(null);
  const [availableRiders, setAvailableRiders] = useState([]);
  const [loadingRiders, setLoadingRiders] = useState(false);
  const socketRef = useRef(null);
  const subscribedIds = useRef(new Set());

  // Create the socket connection once, for the lifetime of this screen
  useEffect(() => {
    const socket = io(SOCKET_URL);
    socket.on('orderUpdate', () => load());
    socketRef.current = socket;
    return () => socket.disconnect();
  }, []);

  // Initial load
  useEffect(() => {
    load();
    // Need our own coordinates to query "riders near me" — the stored login response
    // doesn't include location, so fetch the full restaurant record once.
    api.getRestaurant(restaurant.id).then((full) => {
      const [lng, lat] = full.location.coordinates;
      setRestaurantLocation({ lat, lng });
    }).catch(() => {});
  }, []);

  // Whenever the order list changes, make sure we're subscribed to every order's room —
  // joining a room we're already in is harmless, so this is safe to re-run freely.
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;
    orders.forEach((o) => {
      if (!subscribedIds.current.has(o.id)) {
        socket.emit('subscribeToOrder', o.id);
        subscribedIds.current.add(o.id);
      }
    });
  }, [orders]);

  function load() {
    setLoading(true);
    api
      .getMyOrders()
      .then(setOrders)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  async function advance(order, status) {
    setActionError('');
    try {
      await api.updateOrderStatus(order.id, status);
      load();
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function autoAssignRider(order) {
    setActionError('');
    try {
      await api.assignRider(order.id);
      load();
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function toggleRiderPicker(order) {
    if (riderPickerOrderId === order.id) {
      setRiderPickerOrderId(null);
      return;
    }
    setRiderPickerOrderId(order.id);
    setActionError('');
    if (!restaurantLocation) return;
    setLoadingRiders(true);
    try {
      const riders = await api.getAvailableRidersNearby(restaurantLocation.lat, restaurantLocation.lng);
      setAvailableRiders(riders);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setLoadingRiders(false);
    }
  }

  async function assignChosenRider(order, riderId) {
    setActionError('');
    try {
      await api.assignSpecificRider(order.id, riderId);
      setRiderPickerOrderId(null);
      load();
    } catch (err) {
      setActionError(err.message);
    }
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20 }}>Orders</h2>
        <button className="btn-secondary" onClick={load}>Refresh</button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {actionError && <div className="error-banner">{actionError}</div>}
      {loading && <p className="muted">Loading orders…</p>}
      {!loading && orders.length === 0 && <p className="muted">No orders yet.</p>}

      <div className="stack">
        {orders.map((order) => (
          <div key={order.id} className="card">
            <div className="row" style={{ marginBottom: 8 }}>
              <h3 style={{ fontSize: 15 }}>{order.customer.user.name}</h3>
              <span className={`pill status-${order.status}`}>{order.status.replace('_', ' ')}</span>
            </div>

            <div style={{ marginBottom: 8 }}>
              {order.items.map((line) => (
                <p key={line.id} className="muted" style={{ margin: '2px 0' }}>
                  {line.quantity} × {line.menuItem.name}
                </p>
              ))}
            </div>

            <p className="muted" style={{ marginBottom: 4 }}>Deliver to: {order.deliveryAddress}</p>
            <p style={{ fontWeight: 600, marginBottom: 12 }}>Total ₹{Number(order.total).toFixed(0)}</p>

            {order.deliveryPartner && (
              <p className="muted" style={{ marginBottom: 12 }}>
                Rider: {order.deliveryPartner.name} ({order.deliveryPartner.vehicleType})
              </p>
            )}

            {AWARENESS_MESSAGE[order.status] && (
              <p style={{ marginBottom: 12, fontWeight: 600, color: order.status === 'delivered' ? 'var(--curry)' : 'var(--chili-dark)' }}>
                {AWARENESS_MESSAGE[order.status]}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {NEXT_STATUS[order.status]?.map((action) => (
                <button
                  key={action.value}
                  className={action.value === 'cancelled' ? 'btn-ghost' : 'btn-primary'}
                  onClick={() => advance(order, action.value)}
                >
                  {action.label}
                </button>
              ))}
              {['accepted', 'preparing', 'ready_for_pickup'].includes(order.status) && !order.deliveryPartner && (
                <>
                  <button className="btn-secondary" onClick={() => autoAssignRider(order)}>
                    Auto-assign nearest
                  </button>
                  <button className="btn-secondary" onClick={() => toggleRiderPicker(order)}>
                    {riderPickerOrderId === order.id ? 'Hide riders' : 'Choose rider'}
                  </button>
                </>
              )}
            </div>

            {riderPickerOrderId === order.id && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                {loadingRiders && <p className="muted">Finding riders online nearby…</p>}
                {!loadingRiders && availableRiders.length === 0 && (
                  <p className="muted">No riders online nearby right now.</p>
                )}
                <div className="stack">
                  {availableRiders.map((rider) => (
                    <div key={rider.id} className="row">
                      <span className="muted" style={{ color: 'var(--charcoal)' }}>
                        {rider.name} · {rider.vehicleType} · {(rider.distanceMeters / 1000).toFixed(1)} km away
                      </span>
                      <button className="btn-primary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => assignChosenRider(order, rider.id)}>
                        Assign
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
