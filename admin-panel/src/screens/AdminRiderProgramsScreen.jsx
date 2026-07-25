import { useEffect, useState } from 'react';
import { api } from '../api';

function toLocalInputValue(date) {
  // Adjust for timezone offset so <input type="datetime-local"> shows local time correctly
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

export default function AdminRiderProgramsScreen() {
  const [subTab, setSubTab] = useState('shifts');

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['shifts', 'incentives', 'announcements', 'referrals', 'sos'].map((t) => (
          <button
            key={t}
            className="btn-secondary"
            aria-pressed={subTab === t}
            onClick={() => setSubTab(t)}
            style={{
              fontSize: 12, textTransform: 'capitalize',
              background: subTab === t ? 'var(--chili, #c1432e)' : undefined,
              color: subTab === t ? '#fff' : undefined,
            }}
          >
            {t === 'sos' ? 'SOS alerts' : t}
          </button>
        ))}
      </div>

      {subTab === 'shifts' && <ShiftsAdmin />}
      {subTab === 'incentives' && <IncentivesAdmin />}
      {subTab === 'announcements' && <AnnouncementsAdmin />}
      {subTab === 'referrals' && <ReferralsAdmin />}
      {subTab === 'sos' && <SosAlertsAdmin />}
    </div>
  );
}

