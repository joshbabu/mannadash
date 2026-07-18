import { useEffect, useState } from 'react';
import { api } from '../api';
import { disablePushNotifications, enablePushNotifications, isPushSupported } from '../utils/pushNotifications';

export default function MyAccountScreen({ onBack, onViewOrders, onViewLegal, onViewFavorites, onViewStatement, onLogout }) {
  const user = api.getStoredUser();
  const [addresses, setAddresses] = useState([]);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [pushEnabled, setPushEnabled] = useState(null); // null = loading, then true/false
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');

  useEffect(() => {
    api.getSavedAddresses().then(setAddresses).catch(() => {}).finally(() => setLoadingAddresses(false));
  }, []);

  useEffect(() => {
    if (!isPushSupported()) {
      setPushEnabled(false);
      return;
    }
    // Server-side truth, not just browser permission — those two can genuinely disagree
    api.getPushStatus().then((s) => setPushEnabled(s.subscribed)).catch(() => setPushEnabled(false));
  }, []);

  async function togglePush() {
    setPushError('');
    setPushBusy(true);
    try {
      if (pushEnabled) {
        await disablePushNotifications();
        setPushEnabled(false);
      } else {
        await enablePushNotifications();
        setPushEnabled(true);
      }
    } catch (err) {
      setPushError(err.message);
    } finally {
      setPushBusy(false);
    }
  }

  async function addAddress() {
    if (!newLabel.trim() || !newAddress.trim()) return;
    setSaving(true);
    setError('');
    try {
      // No live location picker here — saved from My Account uses a default point;
      // editing the actual coordinates happens at checkout time via "Use my location".
      const updated = await api.saveAddress({ label: newLabel.trim(), address: newAddress.trim(), latitude: 17.45, longitude: 78.39 });
      setAddresses(updated);
      setNewLabel('');
      setNewAddress('');
      setShowAddForm(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeAddress(id) {
    try {
      const updated = await api.removeAddress(id);
      setAddresses(updated);
    } catch (err) {
      setError(err.message);
    }
  }

  const initial = (user?.name || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="screen">
      <button className="btn-secondary" onClick={onBack} style={{ marginBottom: 16 }}>
        ← Back
      </button>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 56, height: 56, borderRadius: '50%', background: 'var(--accent-gradient)',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 800, flexShrink: 0,
          }}
        >
          {initial}
        </div>
        <div>
          <p style={{ fontSize: 19, fontWeight: 800, color: 'var(--charcoal)' }}>{user?.name || 'Account'}</p>
          <p className="muted">{user?.phone}</p>
        </div>
      </div>

      <div className="row" style={{ gap: 12, marginBottom: 14 }}>
        <div className="card" style={{ flex: 1, marginBottom: 0 }}>
          <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>💰 Wallet</p>
          <p style={{ fontSize: 20, fontWeight: 800, color: 'var(--charcoal)' }}>₹0</p>
        </div>
        <div className="card" style={{ flex: 1, marginBottom: 0 }}>
          <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>🎟️ Vouchers</p>
          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--charcoal)' }}>No vouchers yet</p>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <div>
            <p style={{ fontWeight: 700, color: 'var(--charcoal)' }}>🔔 Order notifications</p>
            <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {pushEnabled === null
                ? 'Checking…'
                : pushEnabled
                  ? 'On — you\'ll be notified when your order is accepted, on the way, or delivered'
                  : 'Off — you won\'t get notified about order updates'}
            </p>
          </div>
          {isPushSupported() ? (
            <button className="btn-secondary" onClick={togglePush} disabled={pushEnabled === null || pushBusy}>
              {pushBusy ? '…' : pushEnabled ? 'Turn off' : 'Turn on'}
            </button>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>Not supported here</span>
          )}
        </div>
        {pushError && <div className="error-banner" style={{ marginTop: 8 }}>{pushError}</div>}
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 15 }}>📍 Saved addresses</h3>
          <button className="btn-secondary" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? 'Cancel' : '+ Add'}
          </button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {showAddForm && (
          <div style={{ marginBottom: 14 }}>
            <input
              placeholder="Label it (e.g. Home, Work)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', marginBottom: 8 }}
            />
            <textarea
              placeholder="Flat / house number, street, landmark"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              rows={2}
              style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', marginBottom: 8 }}
            />
            <button className="btn-primary" onClick={addAddress} disabled={saving}>
              {saving ? 'Saving…' : 'Save address'}
            </button>
          </div>
        )}

        {loadingAddresses && <p className="muted">Loading…</p>}
        {!loadingAddresses && addresses.length === 0 && !showAddForm && (
          <p className="muted">No saved addresses yet — add one so checkout is faster next time.</p>
        )}
        {addresses.map((a) => (
          <div key={a.id} className="row" style={{ padding: '10px 0', borderTop: '1px solid #e5ddc9' }}>
            <div>
              <p style={{ fontWeight: 700, color: 'var(--charcoal)' }}>📍 {a.label}</p>
              <p className="muted" style={{ fontSize: 13 }}>{a.address}</p>
            </div>
            <button className="btn-secondary" onClick={() => removeAddress(a.id)} style={{ color: 'var(--chili-dark)' }}>
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <button className="row" style={{ width: '100%', background: 'none', border: 'none', padding: '10px 0', cursor: 'pointer' }} onClick={onViewOrders}>
          <span style={{ color: 'var(--charcoal)', fontWeight: 600 }}>📋 Your orders</span>
          <span className="muted">›</span>
        </button>
        <button className="row" style={{ width: '100%', background: 'none', border: 'none', padding: '10px 0', borderTop: '1px solid #e5ddc9', cursor: 'pointer' }} onClick={onViewFavorites}>
          <span style={{ color: 'var(--charcoal)', fontWeight: 600 }}>❤️ Favorites</span>
          <span className="muted">›</span>
        </button>
        <button className="row" style={{ width: '100%', background: 'none', border: 'none', padding: '10px 0', borderTop: '1px solid #e5ddc9', cursor: 'pointer' }} onClick={onViewStatement}>
          <span style={{ color: 'var(--charcoal)', fontWeight: 600 }}>🧾 Account statement</span>
          <span className="muted">›</span>
        </button>
        <button className="row" style={{ width: '100%', background: 'none', border: 'none', padding: '10px 0', borderTop: '1px solid #e5ddc9', cursor: 'pointer' }} onClick={onViewLegal}>
          <span style={{ color: 'var(--charcoal)', fontWeight: 600 }}>📄 Terms & Privacy</span>
          <span className="muted">›</span>
        </button>
      </div>

      <button className="btn-secondary" onClick={onLogout} style={{ width: '100%', color: 'var(--chili-dark)' }}>
        Log out
      </button>
    </div>
  );
}
