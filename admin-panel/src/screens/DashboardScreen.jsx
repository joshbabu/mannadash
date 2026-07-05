import { useEffect, useState } from 'react';
import { api } from '../api';

export default function DashboardScreen({ onLogout }) {
  const [tab, setTab] = useState('restaurants');
  const [restaurants, setRestaurants] = useState([]);
  const [riders, setRiders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);
    setError('');
    Promise.all([api.getRestaurants(), api.getRiders()])
      .then(([r, d]) => {
        setRestaurants(r);
        setRiders(d);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  async function setRestaurantStatus(restaurant, status) {
    setActionError('');
    try {
      await api.setRestaurantStatus(restaurant.id, status);
      load();
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function verifyRider(rider) {
    setActionError('');
    try {
      await api.verifyRider(rider.id);
      load();
    } catch (err) {
      setActionError(err.message);
    }
  }

  const pendingRestaurants = restaurants.filter((r) => r.status === 'pending');
  const otherRestaurants = restaurants.filter((r) => r.status !== 'pending');
  const unverifiedRiders = riders.filter((r) => !r.isVerified);
  const verifiedRiders = riders.filter((r) => r.isVerified);

  return (
    <div className="app-shell">
      <div className="topbar">
        <span className="brand">MannaDash Admin</span>
        <button className="btn-secondary" onClick={onLogout}>Log out</button>
      </div>

      <div className="tabs">
        <button className={tab === 'restaurants' ? 'active' : ''} onClick={() => setTab('restaurants')}>
          Restaurants {pendingRestaurants.length > 0 && `(${pendingRestaurants.length} pending)`}
        </button>
        <button className={tab === 'riders' ? 'active' : ''} onClick={() => setTab('riders')}>
          Riders {unverifiedRiders.length > 0 && `(${unverifiedRiders.length} unverified)`}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {actionError && <div className="error-banner">{actionError}</div>}
      {loading && <p className="muted">Loading…</p>}

      {tab === 'restaurants' && !loading && (
        <div>
          {pendingRestaurants.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, marginBottom: 10 }}>Awaiting approval</h2>
              <div className="stack" style={{ marginBottom: 24 }}>
                {pendingRestaurants.map((r) => (
                  <div key={r.id} className="card">
                    <div className="row" style={{ marginBottom: 6 }}>
                      <strong>{r.name}</strong>
                      <span className="pill pending">pending</span>
                    </div>
                    <p className="muted" style={{ marginBottom: 10 }}>{r.ownerName} · {r.cuisineType} · {r.address} · {r.phone}</p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-approve" onClick={() => setRestaurantStatus(r, 'approved')}>Approve</button>
                      <button className="btn-suspend" onClick={() => setRestaurantStatus(r, 'suspended')}>Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <h2 style={{ fontSize: 16, marginBottom: 10 }}>All restaurants</h2>
          <div className="stack">
            {otherRestaurants.map((r) => (
              <div key={r.id} className="card">
                <div className="row">
                  <div>
                    <strong>{r.name}</strong>
                    <p className="muted" style={{ margin: '2px 0 0' }}>{r.ownerName} · {r.cuisineType}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className={`pill ${r.status}`}>{r.status}</span>
                    {r.status === 'approved' && (
                      <button className="btn-suspend" onClick={() => setRestaurantStatus(r, 'suspended')}>Suspend</button>
                    )}
                    {r.status === 'suspended' && (
                      <button className="btn-approve" onClick={() => setRestaurantStatus(r, 'approved')}>Reinstate</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'riders' && !loading && (
        <div>
          {unverifiedRiders.length > 0 && (
            <>
              <h2 style={{ fontSize: 16, marginBottom: 10 }}>Awaiting verification</h2>
              <div className="stack" style={{ marginBottom: 24 }}>
                {unverifiedRiders.map((r) => (
                  <div key={r.id} className="card">
                    <div className="row">
                      <div>
                        <strong>{r.name}</strong>
                        <p className="muted" style={{ margin: '2px 0 0' }}>{r.vehicleType} · {r.phone}</p>
                      </div>
                      <button className="btn-approve" onClick={() => verifyRider(r)}>Verify</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <h2 style={{ fontSize: 16, marginBottom: 10 }}>Verified riders</h2>
          <div className="stack">
            {verifiedRiders.map((r) => (
              <div key={r.id} className="card">
                <div className="row">
                  <div>
                    <strong>{r.name}</strong>
                    <p className="muted" style={{ margin: '2px 0 0' }}>{r.vehicleType} · {r.phone}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {Number(r.ratingAvg) > 0 && <span className="pill verified">★ {Number(r.ratingAvg).toFixed(1)}</span>}
                    <span className={`pill ${r.isAvailable ? 'approved' : 'pending'}`}>{r.isAvailable ? 'online' : 'offline'}</span>
                    <span className="pill verified">verified</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
