import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, SOCKET_URL } from '../api';
import { enablePushNotifications, isPushSupported, getInitialPushStatus, silentlyRefreshSubscription } from '../utils/pushNotifications';

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

// Unique to this dashboard, not something Swiggy/Zomato surface to restaurants directly —
// a live-aging urgency indicator so a restaurant juggling several orders can triage at a
// glance instead of treating every order as equally pressing.
const ACTIVE_STATUSES = ['placed', 'accepted', 'preparing', 'ready_for_pickup'];
function getUrgency(order, now) {
  if (!ACTIVE_STATUSES.includes(order.status)) return null;
  const minutesElapsed = (now - new Date(order.placedAt).getTime()) / 60000;
  if (minutesElapsed < 5) return { label: `${Math.max(0, Math.round(minutesElapsed))}m`, color: 'var(--curry)' };
  if (minutesElapsed < 15) return { label: `${Math.round(minutesElapsed)}m`, color: 'var(--turmeric)' };
  return { label: `${Math.round(minutesElapsed)}m`, color: 'var(--chili)' };
}

export default function OrdersScreen({ restaurant }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [restaurantLocation, setRestaurantLocation] = useState(null);
  const [busyHourNudge, setBusyHourNudge] = useState(null);
  const [pushStatus, setPushStatus] = useState(getInitialPushStatus);
  const [pushError, setPushError] = useState('');
  const [riderPickerOrderId, setRiderPickerOrderId] = useState(null);
  const [availableRiders, setAvailableRiders] = useState([]);
  const [loadingRiders, setLoadingRiders] = useState(false);
  const [newOrderAlert, setNewOrderAlert] = useState(null);
  const [now, setNow] = useState(Date.now()); // ticks forward so urgency badges age live, no refresh needed
  // null until the fresh value loads — the restaurant prop from login/storage can be stale
  const [isOpen, setIsOpen] = useState(null);
  const [togglingOpen, setTogglingOpen] = useState(false);
  const socketRef = useRef(null);
  const subscribedIds = useRef(new Set());
  const alertIntervalRef = useRef(null);

  function playAlertSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 740;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      // Some browsers block audio until the user interacts with the page — non-fatal
    }
  }

  // Create the socket connection once, for the lifetime of this screen
  useEffect(() => {
    const socket = io(SOCKET_URL);
    socket.on('connect', () => socket.emit('subscribeToRestaurant', restaurant.id));
    socket.on('newOrder', (order) => {
      setNewOrderAlert(order);
      playAlertSound();
      load();
    });
    socket.on('orderUpdate', () => load());
    socketRef.current = socket;
    return () => socket.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep re-alerting every 20s as long as there's an order still waiting to be accepted —
  // a single chime is easy to miss in a busy kitchen. Stops on its own once nothing's pending.
  useEffect(() => {
    const hasUnaccepted = orders.some((o) => o.status === 'placed');
    if (hasUnaccepted && !alertIntervalRef.current) {
      alertIntervalRef.current = setInterval(playAlertSound, 20000);
    } else if (!hasUnaccepted && alertIntervalRef.current) {
      clearInterval(alertIntervalRef.current);
      alertIntervalRef.current = null;
    }
    return () => {
      if (alertIntervalRef.current) {
        clearInterval(alertIntervalRef.current);
        alertIntervalRef.current = null;
      }
    };
  }, [orders]);

  // Ticks the clock forward every 15s purely so urgency badges (computed from elapsed time)
  // visibly age without the restaurant needing to refresh the page
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(tick);
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

    // Real-time operational nudge, driven by real history rather than a guess — if this hour
    // has historically been in this restaurant's top 25% busiest, give a heads-up before it hits.
    api.getMyInsights().then((insights) => {
      const currentHour = new Date().getHours();
      const counts = insights.ordersByHour.map((h) => h.count).filter((c) => c > 0);
      if (counts.length < 4) return; // not enough history yet to call anything "busy"
      const sorted = [...counts].sort((a, b) => b - a);
      const top25Threshold = sorted[Math.floor(sorted.length * 0.25)] ?? sorted[0];
      const thisHourCount = insights.ordersByHour.find((h) => h.hour === currentHour)?.count ?? 0;
      if (thisHourCount >= top25Threshold && thisHourCount > 0) {
        setBusyHourNudge(thisHourCount);
      }
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

  useEffect(() => {
    if (pushStatus === 'enabled') silentlyRefreshSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEnablePush() {
    setPushStatus('enabling');
    setPushError('');
    try {
      await enablePushNotifications();
      setPushStatus('enabled');
    } catch (err) {
      setPushStatus('error');
      setPushError(err.message);
    }
  }

  function load() {
    setLoading(true);
    api
      .getMyOrders()
      .then(setOrders)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // Fetched fresh rather than trusted from login storage — the toggle must show the truth
    api
      .getRestaurant(restaurant.id)
      .then((r) => setIsOpen(r.isOpen))
      .catch(() => {}); // non-fatal: the toggle just stays hidden until it loads
  }

  async function toggleOnline() {
    if (isOpen === null || togglingOpen) return;
    const next = !isOpen;
    setTogglingOpen(true);
    setActionError('');
    setIsOpen(next); // optimistic — revert below if the server disagrees
    try {
      await api.updateRestaurant(restaurant.id, { isOpen: next });
    } catch (err) {
      setIsOpen(!next);
      setActionError(err.message);
    } finally {
      setTogglingOpen(false);
    }
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
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 20 }}>Orders</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isOpen !== null && (
            <button
              onClick={toggleOnline}
              disabled={togglingOpen}
              aria-label={isOpen ? 'Go offline' : 'Go online'}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 20,
                border: '1px solid', cursor: 'pointer', fontWeight: 700, fontSize: 13,
                background: isOpen ? '#e3edd8' : '#f0e5e5',
                borderColor: isOpen ? 'var(--curry)' : '#c9a8a8',
                color: isOpen ? 'var(--curry)' : '#8a3a3a',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: isOpen ? 'var(--curry)' : '#b3564e' }} />
              {isOpen ? 'Online' : 'Offline'}
            </button>
          )}
          <button className="btn-secondary" onClick={load}>Refresh</button>
        </div>
      </div>

      {isOpen === false && (
        <div className="error-banner" style={{ background: '#fff2d6', borderColor: 'var(--turmeric)', color: '#8a5a00' }}>
          <strong>You're offline.</strong> New orders are blocked until you go back online — existing orders below still need handling.
        </div>
      )}

      {/* Live status counts — triage at a glance, matching the competitor boards used as reference */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Pending', emoji: '🕐', statuses: ['placed'] },
          { label: 'Preparing', emoji: '👨\u200d🍳', statuses: ['accepted', 'preparing'] },
          { label: 'Ready', emoji: '✅', statuses: ['ready_for_pickup'] },
          { label: 'Dispatched', emoji: '🛵', statuses: ['picked_up'] },
        ].map(({ label, emoji, statuses }) => (
          <div key={label} data-testid={`status-card-${label.toLowerCase()}`} className="card" style={{ flex: '1 1 100px', textAlign: 'center', padding: '10px 6px' }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              <span style={{ marginRight: 6 }}>{emoji}</span>
              {orders.filter((o) => statuses.includes(o.status)).length}
            </div>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>{label}</p>
          </div>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}
      {actionError && <div className="error-banner">{actionError}</div>}
      {loading && <p className="muted">Loading orders…</p>}
      {!loading && orders.length === 0 && <p className="muted">No orders yet.</p>}

      {isPushSupported() && pushStatus === 'idle' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row">
            <span>🔔 Get notified of new orders even when this tab is closed.</span>
            <button className="btn-secondary" onClick={handleEnablePush}>Enable notifications</button>
          </div>
        </div>
      )}
      {pushStatus === 'enabling' && <p className="muted" style={{ marginBottom: 16 }}>Enabling notifications…</p>}
      {pushStatus === 'error' && <p className="muted" style={{ marginBottom: 16, color: 'var(--chili)' }}>Couldn't enable notifications: {pushError}</p>}

      {busyHourNudge && (
        <div className="card" style={{ background: '#fff2d6', border: '1px solid var(--turmeric)', marginBottom: 16 }}>
          <div className="row">
            <span>🔥 This hour is historically one of your busiest — heads up.</span>
            <button className="btn-secondary" onClick={() => setBusyHourNudge(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {newOrderAlert && (
        <div className="card" style={{ background: '#fff2d6', border: '2px solid var(--turmeric)', marginBottom: 16 }}>
          <div className="row">
            <div>
              <strong>🔔 New order from {newOrderAlert.customer.user.name}</strong>
              <p style={{ margin: '4px 0 0' }}>₹{Number(newOrderAlert.total).toFixed(0)}</p>
            </div>
            <button className="btn-secondary" onClick={() => setNewOrderAlert(null)}>Got it</button>
          </div>
        </div>
      )}

      <div className="stack">
        {orders.map((order) => {
          const urgency = getUrgency(order, now);
          return (
          <div key={order.id} className="card" style={urgency ? { borderLeft: `4px solid ${urgency.color}` } : undefined}>
            <div className="row" style={{ marginBottom: 8 }}>
              <h3 style={{ fontSize: 15 }}>{order.customer.user.name}</h3>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {urgency && (
                  <span className="pill" style={{ background: urgency.color, color: '#fff' }} title="Time since order was placed">
                    {urgency.label}
                  </span>
                )}
                <span className={`pill status-${order.status}`}>{order.status.replaceAll('_', ' ')}</span>
              </div>
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
          );
        })}
      </div>
    </div>
  );
}
