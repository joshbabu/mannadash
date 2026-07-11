import { useEffect, useState } from 'react';
import { api } from '../api';

export default function ReviewsScreen({ restaurant }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getRestaurantReviews(restaurant.id)
      .then(setReviews)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [restaurant.id]);

  if (loading) return <p className="muted">Loading reviews…</p>;

  return (
    <div>
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>Reviews</h2>
      <p className="muted" style={{ marginTop: 0 }}>What customers are saying — reply to any of them</p>
      {error && <div className="error-banner">{error}</div>}
      {reviews.length === 0 && <p className="muted">No reviews yet.</p>}
      <div className="stack">
        {reviews.map((r) => (
          <ReviewCard key={r.id} review={r} onReplied={(updated) => setReviews((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...updated } : x)))} />
        ))}
      </div>
    </div>
  );
}

function ReviewCard({ review, onReplied }) {
  const [editing, setEditing] = useState(false);
  const [replyText, setReplyText] = useState(review.replyText || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setError('');
    setSaving(true);
    try {
      const updated = await api.replyToRating(review.id, replyText);
      onReplied(updated);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <div className="row">
        <div>
          <strong>{review.customerName}</strong>{' '}
          <span style={{ color: 'var(--turmeric, #d9930d)' }}>{'★'.repeat(review.restaurantRating)}</span>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          {new Date(review.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      </div>
      {review.comment && <p style={{ margin: '6px 0 0' }}>{review.comment}</p>}

      {review.replyText && !editing && (
        <div style={{ marginTop: 8, marginLeft: 12, paddingLeft: 10, borderLeft: '2px solid var(--turmeric, #d9930d)' }}>
          <p className="muted" style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>Your reply</p>
          <p style={{ margin: '2px 0 0', fontSize: 14 }}>{review.replyText}</p>
          <button className="btn-secondary" style={{ fontSize: 12, marginTop: 6 }} onClick={() => setEditing(true)}>
            Edit reply
          </button>
        </div>
      )}

      {!review.replyText && !editing && (
        <button className="btn-secondary" style={{ fontSize: 13, marginTop: 8 }} onClick={() => setEditing(true)}>
          Reply
        </button>
      )}

      {editing && (
        <div style={{ marginTop: 8 }}>
          {error && <div className="error-banner">{error}</div>}
          <textarea
            placeholder="Thank the customer, or address their feedback…"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={2}
            style={{ width: '100%', marginBottom: 6 }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-primary" onClick={save} disabled={saving || !replyText.trim()}>
              {saving ? 'Saving…' : 'Save reply'}
            </button>
            <button className="btn-secondary" onClick={() => { setEditing(false); setReplyText(review.replyText || ''); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
