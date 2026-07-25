import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

// Monday-start week, matching the reference's date-range picker.
function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun .. 6 = Sat
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtRange(start, end) {
  const opts = { day: 'numeric', month: 'short' };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, opts)}`;
}

export default function EarningsScreen() {
  const [earnings, setEarnings] = useState(null);
  const [error, setError] = useState('');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [showPayouts, setShowPayouts] = useState(false);
  const [incentives, setIncentives] = useState(null);

  useEffect(() => {
    api.getMyEarnings().then(setEarnings).catch((err) => setError(err.message));
    api.getMyIncentives().then(setIncentives).catch(() => setIncentives([]));
  }, []);

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [weekStart]);

  const thisWeekStart = useMemo(() => startOfWeek(new Date()), []);
  const isCurrentOrFutureWeek = weekStart.getTime() >= thisWeekStart.getTime();

  const weekHistory = useMemo(() => {
    if (!earnings) return [];
    return earnings.history.filter((h) => {
      const d = new Date(h.deliveredAt);
      return d >= weekStart && d <= weekEnd;
    });
  }, [earnings, weekStart, weekEnd]);

  const weeklyTotal = weekHistory.reduce((sum, h) => sum + h.amount, 0);

  function shiftWeek(days) {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + days);
    setWeekStart(next);
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!earnings) {
    return (
      <div>
        <div className="skeleton-card" style={{ textAlign: 'center' }}>
          <div className="skeleton-block" style={{ height: 12, width: '40%', margin: '0 auto 10px' }} />
          <div className="skeleton-block" style={{ height: 34, width: '55%', margin: '0 auto' }} />
        </div>
        <div className="skeleton-card" style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="skeleton-block" style={{ height: 12, width: '70%', margin: '0 auto 8px' }} />
            <div className="skeleton-block" style={{ height: 20, width: '40%', margin: '0 auto' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="skeleton-block" style={{ height: 12, width: '70%', margin: '0 auto 8px' }} />
            <div className="skeleton-block" style={{ height: 20, width: '40%', margin: '0 auto' }} />
          </div>
        </div>
        {[0, 1, 2].map((i) => (
          <div className="skeleton-card" key={i}>
            <div className="skeleton-block" style={{ height: 15, width: '45%', marginBottom: 8 }} />
            <div className="skeleton-block" style={{ height: 12, width: '65%' }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Week navigator + weekly total — computed client-side from the real per-delivery
          history the backend already returns; no new endpoint needed for this view. */}
      <div className="card" style={{ textAlign: 'center', marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'center', gap: 14, marginBottom: 10 }}>
          <button
            className="btn-secondary"
            aria-label="Previous week"
            style={{ padding: '4px 10px', fontSize: 14 }}
            onClick={() => shiftWeek(-7)}
          >
            ‹
          </button>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{fmtRange(weekStart, weekEnd)}</span>
          <button
            className="btn-secondary"
            aria-label="Next week"
            style={{ padding: '4px 10px', fontSize: 14 }}
            onClick={() => shiftWeek(7)}
            disabled={isCurrentOrFutureWeek}
          >
            ›
          </button>
        </div>
        <p style={{ fontSize: 36, fontWeight: 700, margin: 0, color: 'var(--curry)' }}>₹{weeklyTotal.toFixed(0)}</p>
        <p style={{ margin: '2px 0 0', color: '#8a8378', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Your weekly earnings
        </p>
      </div>

      {incentives && incentives.length > 0 && (
        <div className="stack" style={{ marginBottom: 16 }}>
          {incentives.map((inc) => {
            const pct = Math.min(100, Math.round((inc.currentOrders / inc.targetOrders) * 100));
            return (
              <div key={inc.id} className="card" style={{ margin: 0 }}>
                <div className="row" style={{ marginBottom: 6 }}>
                  <strong style={{ fontSize: 14 }}>🎁 {inc.title}</strong>
                  <span
                    className="pill"
                    style={{ background: inc.achieved ? '#e3edd8' : '#fff2d6', color: inc.achieved ? '#2e6b34' : '#8a5a00' }}
                  >
                    {inc.achieved ? 'Earned!' : `+₹${inc.bonusAmount.toFixed(0)}`}
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: '#e5ddc9', overflow: 'hidden', marginBottom: 6 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: inc.achieved ? 'var(--curry)' : 'var(--turmeric)', transition: 'width 0.3s ease' }} />
                </div>
                <p className="muted" style={{ margin: 0, fontSize: 12, color: '#6b6156' }}>
                  {inc.currentOrders} of {inc.targetOrders} deliveries · ends {new Date(inc.validTo).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </p>
              </div>
            );
          })}
        </div>
      )}

      <div className="row" style={{ gap: 10, marginBottom: 16 }}>
        <div className="card" style={{ flex: 1, textAlign: 'center', margin: 0 }}>
          <p style={{ margin: '0 0 4px', color: '#8a8378', fontSize: 12 }}>Earned today</p>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--curry)' }}>₹{earnings.todayTotal.toFixed(0)}</p>
        </div>
        <button className="card" style={{ flex: 1, textAlign: 'center', margin: 0, cursor: 'pointer', border: 'none' }} onClick={() => setShowPayouts((v) => !v)}>
          <p style={{ margin: '0 0 4px', color: '#8a8378', fontSize: 12 }}>Pending payout</p>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>₹{earnings.pendingPayout.toFixed(0)}</p>
        </button>
      </div>

      {showPayouts && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <p style={{ fontWeight: 700, margin: 0, fontSize: 15 }}>Payouts</p>
            <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setShowPayouts(false)}>Close</button>
          </div>
          {earnings.payouts.length === 0 ? (
            <p className="muted" style={{ color: '#8a8378' }}>No payouts settled yet — earnings below are still pending.</p>
          ) : (
            <div className="stack">
              {earnings.payouts.map((p) => (
                <div key={p.id} className="row" style={{ fontSize: 14 }}>
                  <span className="muted" style={{ color: '#6b6156' }}>
                    {new Date(p.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  <strong style={{ color: 'var(--curry)' }}>₹{p.amount.toFixed(0)}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12 }}>
        <div style={{ flex: 1, textAlign: 'center', borderRight: '1px solid #e5ddc9', paddingRight: 12 }}>
          <p style={{ margin: '0 0 4px', color: '#8a8378', fontSize: 12 }}>Lifetime earnings</p>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>₹{earnings.lifetimeTotal.toFixed(0)}</p>
        </div>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', color: '#8a8378', fontSize: 12 }}>Deliveries</p>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{earnings.deliveryCount}</p>
        </div>
      </div>

      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Recent deliveries</h2>
      {earnings.history.length === 0 && <p className="muted">No deliveries yet.</p>}
      <div className="stack">
        {earnings.history.map((h) => (
          <div key={h.orderId} className="card">
            <div className="row">
              <div>
                <p style={{ margin: 0, fontWeight: 600 }}>{h.restaurantName}</p>
                <p style={{ margin: '2px 0 0', color: '#8a8378', fontSize: 13 }}>
                  {new Date(h.deliveredAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {new Date(h.deliveredAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  {h.tipAmount > 0 && <> · 🎁 ₹{h.tipAmount.toFixed(0)} tip</>}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <strong style={{ color: 'var(--curry)', fontSize: 17, display: 'block' }}>+₹{h.amount.toFixed(0)}</strong>
                <span style={{ fontSize: 11, fontWeight: 700, color: h.paidOut ? '#2e6b34' : '#8a5a00' }}>
                  {h.paidOut ? 'Paid out' : 'Pending'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}
