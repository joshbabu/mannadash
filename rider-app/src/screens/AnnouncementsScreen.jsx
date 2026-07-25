import { useEffect, useState } from 'react';
import { api } from '../api';

export default function AnnouncementsScreen({ onBack }) {
  const [announcements, setAnnouncements] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getAnnouncements().then(setAnnouncements).catch((err) => setError(err.message));
  }, []);

  return (
    <div className="app-shell">
      <div className="topbar">
        <button className="btn-secondary" onClick={onBack}>← Back</button>
        <span className="brand" style={{ fontSize: 18 }}>Messages</span>
        <span style={{ width: 60 }} />
      </div>

      {error && <div className="error-banner">{error}</div>}

      {!announcements && !error && (
        <div className="stack">
          {[0, 1].map((i) => (
            <div className="skeleton-card" key={i}>
              <div className="skeleton-block" style={{ height: 15, width: '50%', marginBottom: 8 }} />
              <div className="skeleton-block" style={{ height: 12, width: '85%' }} />
            </div>
          ))}
        </div>
      )}

      {announcements && announcements.length === 0 && <p className="muted">No messages right now.</p>}

      {announcements && announcements.length > 0 && (
        <div className="stack">
          {announcements.map((a) => (
            <div key={a.id} className="card">
              <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: 15 }}>{a.title}</p>
              <p style={{ margin: '0 0 8px', fontSize: 14, color: '#4a463f', lineHeight: 1.4 }}>{a.body}</p>
              <p className="muted" style={{ margin: 0, fontSize: 12, color: '#8a8378' }}>
                {new Date(a.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
