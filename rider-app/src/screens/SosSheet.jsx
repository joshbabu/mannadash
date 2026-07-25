import { useEffect, useState } from 'react';
import { api } from '../api';

// Real, India-wide emergency numbers — not MannaDash-specific, these work regardless of
// whether the alert below successfully reaches the server.
const EMERGENCY_NUMBERS = [
  { label: 'Police', number: '100' },
  { label: 'Ambulance', number: '108' },
  { label: 'Women\'s Helpline', number: '1091' },
  { label: 'National Emergency', number: '112' },
];

export default function SosSheet({ onClose }) {
  const [status, setStatus] = useState('locating'); // 'locating' | 'logged' | 'error'
  const [coords, setCoords] = useState(null);
  const [shareState, setShareState] = useState('idle'); // 'idle' | 'shared' | 'copied'

  useEffect(() => {
    if (!navigator.geolocation) {
      setStatus('error');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setCoords({ latitude, longitude });
        try {
          await api.triggerSos({ latitude, longitude });
          setStatus('logged');
        } catch {
          setStatus('error');
        }
      },
      () => setStatus('error'),
    );
  }, []);

  async function shareLocation() {
    if (!coords) return;
    const link = `https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`;
    const text = `I need help — this is my current location: ${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ text });
        setShareState('shared');
      } catch {
        // cancelled — not an error
      }
    } else {
      await navigator.clipboard?.writeText(text);
      setShareState('copied');
      setTimeout(() => setShareState('idle'), 2000);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end' }}>
      <div style={{ background: 'var(--paper)', color: 'var(--charcoal)', borderRadius: '20px 20px 0 0', padding: 20, width: '100%', maxWidth: 480, margin: '0 auto' }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <h2 style={{ fontSize: 18, color: 'var(--chili-dark)' }}>🆘 Emergency</h2>
          <button className="btn-secondary" onClick={onClose} style={{ color: 'var(--charcoal)' }}>✕</button>
        </div>

        <div style={{ background: status === 'logged' ? '#e3edd8' : '#fff2d6', borderRadius: 10, padding: '10px 12px', marginBottom: 16, fontSize: 13 }}>
          {status === 'locating' && 'Getting your location…'}
          {status === 'logged' && '✓ Your location has been sent to MannaDash support.'}
          {status === 'error' && "Couldn't reach support automatically — call one of the numbers below directly."}
        </div>

        <div className="stack" style={{ marginBottom: 16 }}>
          {EMERGENCY_NUMBERS.map((e) => (
            <a
              key={e.number}
              href={`tel:${e.number}`}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', textDecoration: 'none',
                background: '#fdf8ef', border: '1px solid #e5ddc9', borderRadius: 12, padding: '12px 16px', color: 'var(--charcoal)',
              }}
            >
              <span style={{ fontWeight: 600 }}>{e.label}</span>
              <span style={{ fontWeight: 700, color: 'var(--chili-dark)' }}>📞 {e.number}</span>
            </a>
          ))}
        </div>

        <button className="btn-secondary" onClick={shareLocation} disabled={!coords} style={{ width: '100%' }}>
          {shareState === 'copied' ? '✓ Copied to clipboard' : shareState === 'shared' ? '✓ Shared' : '📍 Share my location'}
        </button>
      </div>
    </div>
  );
}
