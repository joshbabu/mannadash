import { useEffect, useState } from 'react';
import { api } from '../api';

const STATUS_COLORS = {
  open: { bg: '#f5e0d8', fg: '#a8542a' },
  in_progress: { bg: '#f5eecc', fg: '#8a6a10' },
  resolved: { bg: '#dcefdc', fg: '#2e6b34' },
};

export default function ComplaintsScreen() {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getMyComplaints()
      .then(setComplaints)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Loading complaints…</p>;

  const openCount = complaints.filter((c) => c.status !== 'resolved').length;

  return (
    <div>
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>Complaints</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {openCount > 0 ? `${openCount} still open` : 'All caught up'} — issues customers have reported about their orders
      </p>
      {error && <div className="error-banner">{error}</div>}
      {complaints.length === 0 && <p className="muted">No complaints filed against your orders yet.</p>}
      <div className="stack">
        {complaints.map((c) => (
          <ComplaintCard
            key={c.id}
            complaint={c}
            onUpdated={(updated) => setComplaints((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...updated } : x)))}
          />
        ))}
      </div>
    </div>
  );
}

function ComplaintCard({ complaint, onUpdated }) {
  const [editing, setEditing] = useState(false);
  const [responseText, setResponseText] = useState(complaint.restaurantResponse || '');
  const [status, setStatus] = useState(complaint.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setError('');
    setSaving(true);
    try {
      const body = {};
      if (responseText.trim()) body.responseText = responseText.trim();
      if (status !== complaint.status) body.status = status;
      const updated = await api.respondToComplaint(complaint.id, body);
      onUpdated(updated);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const colors = STATUS_COLORS[complaint.status] || STATUS_COLORS.open;

  return (
    <div className="card">
      <div className="row">
        <div>
          <strong style={{ textTransform: 'capitalize' }}>{complaint.category.replaceAll('_', ' ')}</strong>
          <span
            className="pill"
            style={{ marginLeft: 8, background: colors.bg, color: colors.fg, textTransform: 'capitalize' }}
          >
            {complaint.status.replaceAll('_', ' ')}
          </span>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          {new Date(complaint.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>
      <p style={{ margin: '6px 0 0' }}>{complaint.description}</p>
      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Order #{complaint.order?.id?.slice(0, 8)}</p>

      {complaint.restaurantResponse && !editing && (
        <div style={{ marginTop: 8, marginLeft: 12, paddingLeft: 10, borderLeft: '2px solid var(--turmeric, #d9930d)' }}>
          <p className="muted" style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>Your response</p>
          <p style={{ margin: '2px 0 0', fontSize: 14 }}>{complaint.restaurantResponse}</p>
          <button className="btn-secondary" style={{ fontSize: 12, marginTop: 6 }} onClick={() => setEditing(true)}>
            Edit response
          </button>
        </div>
      )}

      {!complaint.restaurantResponse && !editing && (
        <button className="btn-secondary" style={{ fontSize: 13, marginTop: 8 }} onClick={() => setEditing(true)}>
          Respond
        </button>
      )}

      {editing && (
        <div style={{ marginTop: 8 }}>
          {error && <div className="error-banner">{error}</div>}
          <textarea
            placeholder="Explain what happened, or how you've resolved it…"
            value={responseText}
            onChange={(e) => setResponseText(e.target.value)}
            rows={2}
            style={{ width: '100%', marginBottom: 6 }}
          />
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            {['open', 'in_progress', 'resolved'].map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                aria-pressed={status === s}
                className="btn-secondary"
                style={{
                  fontSize: 12, textTransform: 'capitalize',
                  background: status === s ? 'var(--chili)' : undefined,
                  color: status === s ? '#fff' : undefined,
                }}
              >
                {s.replaceAll('_', ' ')}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              className="btn-secondary"
              onClick={() => { setEditing(false); setResponseText(complaint.restaurantResponse || ''); setStatus(complaint.status); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
