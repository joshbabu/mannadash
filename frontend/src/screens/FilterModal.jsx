import { useState } from 'react';

const RATING_OPTIONS = [3.5, 4.0];
const PRICE_OPTIONS = [
  { key: 'under200', label: 'Under ₹200' },
  { key: '200to400', label: '₹200–400' },
  { key: 'above400', label: 'Above ₹400' },
];

export default function FilterModal({ filters, onChangeFilters, sortBy, onChangeSortBy, scheduledFor, onSetScheduledFor, onClose, resultCount }) {
  const [showScheduleInput, setShowScheduleInput] = useState(false);
  const [scheduleInputValue, setScheduleInputValue] = useState('');
  const [scheduleError, setScheduleError] = useState('');

  function set(key, value) {
    onChangeFilters((prev) => ({ ...prev, [key]: value }));
  }

  function confirmSchedule() {
    if (!scheduleInputValue) return;
    const chosen = new Date(scheduleInputValue);
    const minLeadMs = 30 * 60 * 1000;
    const maxLeadMs = 7 * 24 * 60 * 60 * 1000;
    const msUntil = chosen.getTime() - Date.now();
    // Mirrors the backend's own bounds exactly — no point letting someone pick a time
    // here that the actual order request would just reject a moment later
    if (msUntil < minLeadMs) {
      setScheduleError('Please choose a time at least 30 minutes from now.');
      return;
    }
    if (msUntil > maxLeadMs) {
      setScheduleError('Scheduling is only available up to 7 days ahead.');
      return;
    }
    setScheduleError('');
    onSetScheduledFor(chosen.toISOString());
    setShowScheduleInput(false);
  }

  const minDateTime = new Date(Date.now() + 30 * 60 * 1000).toISOString().slice(0, 16);
  const maxDateTime = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);

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
        <div className="row" style={{ marginBottom: 4 }}>
          <h3 style={{ fontSize: 18 }}>Filters and sorting</h3>
          <button
            className="btn-secondary"
            onClick={() => { onChangeFilters(() => ({ nearFast: false, noPackaging: false, pureVeg: false, ratingMin: null, hasOffer: false, priceRange: null, fssaiCertified: false })); onSetScheduledFor(null); }}
          >
            Clear All
          </button>
        </div>

        <p className="muted" style={{ fontSize: 12, marginBottom: 4, marginTop: 12 }}>SORT BY</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { key: 'distance', label: 'Distance' },
            { key: 'rating', label: 'Rating' },
            { key: 'deliveryTime', label: 'Delivery time' },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => onChangeSortBy(opt.key)}
              aria-pressed={sortBy === opt.key}
              style={pillStyle(sortBy === opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>TIME</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button onClick={() => set('nearFast', !filters.nearFast)} aria-pressed={filters.nearFast} style={pillStyle(filters.nearFast)}>
            ⚡ Near & Fast
          </button>
          <button onClick={() => setShowScheduleInput(!showScheduleInput)} aria-pressed={!!scheduledFor} style={pillStyle(!!scheduledFor)}>
            📅 Schedule
          </button>
        </div>
        {showScheduleInput && (
          <div style={{ marginBottom: 16 }}>
            <input
              type="datetime-local"
              value={scheduleInputValue}
              min={minDateTime}
              max={maxDateTime}
              onChange={(e) => setScheduleInputValue(e.target.value)}
              style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', marginBottom: 8 }}
            />
            {scheduleError && <div className="error-banner">{scheduleError}</div>}
            <button className="btn-primary" onClick={confirmSchedule}>Confirm time</button>
          </div>
        )}

        <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>RESTAURANT RATING</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {RATING_OPTIONS.map((r) => (
            <button
              key={r}
              onClick={() => set('ratingMin', filters.ratingMin === r ? null : r)}
              aria-pressed={filters.ratingMin === r}
              style={pillStyle(filters.ratingMin === r)}
            >
              ⭐ Rated {r.toFixed(1)}+
            </button>
          ))}
        </div>

        <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>OFFERS</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button onClick={() => set('hasOffer', !filters.hasOffer)} aria-pressed={filters.hasOffer} style={pillStyle(filters.hasOffer)}>
            🏷️ Has an offer
          </button>
        </div>

        <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>DISH PRICE</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {PRICE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => set('priceRange', filters.priceRange === opt.key ? null : opt.key)}
              aria-pressed={filters.priceRange === opt.key}
              style={pillStyle(filters.priceRange === opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <p className="muted" style={{ fontSize: 12, marginBottom: 4 }}>TRUST MARKERS</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <button onClick={() => set('fssaiCertified', !filters.fssaiCertified)} aria-pressed={filters.fssaiCertified} style={pillStyle(filters.fssaiCertified)}>
            ✅ FSSAI Certified
          </button>
        </div>

        <button className="btn-primary" onClick={onClose}>
          Show {resultCount} result{resultCount === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  );
}

function pillStyle(active) {
  return {
    padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    background: active ? 'var(--chili)' : '#fdf8ef',
    color: active ? '#fff' : 'var(--charcoal)',
    border: active ? '1px solid var(--chili-dark)' : '1px solid #e5ddc9',
  };
}
