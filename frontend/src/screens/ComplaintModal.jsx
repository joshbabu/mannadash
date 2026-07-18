import { useState } from 'react';
import { api } from '../api';

const CATEGORIES = [
  { key: 'wrong_item', icon: '🔀', label: 'Wrong item' },
  { key: 'missing_item', icon: '❓', label: 'Missing item' },
  { key: 'quality_issue', icon: '👎', label: 'Quality issue' },
  { key: 'late_delivery', icon: '🕐', label: 'Late delivery' },
  { key: 'other', icon: '💬', label: 'Other' },
];

export default function ComplaintModal({ orderId, onClose, onFiled }) {
  const [category, setCategory] = useState(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!category || description.trim().length < 5) return;
    setSubmitting(true);
    setError('');
    try {
      const complaint = await api.fileComplaint(orderId, { category, description: description.trim() });
      onFiled(complaint);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', borderRadius: '24px 24px 0 0', marginBottom: 0 }}
      >
        <h3 style={{ fontSize: 18, marginBottom: 4 }}>Report an issue</h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>What went wrong with this order?</p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              aria-pressed={category === c.key}
              style={{
                padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                background: category === c.key ? 'var(--chili)' : '#fdf8ef',
                color: category === c.key ? '#fff' : 'var(--charcoal)',
                border: category === c.key ? '1px solid var(--chili-dark)' : '1px solid #e5ddc9',
              }}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>

        <textarea
          placeholder="Tell us more about what happened…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          maxLength={1000}
          style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', marginBottom: 8 }}
        />
        <p className="muted" style={{ fontSize: 11, marginBottom: 16, textAlign: 'right' }}>{description.length}/1000</p>

        {error && <div className="error-banner">{error}</div>}

        <button
          className="btn-primary"
          onClick={submit}
          disabled={submitting || !category || description.trim().length < 5}
        >
          {submitting ? 'Submitting…' : 'Submit report'}
        </button>
      </div>
    </div>
  );
}
