import { useEffect, useState } from 'react';
import { api } from '../api';
import { enablePushNotifications, disablePushNotifications, isPushSupported } from '../utils/pushNotifications';

// Masks all but the last 4 digits — same convention as the customer app's account screen.
function maskPhone(phone) {
  if (!phone) return '';
  return phone.length <= 4 ? phone : `${'X'.repeat(phone.length - 4)}${phone.slice(-4)}`;
}

export default function AccountScreen({ rider, ratingAvg, ratingCount, isVerified, onLogout }) {
  const [pushSubscribed, setPushSubscribed] = useState(null);
  const [pushError, setPushError] = useState('');
  const [pushToggleBusy, setPushToggleBusy] = useState(false);

  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwChanged, setPwChanged] = useState(false);
  const [changingPw, setChangingPw] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) {
      setPushSubscribed(false);
      return;
    }
    api.getPushStatus().then((s) => setPushSubscribed(s.subscribed)).catch(() => setPushSubscribed(false));
  }, []);

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
      }
    } catch (err) {
      setPushError(err.message);
    } finally {
      setPushToggleBusy(false);
    }
  }

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

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ marginBottom: 10 }}>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 18 }}>{rider.name}</p>
            <p className="muted" style={{ color: '#6b6156', margin: '2px 0 0' }}>{maskPhone(rider.phone)}</p>
          </div>
          {ratingAvg > 0 && <span className="pill">★ {ratingAvg.toFixed(1)} ({ratingCount})</span>}
        </div>
        <div className="row" style={{ fontSize: 13, color: '#6b6156' }}>
          <span>🛵 {rider.vehicleType ? rider.vehicleType.charAt(0).toUpperCase() + rider.vehicleType.slice(1) : 'Not set'}</span>
          <span style={{ color: isVerified ? '#2e6b34' : '#8a5a00', fontWeight: 700 }}>
            {isVerified ? '✓ Verified' : 'Pending verification'}
          </span>
        </div>
      </div>

      {isPushSupported() && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p style={{ fontWeight: 700, margin: '0 0 4px' }}>🔔 Delivery notifications</p>
          <p className="muted" style={{ margin: '0 0 12px', fontSize: 13, color: '#6b6156' }}>
            {pushSubscribed
              ? "You'll be notified the moment a new delivery comes in, even with the app closed"
              : "You won't be notified of new deliveries unless the app is open"}
          </p>
          <button className="btn-secondary" onClick={togglePushSubscription} disabled={pushSubscribed === null || pushToggleBusy}>
            {pushToggleBusy ? '…' : pushSubscribed ? 'Turn off' : 'Turn on'}
          </button>
          {pushError && <p className="muted" style={{ marginTop: 8, color: 'var(--chili)', fontSize: 12 }}>{pushError}</p>}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
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

      <button className="btn-stop" onClick={onLogout}>Log out</button>
    </div>
  );
}