function ShiftsAdmin() {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const now = new Date();
  const inOneHour = new Date(now.getTime() + 3600_000);
  const inFiveHours = new Date(now.getTime() + 3600_000 * 5);

  const [label, setLabel] = useState('Lunch');
  const [startAt, setStartAt] = useState(toLocalInputValue(inOneHour));
  const [endAt, setEndAt] = useState(toLocalInputValue(inFiveHours));
  const [minPay, setMinPay] = useState('125');
  const [maxPay, setMaxPay] = useState('185');

  function load() {
    setLoading(true);
    api.getShifts().then(setShifts).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function create() {
    setError('');
    setCreating(true);
    try {
      await api.createShift({
        label,
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        minPayPerHour: Number(minPay),
        maxPayPerHour: Number(maxPay),
      });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}
      <div className="card" style={{ marginBottom: 20 }}>
        <p style={{ fontWeight: 700, margin: '0 0 10px' }}>Post a new shift</p>
        <div className="stack">
          <input placeholder="Label (e.g. Lunch, Snacks, Late Night)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 160, fontSize: 13 }}>
              Start
              <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
            </label>
            <label style={{ flex: 1, minWidth: 160, fontSize: 13 }}>
              End
              <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input placeholder="Min ₹/hour" type="number" value={minPay} onChange={(e) => setMinPay(e.target.value)} style={{ flex: 1 }} />
            <input placeholder="Max ₹/hour" type="number" value={maxPay} onChange={(e) => setMaxPay(e.target.value)} style={{ flex: 1 }} />
          </div>
          <button className="btn-approve" onClick={create} disabled={creating || !label}>
            {creating ? 'Posting…' : 'Post shift'}
          </button>
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 10 }}>Upcoming shifts</h2>
      {loading && <p className="muted">Loading…</p>}
      {!loading && shifts.length === 0 && <p className="muted">No upcoming shifts posted.</p>}
      <div className="stack">
        {shifts.map((s) => (
          <div key={s.id} className="card">
            <div className="row" style={{ marginBottom: 4 }}>
              <strong>{s.label}</strong>
              <span className="pill verified">{s.bookedCount} booked</span>
            </div>
            <p className="muted" style={{ margin: 0 }}>
              {new Date(s.startAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} –{' '}
              {new Date(s.endAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ₹{Number(s.minPayPerHour).toFixed(0)}–₹{Number(s.maxPayPerHour).toFixed(0)}/hr
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function IncentivesAdmin() {
  const [incentives, setIncentives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const now = new Date();
  const inOneWeek = new Date(now.getTime() + 3600_000 * 24 * 7);

  const [title, setTitle] = useState('');
  const [targetOrders, setTargetOrders] = useState('20');
  const [bonusAmount, setBonusAmount] = useState('200');
  const [validFrom, setValidFrom] = useState(toLocalInputValue(now));
  const [validTo, setValidTo] = useState(toLocalInputValue(inOneWeek));

  function load() {
    setLoading(true);
    api.getIncentives().then(setIncentives).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function create() {
    setError('');
    setCreating(true);
    try {
      await api.createIncentive({
        title,
        targetOrders: Number(targetOrders),
        bonusAmount: Number(bonusAmount),
        validFrom: new Date(validFrom).toISOString(),
        validTo: new Date(validTo).toISOString(),
      });
      setTitle('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function deactivate(id) {
    setError('');
    try {
      await api.deactivateIncentive(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}
      <div className="card" style={{ marginBottom: 20 }}>
        <p style={{ fontWeight: 700, margin: '0 0 10px' }}>Create an incentive campaign</p>
        <div className="stack">
          <input placeholder="Title (e.g. Weekend push)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input placeholder="Target deliveries" type="number" value={targetOrders} onChange={(e) => setTargetOrders(e.target.value)} style={{ flex: 1 }} />
            <input placeholder="Bonus (₹)" type="number" value={bonusAmount} onChange={(e) => setBonusAmount(e.target.value)} style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 160, fontSize: 13 }}>
              Valid from
              <input type="datetime-local" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
            </label>
            <label style={{ flex: 1, minWidth: 160, fontSize: 13 }}>
              Valid to
              <input type="datetime-local" value={validTo} onChange={(e) => setValidTo(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
            </label>
          </div>
          <button className="btn-approve" onClick={create} disabled={creating || !title}>
            {creating ? 'Creating…' : 'Create incentive'}
          </button>
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 10 }}>All incentives</h2>
      {loading && <p className="muted">Loading…</p>}
      <div className="stack">
        {incentives.map((inc) => (
          <div key={inc.id} className="card">
            <div className="row" style={{ marginBottom: 4 }}>
              <strong>{inc.title}</strong>
              <span className={`pill ${inc.active ? 'approved' : 'pending'}`}>{inc.active ? 'active' : 'inactive'}</span>
            </div>
            <p className="muted" style={{ margin: '0 0 8px' }}>
              {inc.targetOrders} deliveries → ₹{Number(inc.bonusAmount).toFixed(0)} ·{' '}
              {new Date(inc.validFrom).toLocaleDateString()} – {new Date(inc.validTo).toLocaleDateString()}
            </p>
            {inc.active && (
              <button className="btn-suspend" onClick={() => deactivate(inc.id)}>Deactivate</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AnnouncementsAdmin() {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  function load() {
    setLoading(true);
    api.getAnnouncements().then(setAnnouncements).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function create() {
    setError('');
    setCreating(true);
    try {
      await api.createAnnouncement({ title, body });
      setTitle('');
      setBody('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function deactivate(id) {
    setError('');
    try {
      await api.deactivateAnnouncement(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}
      <div className="card" style={{ marginBottom: 20 }}>
        <p style={{ fontWeight: 700, margin: '0 0 10px' }}>Send an announcement to all riders</p>
        <div className="stack">
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} />
          <textarea placeholder="Message" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} />
          <button className="btn-approve" onClick={create} disabled={creating || !title || !body}>
            {creating ? 'Sending…' : 'Send to all riders'}
          </button>
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 10 }}>Sent announcements</h2>
      {loading && <p className="muted">Loading…</p>}
      <div className="stack">
        {announcements.map((a) => (
          <div key={a.id} className="card">
            <div className="row" style={{ marginBottom: 4 }}>
              <strong>{a.title}</strong>
              <span className={`pill ${a.active ? 'approved' : 'pending'}`}>{a.active ? 'active' : 'inactive'}</span>
            </div>
            <p className="muted" style={{ margin: '0 0 8px' }}>{a.body}</p>
            {a.active && (
              <button className="btn-suspend" onClick={() => deactivate(a.id)}>Take down</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReferralsAdmin() {
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getReferrals().then(setReferrals).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}
      <h2 style={{ fontSize: 16, marginBottom: 10 }}>All referrals</h2>
      {loading && <p className="muted">Loading…</p>}
      {!loading && referrals.length === 0 && <p className="muted">No referrals recorded yet.</p>}
      <div className="stack">
        {referrals.map((r) => (
          <div key={r.id} className="card">
            <p style={{ margin: 0 }}>
              <strong>{r.referrerName}</strong> referred <strong>{r.refereeName}</strong>
            </p>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              {new Date(r.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function SosAlertsAdmin() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getSosAlerts().then(setAlerts).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}
      <h2 style={{ fontSize: 16, marginBottom: 10 }}>Recent SOS alerts</h2>
      {loading && <p className="muted">Loading…</p>}
      {!loading && alerts.length === 0 && <p className="muted">No SOS alerts — good sign.</p>}
      <div className="stack">
        {alerts.map((a) => (
          <div key={a.id} className="card" style={{ borderLeft: '4px solid var(--chili, #c1432e)' }}>
            <div className="row" style={{ marginBottom: 4 }}>
              <strong>{a.riderName}</strong>
              <span className="muted">{a.riderPhone}</span>
            </div>
            <p className="muted" style={{ margin: '0 0 6px' }}>
              {new Date(a.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
            <a
              href={`https://www.google.com/maps?q=${a.latitude},${a.longitude}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 13, fontWeight: 600 }}
            >
              📍 View location on map
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
