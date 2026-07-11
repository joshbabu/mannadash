import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';

/**
 * Order History — past delivered and cancelled orders (in-flight ones live on the Orders tab).
 * Summary cards + search + filters, modeled on the competitor dashboards used for reference.
 * The summary reflects the current search + date window, so searching a customer shows THAT
 * customer's delivered/cancelled/revenue at a glance.
 */

const DATE_RANGES = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: 'all', label: 'All time', days: null },
];

const STATUS_OPTIONS = [
  { key: '', label: 'All status' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

const PAGE_SIZE = 20;

export default function OrderHistoryScreen() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [range, setRange] = useState('7d');
  const [offset, setOffset] = useState(0);

  const [data, setData] = useState(null); // { summary, total, orders }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  // Debounce typing so we don't fire a request per keystroke
  const debouncedSearch = useDebounced(search, 350);

  const from = useMemo(() => {
    const days = DATE_RANGES.find((r) => r.key === range)?.days;
    return days ? new Date(Date.now() - days * 86400000).toISOString() : '';
  }, [range]);

  useEffect(() => {
    setOffset(0); // any filter change starts back at page 1
  }, [debouncedSearch, status, range]);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError('');
    api
      .getOrderHistory({ search: debouncedSearch, status, from, limit: PAGE_SIZE, offset })
      .then((res) => {
        if (!stale) setData(res);
      })
      .catch((err) => {
        if (!stale) setError(err.message);
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [debouncedSearch, status, from, offset]);

  const summary = data?.summary;
  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;

  return (
    <div>
      <h2 style={{ fontSize: 18, margin: '0 0 2px' }}>Order History</h2>
      <p className="muted" style={{ marginTop: 0 }}>Past delivered and cancelled orders</p>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <SummaryCard icon="✅" value={summary?.delivered} label="Delivered" />
        <SummaryCard icon="❌" value={summary?.cancelled} label="Cancelled" />
        <SummaryCard icon="💰" value={summary ? `₹${Number(summary.revenue).toLocaleString('en-IN')}` : undefined} label="Revenue" />
      </div>

      {/* Search + filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          placeholder="Search by name, phone, or order ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: '2 1 220px' }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" style={{ flex: '1 1 120px' }}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Filter by date range" style={{ flex: '1 1 120px' }}>
          {DATE_RANGES.map((r) => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>
      </div>

      {error && <div className="error-banner">{error}</div>}
      {loading && !data && <p className="muted">Loading…</p>}

      {data && orders.length === 0 && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="muted" style={{ margin: 0 }}>
            {debouncedSearch || status ? 'No orders match these filters' : 'No past orders in this period yet'}
          </p>
        </div>
      )}

      <div className="stack">
        {orders.map((order) => {
          const expanded = expandedId === order.id;
          const itemCount = order.items?.reduce((sum, i) => sum + i.quantity, 0) ?? 0;
          const placed = new Date(order.placedAt);
          return (
            <div key={order.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setExpandedId(expanded ? null : order.id)}>
              <div className="row">
                <div>
                  <strong>{order.customer?.user?.name || 'Customer'}</strong>
                  <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>#{order.id.slice(0, 8)}</span>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>
                    {placed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })},{' '}
                    {placed.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · {itemCount} item{itemCount === 1 ? '' : 's'}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong>₹{Number(order.total).toFixed(0)}</strong>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
                    {order.paymentMethod === 'cod' && (
                      <span className="pill" style={{ background: '#fff2d6', color: '#8a5a00' }}>💵 COD</span>
                    )}
                    {order.discountAmount != null && Number(order.discountAmount) > 0 && (
                      <span className="pill" style={{ background: '#e3edd8', color: 'var(--curry)' }} title={order.appliedOfferName}>
                        🎉 -₹{Number(order.discountAmount).toFixed(0)}
                      </span>
                    )}
                    <span className={`pill status-${order.status}`}>{order.status}</span>
                    <span className="pill" style={{ background: order.paymentStatus === 'paid' ? '#e3edd8' : '#f0e5e5', color: order.paymentStatus === 'paid' ? 'var(--curry)' : '#8a3a3a' }}>
                      {order.paymentStatus}
                    </span>
                  </div>
                </div>
              </div>
              {expanded && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #eee4d4', fontSize: 14 }}>
                  {order.items?.map((item) => (
                    <div key={item.id} className="row" style={{ marginBottom: 2 }}>
                      <span>
                        {item.menuItem?.name || 'Item'} × {item.quantity}
                        {item.selectedOptions?.length > 0 && (
                          <span className="muted"> ({item.selectedOptions.map((o) => o.optionLabel).join(', ')})</span>
                        )}
                      </span>
                      <span>₹{(Number(item.priceAtOrder ?? item.price ?? 0) * item.quantity).toFixed(0)}</span>
                    </div>
                  ))}
                  <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>Delivered to: {order.deliveryAddress}</p>
                  {order.refundStatus && order.refundStatus !== 'none' && (
                    <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Refund: {order.refundStatus}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn-secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            Previous
          </button>
          <span className="muted" style={{ fontSize: 13 }}>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button className="btn-secondary" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ icon, value, label }) {
  return (
    <div className="card" style={{ flex: '1 1 120px', textAlign: 'center', padding: '12px 8px' }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>
        <span style={{ marginRight: 6 }}>{icon}</span>
        {value ?? '—'}
      </div>
      <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>{label}</p>
    </div>
  );
}

function useDebounced(value, delayMs) {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef(null);
  useEffect(() => {
    timer.current = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer.current);
  }, [value, delayMs]);
  return debounced;
}
