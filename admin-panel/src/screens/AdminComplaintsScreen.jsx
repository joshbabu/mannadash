import { useEffect, useState } from 'react';
import { api } from '../api';

const STATUS_COLORS = {
  open: { bg: '#f5e0d8', fg: '#a8542a' },
  in_progress: { bg: '#f5eecc', fg: '#8a6a10' },
  resolved: { bg: '#dcefdc', fg: '#2e6b34' },
};

export default function AdminComplaintsScreen() {
  const [complaints, setComplaints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    api
      .getAllComplaints()
      .then(setComplaints)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Loading complaints…</p>;

  const filtered = statusFilter === 'all' ? complaints : complaints.filter((c) => c.status === statusFilter);
  const openCount = complaints.filter((c) => c.status === 'open').length;

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}
      <p className="muted" style={{ marginTop: 0 }}>
        {complaints.length} complaint{complaints.length === 1 ? '' : 's'} total, {openCount} still open
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['all', 'open', 'in_progress', 'resolved'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            aria-pressed={statusFilter === s}
            aria-label={`Filter: ${s.replaceAll('_', ' ')}`}
            className="btn-secondary"
            style={{
              fontSize: 12, textTransform: 'capitalize',
              background: statusFilter === s ? 'var(--chili, #c1432e)' : undefined,
              color: statusFilter === s ? '#fff' : undefined,
            }}
          >
            {s.replaceAll('_', ' ')}
          </button>
        ))}
      </div>

      {filtered.length === 0 && <p className="muted">No complaints match this filter.</p>}
      <div className="stack">
        {filtered.map((c) => (
          <AdminComplaintCard
            key={c.id}
            complaint={c}
            onUpdated={(updated) => setComplaints((prev) => prev.map((x) => (x.id === c.id ? { ...x, ...updated } : x)))}
          />
        ))}
      </div>
    </div>
  );
}

function AdminComplaintCard({ complaint, onUpdated }) {
  const [status, setStatus] = useState(complaint.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function updateStatus(newStatus) {
    setError('');
    setSaving(true);
    setStatus(newStatus);
    try {
      const updated = await api.respondToComplaint(complaint.id, { status: newStatus });
      onUpdated(updated);
    } catch (err) {
      setError(err.message);
      setStatus(complaint.status); // revert the optimistic change on failure
    } finally {
      setSaving(false);
    }
  }

  const colors = STATUS_COLORS[complaint.status] || STATUS_COLORS.open;

  return (
    <div className="card">
      <div className="row">
        <div>
          <strong>{complaint.order?.restaurant?.name}</strong>
          <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
            {complaint.order?.customer?.user?.name}
          </span>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          {new Date(complaint.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>
      <div style={{ marginTop: 4 }}>
        <strong style={{ textTransform: 'capitalize', fontSize: 14 }}>{complaint.category.replaceAll('_', ' ')}</strong>
        <span className="pill" style={{ marginLeft: 8, background: colors.bg, color: colors.fg, textTransform: 'capitalize' }}>
          {complaint.status.replaceAll('_', ' ')}
        </span>
      </div>
      <p style={{ margin: '6px 0 0' }}>{complaint.description}</p>
      {complaint.restaurantResponse && (
        <div style={{ marginTop: 8, marginLeft: 12, paddingLeft: 10, borderLeft: '2px solid var(--chili, #c1432e)' }}>
          <p className="muted" style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>Restaurant's response</p>
          <p style={{ margin: '2px 0 0', fontSize: 14 }}>{complaint.restaurantResponse}</p>
        </div>
      )}

      {error && <div className="error-banner" style={{ marginTop: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {['open', 'in_progress', 'resolved'].map((s) => (
          <button
            key={s}
            onClick={() => updateStatus(s)}
            disabled={saving || status === s}
            aria-label={`Mark ${s.replaceAll('_', ' ')}`}
            className="btn-secondary"
            style={{
              fontSize: 12, textTransform: 'capitalize',
              background: status === s ? 'var(--chili, #c1432e)' : undefined,
              color: status === s ? '#fff' : undefined,
            }}
          >
            {s.replaceAll('_', ' ')}
          </button>
        ))}
      </div>
    </div>
  );
}
