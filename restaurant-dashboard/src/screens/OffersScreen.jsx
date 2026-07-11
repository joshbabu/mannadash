import { useEffect, useState } from 'react';
import { api } from '../api';

const DAY_LABELS = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };
const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function summarize(offer) {
  if (offer.discountType === 'free_delivery') return 'Free delivery';
  if (offer.discountType === 'percentage') {
    const cap = offer.maxDiscountAmount ? `, up to ₹${Number(offer.maxDiscountAmount).toFixed(0)}` : '';
    return `${Number(offer.discountValue)}% off${cap}`;
  }
  return `₹${Number(offer.discountValue).toFixed(0)} off`;
}

export default function OffersScreen({ restaurant }) {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingOffer, setEditingOffer] = useState(null);

  function load() {
    setLoading(true);
    api
      .getMyOffers()
      .then(setOffers)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggleActive(offer) {
    setError('');
    try {
      await api.updateOffer(offer.id, { active: !offer.active });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(offer) {
    if (!window.confirm(`Delete "${offer.name}"? This can't be undone.`)) return;
    setError('');
    try {
      await api.deleteOffer(offer.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 18, margin: 0 }}>Offers</h2>
          <p className="muted" style={{ marginTop: 2 }}>Discounts and coupons — automatic or code-based</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditingOffer(null); setShowForm(!showForm); }}>
          {showForm ? 'Cancel' : '+ New offer'}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {showForm && <OfferForm restaurant={restaurant} offer={editingOffer} onSaved={() => { setShowForm(false); setEditingOffer(null); load(); }} onError={setError} />}

      {loading && <p className="muted">Loading offers…</p>}
      {!loading && offers.length === 0 && <p className="muted">No offers yet — create one to start attracting orders.</p>}

      <div className="stack">
        {offers.map((offer) => (
          <div key={offer.id} className="card">
            <div className="row">
              <div>
                <strong>{offer.name}</strong>{' '}
                <span className="pill" style={{ marginLeft: 6 }}>{offer.code ? `Code: ${offer.code}` : 'Automatic'}</span>
                {!offer.active && <span className="pill" style={{ marginLeft: 6, background: '#f0e5e5', color: '#8a3a3a' }}>Paused</span>}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => toggleActive(offer)}>
                  {offer.active ? 'Pause' : 'Resume'}
                </button>
                <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => { setEditingOffer(offer); setShowForm(true); }}>
                  Edit
                </button>
                <button className="btn-ghost" style={{ fontSize: 12 }} onClick={() => remove(offer)}>
                  Delete
                </button>
              </div>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 14 }}>{summarize(offer)}</p>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>
              {offer.minOrderValue ? `Min order ₹${Number(offer.minOrderValue).toFixed(0)} · ` : ''}
              {offer.audience === 'first_order' ? 'First-time customers only · ' : ''}
              {offer.daysOfWeek?.length ? `${offer.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ')} · ` : ''}
              {offer.startTime && offer.endTime ? `${offer.startTime}–${offer.endTime} · ` : ''}
              {offer.usageLimitPerCustomer ? `Once per customer · ` : ''}
              {offer.totalUsageLimit ? `Max ${offer.totalUsageLimit} uses total` : ''}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function OfferForm({ offer, onSaved, onError }) {
  const [name, setName] = useState(offer?.name || '');
  const [code, setCode] = useState(offer?.code || '');
  const [discountType, setDiscountType] = useState(offer?.discountType || 'percentage');
  const [discountValue, setDiscountValue] = useState(offer?.discountValue ?? '');
  const [maxDiscountAmount, setMaxDiscountAmount] = useState(offer?.maxDiscountAmount ?? '');
  const [minOrderValue, setMinOrderValue] = useState(offer?.minOrderValue ?? '');
  const [audience, setAudience] = useState(offer?.audience || 'all');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [startDate, setStartDate] = useState(offer?.startDate || '');
  const [endDate, setEndDate] = useState(offer?.endDate || '');
  const [daysOfWeek, setDaysOfWeek] = useState(new Set(offer?.daysOfWeek || []));
  const [startTime, setStartTime] = useState(offer?.startTime || '');
  const [endTime, setEndTime] = useState(offer?.endTime || '');
  const [usageLimitPerCustomer, setUsageLimitPerCustomer] = useState(offer?.usageLimitPerCustomer ?? '');
  const [totalUsageLimit, setTotalUsageLimit] = useState(offer?.totalUsageLimit ?? '');
  const [saving, setSaving] = useState(false);

  function toggleDay(day) {
    setDaysOfWeek((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function handleSave() {
    onError('');
    if (!name.trim()) return onError('Give the offer a name');
    if (discountType !== 'free_delivery' && !discountValue) return onError('Enter a discount value');

    const payload = {
      name: name.trim(),
      code: code.trim() || null,
      discountType,
      discountValue: discountType === 'free_delivery' ? null : Number(discountValue),
      maxDiscountAmount: maxDiscountAmount ? Number(maxDiscountAmount) : null,
      minOrderValue: minOrderValue ? Number(minOrderValue) : null,
      audience,
      startDate: startDate || null,
      endDate: endDate || null,
      daysOfWeek: daysOfWeek.size > 0 ? Array.from(daysOfWeek) : null,
      startTime: startTime || null,
      endTime: endTime || null,
      usageLimitPerCustomer: usageLimitPerCustomer ? Number(usageLimitPerCustomer) : null,
      totalUsageLimit: totalUsageLimit ? Number(totalUsageLimit) : null,
    };

    setSaving(true);
    try {
      if (offer) await api.updateOffer(offer.id, payload);
      else await api.createOffer(payload);
      onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card stack" style={{ marginBottom: 16 }}>
      <input placeholder="Offer name — e.g. Weekend 20% Off" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="Promo code (optional — leave blank for automatic)" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />

      <select value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
        <option value="percentage">Percentage off</option>
        <option value="flat">Flat ₹ off</option>
        <option value="free_delivery">Free delivery</option>
      </select>

      {discountType !== 'free_delivery' && (
        <input
          placeholder={discountType === 'percentage' ? 'Discount % (e.g. 20)' : 'Discount ₹ (e.g. 50)'}
          type="number"
          min="0"
          value={discountValue}
          onChange={(e) => setDiscountValue(e.target.value)}
        />
      )}
      {discountType === 'percentage' && (
        <input placeholder="Cap the discount at ₹ (optional)" type="number" min="0" value={maxDiscountAmount} onChange={(e) => setMaxDiscountAmount(e.target.value)} />
      )}
      <input placeholder="Minimum order value ₹ (optional)" type="number" min="0" value={minOrderValue} onChange={(e) => setMinOrderValue(e.target.value)} />

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={audience === 'first_order'} onChange={(e) => setAudience(e.target.checked ? 'first_order' : 'all')} style={{ width: 'auto' }} />
        First-time customers only
      </label>

      <button type="button" className="btn-secondary" style={{ fontSize: 13 }} onClick={() => setShowAdvanced(!showAdvanced)}>
        {showAdvanced ? 'Hide scheduling & limits' : '+ Scheduling & usage limits (optional)'}
      </button>

      {showAdvanced && (
        <div className="stack" style={{ background: '#fbf7ef', borderRadius: 8, padding: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ flex: 1, fontSize: 13 }}>
              Start date
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ marginTop: 4 }} />
            </label>
            <label style={{ flex: 1, fontSize: 13 }}>
              End date
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ marginTop: 4 }} />
            </label>
          </div>

          <p className="muted" style={{ fontSize: 12, margin: '4px 0 2px' }}>Days (leave all unchecked for every day)</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {DAY_ORDER.map((day) => (
              <label
                key={day}
                style={{
                  padding: '4px 8px', borderRadius: 8, fontSize: 12, cursor: 'pointer', border: '1px solid',
                  borderColor: daysOfWeek.has(day) ? 'var(--chili)' : '#ddd',
                  background: daysOfWeek.has(day) ? '#fdeee8' : 'transparent',
                }}
              >
                <input type="checkbox" checked={daysOfWeek.has(day)} onChange={() => toggleDay(day)} style={{ display: 'none' }} />
                {DAY_LABELS[day]}
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ flex: 1, fontSize: 13 }}>
              Start time
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ marginTop: 4 }} />
            </label>
            <label style={{ flex: 1, fontSize: 13 }}>
              End time
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ marginTop: 4 }} />
            </label>
          </div>

          <input placeholder="Uses per customer (optional)" type="number" min="1" value={usageLimitPerCustomer} onChange={(e) => setUsageLimitPerCustomer(e.target.value)} />
          <input placeholder="Total uses across all customers (optional)" type="number" min="1" value={totalUsageLimit} onChange={(e) => setTotalUsageLimit(e.target.value)} />
        </div>
      )}

      <button className="btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : offer ? 'Save changes' : 'Create offer'}
      </button>
    </div>
  );
}
