import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, SOCKET_URL } from '../api';

// What each status can move to next, from the rider's side only —
// mirrors the backend's rider-owned transitions (picked_up, delivered)
const RIDER_ACTIONS = {
  accepted: null,
  preparing: null, // food isn't ready yet — nothing for the rider to do until the restaurant marks it ready
  ready_for_pickup: { label: 'Mark picked up', value: 'picked_up' },
  picked_up: { label: 'Mark delivered', value: 'delivered' },
};

const WAITING_MESSAGE = {
  accepted: 'Restaurant is getting started on this order…',
  preparing: 'Restaurant is preparing your order…',
};

export default function HomeScreen({ rider, onLogout }) {
  const [isOnline, setIsOnline] = useState(rider.isAvailable);
  const [isVerified, setIsVerified] = useState(rider.isVerified);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [locationError, setLocationError] = useState('');
  const [newOrderAlert, setNewOrderAlert] = useState(null);
  const socketRef = useRef(null);
  const subscribedIds = useRef(new Set());
  const locationIntervalRef = useRef(null);

  // The login snapshot can go stale the instant an admin verifies this rider elsewhere —
  // re-check the real status on load instead of trusting what we got at login time.
  useEffect(() => {
    api.getRider(rider.id).then((fresh) => setIsVerified(fresh.isVerified)).catch(() => {});
  }, [rider.id]);

  useEffect(() => {
    const socket = io(SOCKET_URL);
    socket.on('connect', () => {
      // Personal channel — this is what actually notifies us of a brand new order,
      // since we can't subscribe to a specific order's room before we know it exists.
      socket.emit('subscribeToRider', rider.id);
    });
    socket.on('newAssignment', (order) => {
      setNewOrderAlert(order);
      playAlertSound();
      loadOrders();
    });
    socket.on('orderUpdate', () => loadOrders());
    socketRef.current = socket;
    return () => socket.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadOrders();
  }, []);

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

  // Share location once immediately when going online, then every 15s while online —
  // stops entirely when offline so we're not pinging location for no reason
  useEffect(() => {
    if (isOnline) {
      shareLocation();
      locationIntervalRef.current = setInterval(shareLocation, 15000);
    } else if (locationIntervalRef.current) {
      clearInterval(locationIntervalRef.current);
    }
    return () => {
      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  function playAlertSound() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.start();
      // Two short beeps rather than one long tone — reads as "alert" rather than a dial tone
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.stop(ctx.currentTime + 0.4);
    } catch {
      // Some browsers block audio until the user interacts with the page — non-fatal, the visible banner still shows
    }
  }

  function shareLocation() {
    if (!navigator.geolocation) {
      setLocationError('Location sharing is not supported on this device');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        api.updateLocation(pos.coords.latitude, pos.coords.longitude).catch(() => {});
        setLocationError('');
      },
      () => setLocationError('Could not get your location — enable location access for this site'),
    );
  }

  function loadOrders() {
    api.getMyOrders().then(setOrders).catch((err) => setError(err.message));
  }

  async function toggleOnline() {
    setError('');
    try {
      const updated = await api.setAvailability(!isOnline);
      setIsOnline(updated.isAvailable);
    } catch (err) {
      setError(err.message);
    }
  }

  async function advance(order, status) {
    setError('');
    try {
      await api.updateOrderStatus(order.id, status);
      loadOrders();
    } catch (err) {
      setError(err.message);
    }
  }

  const activeOrders = orders.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled');

  return (
    <div className="app-shell">
      <div className="topbar">
        <span className="brand">MannaDash Rider</span>
        <button className="btn-secondary" onClick={onLogout} style={{ fontSize: 12, padding: '6px 10px' }}>
          Log out
        </button>
      </div>

      {!isVerified && (
        <div className="error-banner">
          Your account isn't verified yet — you can't go online until an admin verifies you.
        </div>
      )}

      {newOrderAlert && (
        <div className="status-banner online" style={{ borderColor: 'var(--turmeric)', background: 'rgba(244,162,0,0.15)' }}>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>🔔 New delivery!</p>
          <p className="muted" style={{ margin: '4px 0 16px' }}>{newOrderAlert.restaurant.name} · ₹{Number(newOrderAlert.total).toFixed(0)}</p>
          <button className="btn-secondary" onClick={() => setNewOrderAlert(null)}>Got it</button>
        </div>
      )}

      <div className={`status-banner ${isOnline ? 'online' : 'offline'}`}>
        <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{isOnline ? "You're online" : "You're offline"}</p>
        <p className="muted" style={{ margin: '4px 0 16px' }}>
          {isOnline ? 'Sharing your location, ready for orders' : 'Go online to start receiving deliveries'}
        </p>
        <button
          className={isOnline ? 'btn-stop' : 'btn-primary'}
          onClick={toggleOnline}
          disabled={!isVerified}
        >
          {isOnline ? 'Go offline' : 'Go online'}
        </button>
      </div>

      {/* Location permission issues are common and easily fixed — muted note rather than an alarming red banner */}
      {locationError && <p className="muted" style={{ marginBottom: 14 }}>📍 {locationError}</p>}
      {error && <div className="error-banner">{error}</div>}

      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Your deliveries</h2>
      {activeOrders.length === 0 && <p className="muted">No active deliveries right now.</p>}

      <div className="stack">
        {activeOrders.map((order) => {
          const action = RIDER_ACTIONS[order.status];
          return (
            <div key={order.id} className="card">
              <div className="row" style={{ marginBottom: 8 }}>
                <h3 style={{ fontSize: 15 }}>{order.restaurant.name}</h3>
                <span className="pill">{order.status.replace('_', ' ')}</span>
              </div>
              <p className="muted" style={{ color: '#6b6156', marginBottom: 4 }}>Pickup: {order.restaurant.address}</p>
              <p className="muted" style={{ color: '#6b6156', marginBottom: 12 }}>Deliver to: {order.deliveryAddress}</p>
              <p style={{ fontWeight: 600, marginBottom: 12 }}>₹{Number(order.total).toFixed(0)}</p>

              {action ? (
                <button className="btn-primary" style={{ background: 'var(--curry)' }} onClick={() => advance(order, action.value)}>
                  {action.label}
                </button>
              ) : (
                <p className="muted">{WAITING_MESSAGE[order.status] || 'Waiting on the restaurant…'}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
