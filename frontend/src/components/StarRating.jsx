export default function StarRating({ value, onChange, label }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <p style={{ margin: '0 0 6px', fontSize: 14, color: 'var(--charcoal)' }}>{label}</p>
      <div style={{ display: 'flex', gap: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 28,
              lineHeight: 1,
              padding: 2,
              color: n <= value ? 'var(--turmeric)' : '#ddd',
            }}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}
