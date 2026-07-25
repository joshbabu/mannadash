import { useEffect, useState } from 'react';
import { api } from '../api';

export default function ReferScreen({ onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getMyReferrals().then(setData).catch((err) => setError(err.message));
  }, []);

  async function share() {
    const text = `Join MannaDash as a delivery partner! Use my code ${data.referralCode} when you sign up and we both earn a bonus.`;
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        // user cancelled the share sheet — not an error worth surfacing
      }
    } else {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <button className="btn-secondary" onClick={onBack}>← Back</button>
        <span className="brand" style={{ fontSize: 18 }}>Refer & Earn</span>
        <span style={{ width: 60 }} />
      </div>

      {error && <div className="error-banner">{error}</div>}

      {!data && !error && (
        <div className="skeleton-card">
          <div className="skeleton-block" style={{ height: 40, width: '60%', margin: '0 auto' }} />
        </div>
      )}

      {data && (
        <>
          <div className="card" style={{ textAlign: 'center', marginBottom: 16 }}>
            <p className="muted" style={{ margin: '0 0 8px', fontSize: 13, color: '#6b6156' }}>
              Invite a rider — once they deliver {data.bonusThresholdOrders} orders, you both earn ₹{data.bonusAmount.toFixed(0)}
            </p>
            <p style={{ fontSize: 28, fontWeight: 700, letterSpacing: 2, margin: '0 0 14px', color: 'var(--curry)' }}>
              {data.referralCode}
            </p>
            <button className="btn-primary" onClick={share} style={{ background: 'var(--curry)' }}>
              {copied ? '✓ Copied' : '📤 Share your code'}
            </button>
          </div>

          <h2 style={{ fontSize: 16, marginBottom: 10 }}>People you've referred</h2>
          {data.referredRiders.length === 0 && <p className="muted">Nobody yet — share your code to get started.</p>}
          <div className="stack">
            {data.referredRiders.map((r, i) => {
              const pct = Math.min(100, Math.round((r.deliveredCount / data.bonusThresholdOrders) * 100));
              return (
                <div key={i} className="card">
                  <div className="row" style={{ marginBottom: 6 }}>
                    <strong style={{ fontSize: 14 }}>{r.name}</strong>
                    <span
                      className="pill"
                      style={{ background: r.bonusAchieved ? '#e3edd8' : '#fff2d6', color: r.bonusAchieved ? '#2e6b34' : '#8a5a00' }}
                    >
                      {r.bonusAchieved ? 'Earned!' : `+₹${data.bonusAmount.toFixed(0)}`}
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: '#e5ddc9', overflow: 'hidden', marginBottom: 6 }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: r.bonusAchieved ? 'var(--curry)' : 'var(--turmeric)' }} />
                  </div>
                  <p className="muted" style={{ margin: 0, fontSize: 12, color: '#6b6156' }}>
                    {r.deliveredCount} of {data.bonusThresholdOrders} deliveries
                  </p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
