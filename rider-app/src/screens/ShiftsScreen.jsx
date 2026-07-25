import { useEffect, useState } from 'react';
import { api } from '../api';

function fmtTime(d) {
  return new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtDay(d) {
  return new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function ShiftsScreen() {
  const [shifts, setShifts] = useState(null);
  const [error, setError] = useState('');
  const [bookingId, setBookingId] = useState(null); // which shift is mid-request, disables its own button only

  useEffect(() => {
    load();
  }, []);

  function load() {
    api.getShifts().then(setShifts).catch((err) => setError(err.message));
  }

  async function toggleBooking(shift) {
    setError('');
    setBookingId(shift.id);
    try {
      if (shift.bookedByMe) {
        await api.unbookShift(shift.id);
      } else {
        await api.bookShift(shift.id);
      }
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBookingId(null);
    }
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!shifts) {
    return (
      <div className="stack">
        {[0, 1, 2].map((i) => (
          <div className="skeleton-card" key={i}>
            <div className="skeleton-block" style={{ height: 15, width: '40%', marginBottom: 10 }} />
            <div className="skeleton-block" style={{ height: 12, width: '60%' }} />
          </div>
        ))}
      </div>
    );
  }

  if (shifts.length === 0) {
    return <p className="muted">No upcoming shifts posted right now — check back later.</p>;
  }

  // Group by day first, then by label within the day — mirrors the reference's
  // date-tab-then-Lunch/Snacks-section layout, just as a single scrollable list instead
  // of a separate date-picker row (fewer taps for the same information).
  const byDay = {};
  shifts.forEach((s) => {
    const dayKey = fmtDay(s.startAt);
    if (!byDay[dayKey]) byDay[dayKey] = [];
    byDay[dayKey].push(s);
  });

  return (
    <div>
      {Object.entries(byDay).map(([day, dayShifts]) => (
        <div key={day} style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 10 }}>
            {day}
          </p>
          <div className="stack">
            {dayShifts.map((shift) => (
              <div key={shift.id} className="card">
                <div className="row" style={{ marginBottom: 6 }}>
                  <strong style={{ fontSize: 15 }}>{shift.label}</strong>
                  <button
                    onClick={() => toggleBooking(shift)}
                    disabled={bookingId === shift.id}
                    style={{
                      width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                      border: shift.bookedByMe ? 'none' : '2px solid #d8cdb8',
                      background: shift.bookedByMe ? 'var(--curry)' : '#fff',
                      color: '#fff', fontSize: 15, fontWeight: 900, lineHeight: 1,
                    }}
                    aria-label={shift.bookedByMe ? `Unbook ${shift.label}` : `Book ${shift.label}`}
                  >
                    {shift.bookedByMe ? '✓' : ''}
                  </button>
                </div>
                <p className="muted" style={{ color: '#6b6156', margin: '0 0 2px' }}>
                  {fmtTime(shift.startAt)} – {fmtTime(shift.endAt)}
                </p>
                <p className="muted" style={{ color: '#6b6156', margin: 0, fontSize: 13 }}>
                  ₹{shift.minPayPerHour.toFixed(0)} – ₹{shift.maxPayPerHour.toFixed(0)} per hour
                  {shift.bookedCount > 0 && ` · ${shift.bookedCount} rider${shift.bookedCount === 1 ? '' : 's'} booked`}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
