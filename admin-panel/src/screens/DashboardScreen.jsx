import { useEffect, useState } from 'react';
import { api } from '../api';

export default function DashboardScreen({ onLogout }) {
  const [tab, setTab] = useState('restaurants');
  const [restaurants, setRestaurants] = useState([]);
  const [riders, setRiders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  // restaurantId -> KYC object (or 'loading') for the expandable review panel on pending cards
  const [kycById, setKycById] = useState({});

  async function toggleKyc(restaurantId) {
    if (kycById[restaurantId]) {
      setKycById((prev) => {
        const next = { ...prev };
        delete next[restaurantId];
        return next;
      });
      return;
    }
    setKycById((prev) => ({ ...prev, [restaurantId]: 'loading' }));
    try {
      const kyc = await api.getRestaurantKyc(restaurantId);
      setKycById((prev) => ({ ...prev, [restaurantId]: kyc }));
    } catch (err) {
      setActionError(err.message);
      setKycById((prev) => {
        const next = { ...prev };
        delete next[restaurantId];
        return next;
      });
    }
  }

  // Password reset: admin relays the temp password to the user over call/WhatsApp
  const [resetRole, setResetRole] = useState('customer');
  const [resetPhone, setResetPhone] = useState('');
  const [resetResult, setResetResult] = useState(null);
  const [resetting, setResetting] = useState(false);

  async function handleResetPassword() {
    setActionError('');
    setResetResult(null);
    setResetting(true);
    try {
      const result = await api.resetPassword(resetRole, resetPhone);
      setResetResult(result);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setResetting(false);
    }
  }

  // Swiggy-style FSSAI freshness rule: warn when the licence expires within 30 days (or already has)
  function fssaiWarning(expiry) {
    if (!expiry) return null;
    const days = Math.floor((new Date(expiry) - new Date()) / 86400000);
    if (days < 0) return 'FSSAI licence has EXPIRED';
    if (days <= 30) return `FSSAI licence expires in ${days} day${days === 1 ? '' : 's'}`;
    return null;
  }

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

      <div className="card" style={{ marginBottom: 20 }}>
        <p style={{ fontWeight: 700, margin: '0 0 2px' }}>Reset a password</p>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>Generates a temporary password — share it with the user over call or WhatsApp; they should change it from their app</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={resetRole} onChange={(e) => setResetRole(e.target.value)} aria-label="Account type">
            <option value="customer">Customer</option>
            <option value="restaurant">Restaurant</option>
            <option value="rider">Rider</option>
          </select>
          <input placeholder="Phone number" value={resetPhone} onChange={(e) => setResetPhone(e.target.value.replace(/\D/g, ''))} maxLength={10} style={{ flex: 1, minWidth: 140 }} />
          <button className="btn-approve" onClick={handleResetPassword} disabled={resetting || resetPhone.length !== 10}>
            {resetting ? 'Resetting…' : 'Reset'}
          </button>
        </div>
        {resetResult && (
          <p style={{ marginTop: 10, marginBottom: 0 }}>
            Temporary password for <strong>{resetResult.name}</strong> ({resetResult.role}):{' '}
            <code style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: 6, fontSize: 15, letterSpacing: 1 }}>{resetResult.tempPassword}</code>
          </p>
        )}
      </div>

              <h2 style={{ fontSize: 16, marginBottom: 10 }}>Awaiting approval</h2>
              <div className="stack" style={{ marginBottom: 24 }}>
                {pendingRestaurants.map((r) => (
                  <div key={r.id} className="card">
                    <div className="row" style={{ marginBottom: 6 }}>
                      <strong>{r.name}</strong>
                      <span className="pill pending">pending</span>
                    </div>
                    <p className="muted" style={{ marginBottom: 10 }}>{r.ownerName} · {r.cuisineType} · {r.address} · {r.phone}</p>
                    {kycById[r.id] && kycById[r.id] !== 'loading' && (
                      <div style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '10px 12px', marginBottom: 10, fontSize: 13 }}>
                        {(() => {
                          const kyc = kycById[r.id];
                          const warning = fssaiWarning(kyc.fssaiExpiry);
                          const row = (label, value) => (
                            <div className="row" style={{ marginBottom: 3 }}>
                              <span className="muted">{label}</span>
                              <span style={{ fontWeight: value ? 600 : 400, color: value ? 'inherit' : 'var(--text-dim, #9a917f)' }}>{value || 'not provided'}</span>
                            </div>
                          );
                          return (
                            <>
                              {row('Email', kyc.ownerEmail)}
                              {row('WhatsApp', kyc.whatsappNumber)}
                              {row('FSSAI', kyc.fssaiNumber && `${kyc.fssaiNumber} (valid till ${kyc.fssaiExpiry})`)}
                              {warning && <div style={{ color: '#ff8a7a', fontWeight: 700, margin: '2px 0' }}>⚠ {warning}</div>}
                              {row('PAN', kyc.pan)}
                              {row('GSTIN', kyc.gstin)}
                              {row('Bank', kyc.bankIfsc && `${kyc.bankIfsc} · a/c ${kyc.bankAccountNumber}`)}
                            </>
                          );
                        })()}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-secondary" onClick={() => toggleKyc(r.id)}>
                        {kycById[r.id] === 'loading' ? 'Loading…' : kycById[r.id] ? 'Hide KYC' : 'Review KYC'}
                      </button>
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
                    {Number(r.ratingAvg) > 0 && <span className="pill verified">★ {Number(r.ratingAvg).toFixed(1)} ({r.ratingCount})</span>}
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
