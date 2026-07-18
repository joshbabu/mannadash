import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, SOCKET_URL } from '../api';
import EarningsScreen from './EarningsScreen';
import { enablePushNotifications, disablePushNotifications, isPushSupported, getInitialPushStatus, silentlyRefreshSubscription } from '../utils/pushNotifications';

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
  const [tab, setTab] = useState('deliveries');
  const [isOnline, setIsOnline] = useState(rider.isAvailable);
  const [isVerified, setIsVerified] = useState(rider.isVerified);
  const [ratingAvg, setRatingAvg] = useState(rider.ratingAvg || 0);
  const [ratingCount, setRatingCount] = useState(rider.ratingCount || 0);
  const [pushStatus, setPushStatus] = useState(getInitialPushStatus); // 'idle' | 'enabling' | 'enabled' | 'error' | 'unsupported'
  const [pushError, setPushError] = useState('');
  const [pushSubscribed, setPushSubscribed] = useState(null); // server truth, for the persistent toggle below
  const [pushToggleBusy, setPushToggleBusy] = useState(false);
  const [orders, setOrders] = useState([]);
  const ordersRef = useRef(orders); // avoids stale-closure bug in the location-sharing interval below
  const [error, setError] = useState('');
  const [locationError, setLocationError] = useState('');
  const [newOrderAlert, setNewOrderAlert] = useState(null);
  const socketRef = useRef(null);
  const subscribedIds = useRef(new Set());
  const locationIntervalRef = useRef(null);

  // The login snapshot can go stale the instant an admin verifies this rider elsewhere —
  // re-check the real status on load instead of trusting what we got at login time.
  useEffect(() => {
    api.getRider(rider.id).then((fresh) => {
      setIsVerified(fresh.isVerified);
      setRatingAvg(Number(fresh.ratingAvg) || 0);
      setRatingCount(Number(fresh.ratingCount) || 0);
    }).catch(() => {});
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

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  useEffect(() => {
    if (pushStatus === 'enabled') silentlyRefreshSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isPushSupported()) {
      setPushSubscribed(false);
      return;
    }
    api.getPushStatus().then((s) => setPushSubscribed(s.subscribed)).catch(() => setPushSubscribed(false));
  }, [pushStatus]); // re-check after the one-time enable flow completes too

  async function togglePushSubscription() {
    setPushError('');
    setPushToggleBusy(true);
    try {
      if (pushSubscribed) {
        await disablePushNotifications();
        setPushSubscribed(false);
      } else {
        await enablePushNotifications();
        setPushSubscribed(true);
        setPushStatus('enabled');
      }
    } catch (err) {
      setPushError(err.message);
    } finally {
      setPushToggleBusy(false);
    }
  }

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

  function shareLocation() {
    if (!navigator.geolocation) {
      setLocationError('Location sharing is not supported on this device');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        api.updateLocation(latitude, longitude).catch(() => {});
        // Also push straight to any active orders' tracking screens — this is what makes the
        // customer's live map actually move, rather than just updating our own stored position
        ordersRef.current.forEach((order) => {
          if (order.status === 'preparing' || order.status === 'ready_for_pickup' || order.status === 'picked_up') {
            socketRef.current?.emit('riderLocationUpdate', { orderId: order.id, lat: latitude, lng: longitude });
          }
        });
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {ratingAvg > 0 && <span className="pill">★ {ratingAvg.toFixed(1)} ({ratingCount})</span>}
          <button className="btn-secondary" onClick={onLogout} style={{ fontSize: 12, padding: '6px 10px' }}>
            Log out
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button
          className="btn-secondary"
          style={{ opacity: tab === 'deliveries' ? 1 : 0.5 }}
          onClick={() => setTab('deliveries')}
        >
          Deliveries
        </button>
        <button
          className="btn-secondary"
          style={{ opacity: tab === 'earnings' ? 1 : 0.5 }}
          onClick={() => setTab('earnings')}
        >
          Earnings
        </button>
      </div>

      {tab === 'earnings' ? (
        <EarningsScreen />
      ) : (
        <>
          {!isVerified && (
            <div className="error-banner">
              Your account isn't verified yet — you can't go online until an admin verifies you.
            </div>
          )}

          {isPushSupported() && pushStatus === 'idle' && (
            <div className="card" style={{ marginBottom: 14 }}>
              <p style={{ margin: '0 0 10px' }}>🔔 Get notified of new deliveries even when this app is closed.</p>
              <button className="btn-secondary" onClick={handleEnablePush}>Enable notifications</button>
            </div>
          )}
          {pushStatus === 'enabling' && <p className="muted" style={{ marginBottom: 14 }}>Enabling notifications…</p>}
          {pushStatus === 'error' && <p className="muted" style={{ marginBottom: 14, color: 'var(--chili)' }}>Couldn't enable notifications: {pushError}</p>}

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

          {isPushSupported() && (
            <div className="status-banner offline" style={{ marginTop: 12 }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                🔔 Delivery notifications: {pushSubscribed === null ? 'checking…' : pushSubscribed ? 'On' : 'Off'}
              </p>
              <p className="muted" style={{ margin: '4px 0 12px', fontSize: 12 }}>
                {pushSubscribed
                  ? 'You\'ll be notified the moment a new delivery comes in, even with the app closed'
                  : 'You won\'t be notified of new deliveries unless the app is open'}
              </p>
              <button className="btn-secondary" onClick={togglePushSubscription} disabled={pushSubscribed === null || pushToggleBusy}>
                {pushToggleBusy ? '…' : pushSubscribed ? 'Turn off' : 'Turn on'}
              </button>
              {pushError && <p className="muted" style={{ marginTop: 8, color: 'var(--chili)', fontSize: 12 }}>{pushError}</p>}
            </div>
          )}

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
                    <span className="pill">{order.status.replaceAll('_', ' ')}</span>
                  </div>
                  <p className="muted" style={{ color: '#6b6156', marginBottom: 4 }}>Pickup: {order.restaurant.address}</p>
                  <p className="muted" style={{ color: '#6b6156', marginBottom: 12 }}>Deliver to: {order.deliveryAddress}</p>
                  <p style={{ fontWeight: 600, marginBottom: order.paymentMethod === 'cod' && order.status !== 'delivered' ? 4 : 12 }}>
                    ₹{Number(order.total).toFixed(0)}
                    {order.deliveryType === 'express' && (
                      <span className="pill" style={{ background: '#fdeee8', color: 'var(--chili-dark)', marginLeft: 8, fontSize: 12 }}>⚡ Express</span>
                    )}
                    {Number(order.tipAmount) > 0 && (
                      <span className="pill" style={{ background: '#e3edd8', color: 'var(--curry)', marginLeft: 8, fontSize: 12 }}>🎁 ₹{Number(order.tipAmount).toFixed(0)} tip</span>
                    )}
                  </p>
                  {order.paymentMethod === 'cod' && order.status !== 'delivered' && (
                    <p style={{ background: '#fff2d6', color: '#8a5a00', padding: '6px 10px', borderRadius: 8, fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
                      💵 Collect ₹{Number(order.total).toFixed(0)} in cash
                    </p>
                  )}

                  {action ? (
                    <button className="btn-primary" style={{ background: 'var(--curry)' }} onClick={() => advance(order, action.value)}>
                      {action.label}
                    </button>
                  ) : (
                    <p className="muted" style={{ color: '#8a8378' }}>{WAITING_MESSAGE[order.status] || 'Waiting on the restaurant…'}</p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
