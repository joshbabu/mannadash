import { useEffect, useState } from 'react';
import { api } from '../api';

export default function InsightsScreen() {
  const [insights, setInsights] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getMyInsights().then(setInsights).catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="error-banner">{error}</div>;
  if (!insights) return <p className="muted">Loading insights…</p>;

  const maxHourCount = Math.max(...insights.ordersByHour.map((h) => h.count), 1);

  return (
    <div>
      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="muted" style={{ marginBottom: 4 }}>Today's revenue</p>
          <p style={{ fontSize: 26, fontWeight: 700, margin: 0, color: 'var(--curry)' }}>
            ₹{insights.todayRevenue.toFixed(0)}
          </p>
          <p className="muted" style={{ marginTop: 2 }}>{insights.todayOrders} orders</p>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="muted" style={{ marginBottom: 4 }}>Lifetime revenue</p>
          <p style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>₹{insights.lifetimeRevenue.toFixed(0)}</p>
          <p className="muted" style={{ marginTop: 2 }}>{insights.lifetimeOrders} orders</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12 }}>Last 7 days vs. the 7 before that</h3>
        <div className="row">
          <span>Revenue</span>
          <strong>
            ₹{insights.weekOverWeek.thisWeekRevenue.toFixed(0)}
            {insights.weekOverWeek.pctChange !== null && (
              <span style={{ color: insights.weekOverWeek.pctChange >= 0 ? 'var(--curry)' : 'var(--chili)', marginLeft: 8, fontSize: 14 }}>
                {insights.weekOverWeek.pctChange >= 0 ? '▲' : '▼'} {Math.abs(insights.weekOverWeek.pctChange)}%
              </span>
            )}
          </strong>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <span>Orders</span>
          <strong>{insights.weekOverWeek.thisWeekOrders} <span className="muted">vs {insights.weekOverWeek.lastWeekOrders} last week</span></strong>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="muted" style={{ marginBottom: 4 }}>Repeat customers</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--curry)' }}>{insights.repeatCustomerRate}%</p>
          <p className="muted" style={{ marginTop: 2, fontSize: 12 }}>have ordered more than once</p>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="muted" style={{ marginBottom: 4 }}>Cancellation rate</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: 0, color: insights.cancellationRate > 10 ? 'var(--chili)' : 'var(--charcoal)' }}>
            {insights.cancellationRate}%
          </p>
          <p className="muted" style={{ marginTop: 2, fontSize: 12 }}>of orders end up cancelled</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12 }}>Orders by hour of day</h3>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
          {insights.ordersByHour.map((h) => (
            <div
              key={h.hour}
              title={`${h.hour}:00 — ${h.count} order${h.count === 1 ? '' : 's'}`}
              style={{
                flex: 1,
                height: `${Math.max(4, (h.count / maxHourCount) * 100)}%`,
                background: h.count > 0 ? 'var(--chili)' : '#eee5d3',
                borderRadius: 2,
              }}
            />
          ))}
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <span className="muted" style={{ fontSize: 11 }}>12am</span>
          <span className="muted" style={{ fontSize: 11 }}>12pm</span>
          <span className="muted" style={{ fontSize: 11 }}>11pm</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12 }}>Top-selling items</h3>
        {insights.topItems.length === 0 && <p className="muted">No completed orders yet.</p>}
        <div className="stack" style={{ gap: 8 }}>
          {insights.topItems.map((item, i) => (
            <div className="row" key={item.name}>
              <span>{i + 1}. {item.name}</span>
              <strong>{item.quantity} sold</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15, marginBottom: 12 }}>Your speed, honestly measured</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          This is how fast you actually respond — not a promise, your real average.
        </p>
        <div className="grid-2">
          <div style={{ textAlign: 'center' }}>
            <p className="muted" style={{ marginBottom: 4 }}>Avg. time to accept</p>
            <p style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
              {insights.avgAcceptMinutes !== null ? `${insights.avgAcceptMinutes}m` : '—'}
            </p>
          </div>
          <div style={{ textAlign: 'center' }}>
            <p className="muted" style={{ marginBottom: 4 }}>Avg. time to prepare</p>
            <p style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
              {insights.avgPrepMinutes !== null ? `${insights.avgPrepMinutes}m` : '—'}
            </p>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 4 }}>Are your offers actually working?</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          Whether orders using an offer are genuinely bigger than ones that aren't — not just how many times it's been used.
        </p>

        {insights.discountEffectiveness.avgOrderValueWithOffer === null ? (
          <p className="muted">No orders have used an offer yet — nothing to compare.</p>
        ) : (
          <div className="grid-2" style={{ marginBottom: 16 }}>
            <div style={{ textAlign: 'center' }}>
              <p className="muted" style={{ marginBottom: 4 }}>Avg. order with an offer</p>
              <p style={{ fontSize: 22, fontWeight: 700, margin: 0, color: 'var(--curry)' }}>
                ₹{insights.discountEffectiveness.avgOrderValueWithOffer.toFixed(0)}
              </p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p className="muted" style={{ marginBottom: 4 }}>Avg. order without one</p>
              <p style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
                {insights.discountEffectiveness.avgOrderValueWithoutOffer !== null
                  ? `₹${insights.discountEffectiveness.avgOrderValueWithoutOffer.toFixed(0)}`
                  : '—'}
              </p>
            </div>
          </div>
        )}

        {insights.discountEffectiveness.liftPercent !== null && (
          <p style={{ textAlign: 'center', marginBottom: 16 }}>
            <span style={{ color: insights.discountEffectiveness.liftPercent >= 0 ? 'var(--curry)' : 'var(--chili)', fontWeight: 700 }}>
              {insights.discountEffectiveness.liftPercent >= 0 ? '▲' : '▼'} {Math.abs(insights.discountEffectiveness.liftPercent)}%
            </span>
            <span className="muted"> {insights.discountEffectiveness.liftPercent >= 0 ? 'bigger' : 'smaller'} orders when an offer's used</span>
          </p>
        )}

        {insights.discountEffectiveness.perOffer.length === 0 ? (
          <p className="muted">No offers created yet.</p>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {insights.discountEffectiveness.perOffer.map((o) => (
              <div key={o.id} className="row">
                <div>
                  <span>{o.name}</span>
                  {!o.active && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>(paused)</span>}
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
                    {o.redemptionCount} use{o.redemptionCount === 1 ? '' : 's'} · ₹{o.totalDiscountGiven.toFixed(0)} given away
                  </p>
                </div>
                <strong>₹{o.revenueFromOffer.toFixed(0)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
