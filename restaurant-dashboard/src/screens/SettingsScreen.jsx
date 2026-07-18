import { useEffect, useState } from 'react';
import { api } from '../api';
import { disablePushNotifications, enablePushNotifications, isPushSupported } from '../utils/pushNotifications';

/**
 * Restaurant Settings — everything the onboarding wizard captures, editable after signup.
 * This closes the wizard's "skip for now" promise: a restaurant that registered without bank
 * details (payouts) or FSSAI (approval) adds them here later. Also the only place pre-wizard
 * restaurants can set veg-only / cost-for-two so their customer card gets the new badges.
 *
 * Public fields load from GET /restaurants/:id; PAN and bank details from the owner-guarded
 * KYC endpoint (they're excluded from every public response).
 */

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };

const PATTERNS = {
  whatsapp: { re: /^[6-9]\d{9}$/, msg: 'WhatsApp must be a 10-digit mobile number' },
  email: { re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, msg: 'Enter a valid email address' },
  fssai: { re: /^\d{14}$/, msg: 'FSSAI licence number is exactly 14 digits' },
  pan: { re: /^[A-Z]{5}\d{4}[A-Z]$/, msg: 'PAN looks wrong — format is AAAAA9999A' },
  gstin: { re: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, msg: 'GSTIN looks wrong — it is 15 characters' },
  ifsc: { re: /^[A-Z]{4}0[A-Z0-9]{6}$/, msg: 'IFSC looks wrong — format is HDFC0001234' },
  bankAccount: { re: /^\d{9,18}$/, msg: 'Account number should be 9–18 digits' },
};

const DEFAULT_WINDOW = { open: '09:00', close: '22:00' };

export default function SettingsScreen({ restaurant }) {
  const [form, setForm] = useState(null); // null until both fetches land
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwChanged, setPwChanged] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');

  useEffect(() => {
    if (!isPushSupported()) {
      setPushEnabled(false);
      return;
    }
    api.getPushStatus().then((s) => setPushEnabled(s.subscribed)).catch(() => setPushEnabled(false));
  }, []);

  async function togglePush() {
    setPushError('');
    setPushBusy(true);
    try {
      if (pushEnabled) {
        await disablePushNotifications();
        setPushEnabled(false);
      } else {
        await enablePushNotifications();
        setPushEnabled(true);
      }
    } catch (err) {
      setPushError(err.message);
    } finally {
      setPushBusy(false);
    }
  }

  async function changePassword() {
    setPwError('');
    setChangingPw(true);
    try {
      await api.changePassword({ currentPassword: currentPw, newPassword: newPw });
      setCurrentPw('');
      setNewPw('');
      setPwChanged(true);
      setTimeout(() => setPwChanged(false), 3000);
    } catch (err) {
      setPwError(err.message);
    } finally {
      setChangingPw(false);
    }
  }


  useEffect(() => {
    Promise.all([api.getRestaurant(restaurant.id), api.getRestaurantKyc(restaurant.id)])
      .then(([pub, kyc]) => {
        const weekly = pub.weeklyHours || {};
        setForm({
          ownerName: pub.ownerName || '',
          name: pub.name || '',
          cuisineType: pub.cuisineType || '',
          address: pub.address || '',
          ownerEmail: pub.ownerEmail || '',
          whatsappNumber: pub.whatsappNumber || '',
          // Hours: per-day when configured; otherwise seed from the legacy single window
          workingDays: Object.fromEntries(
            DAYS.map((d) => [d, pub.weeklyHours ? Boolean(weekly[d]) : true]),
          ),
          sameHoursAllDays: !pub.weeklyHours,
          openTime: pub.openTime || DEFAULT_WINDOW.open,
          closeTime: pub.closeTime || DEFAULT_WINDOW.close,
          perDayHours: Object.fromEntries(
            DAYS.map((d) => [d, weekly[d] ? { ...weekly[d] } : { ...DEFAULT_WINDOW }]),
          ),
          isVegOnly: Boolean(pub.isVegOnly),
          costForTwo: pub.costForTwo ? String(pub.costForTwo) : '',
          minOrderValue: pub.minOrderValue ? String(pub.minOrderValue) : '',
          packagingFee: pub.packagingFee ? String(pub.packagingFee) : '',
          fssaiNumber: kyc.fssaiNumber || '',
          fssaiExpiry: kyc.fssaiExpiry || '',
          pan: kyc.pan || '',
          gstin: kyc.gstin || '',
          bankIfsc: kyc.bankIfsc || '',
          bankAccountNumber: kyc.bankAccountNumber || '',
        });
      })
      .catch((err) => setError(err.message));
  }, [restaurant.id]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const upper = (v) => v.toUpperCase().replace(/\s/g, '');

  function validate() {
    if (!form.ownerName || !form.name || !form.cuisineType || !form.address) return 'Name, owner, cuisine and address are required';
    if (form.ownerEmail && !PATTERNS.email.re.test(form.ownerEmail)) return PATTERNS.email.msg;
    if (form.whatsappNumber && !PATTERNS.whatsapp.re.test(form.whatsappNumber)) return PATTERNS.whatsapp.msg;
    if (!DAYS.some((d) => form.workingDays[d])) return 'Select at least one working day';
    if (form.costForTwo && (!/^\d+$/.test(form.costForTwo) || Number(form.costForTwo) < 1)) return 'Cost for two should be a positive amount';
    if (form.minOrderValue && (!/^\d+$/.test(form.minOrderValue) || Number(form.minOrderValue) < 1)) return 'Minimum order should be a positive amount';
    if (form.packagingFee && (!/^\d+$/.test(form.packagingFee) || Number(form.packagingFee) < 0)) return 'Packaging fee should be a positive amount';
    if (form.fssaiNumber && !PATTERNS.fssai.re.test(form.fssaiNumber)) return PATTERNS.fssai.msg;
    if (form.fssaiNumber && !form.fssaiExpiry) return 'Please add the FSSAI expiry date';
    if (form.pan && !PATTERNS.pan.re.test(form.pan)) return PATTERNS.pan.msg;
    if (form.gstin && !PATTERNS.gstin.re.test(form.gstin)) return PATTERNS.gstin.msg;
    if (form.bankIfsc && !PATTERNS.ifsc.re.test(form.bankIfsc)) return PATTERNS.ifsc.msg;
    if (form.bankAccountNumber && !PATTERNS.bankAccount.re.test(form.bankAccountNumber)) return PATTERNS.bankAccount.msg;
    if ((form.bankIfsc && !form.bankAccountNumber) || (!form.bankIfsc && form.bankAccountNumber))
      return 'Bank details need both IFSC and account number';
    return null;
  }

  async function save() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setSaving(true);

    const weeklyHours = {};
    for (const day of DAYS) {
      if (!form.workingDays[day]) weeklyHours[day] = null;
      else if (form.sameHoursAllDays) weeklyHours[day] = { open: form.openTime, close: form.closeTime };
      else weeklyHours[day] = { ...form.perDayHours[day] };
    }

    // Empty optional fields are sent as null (clears the column) — the backend validators
    // reject empty strings, and "removed" must actually remove, not silently keep old data
    const orNull = (v) => (v === '' ? null : v);
    const payload = {
      ownerName: form.ownerName,
      name: form.name,
      cuisineType: form.cuisineType,
      address: form.address,
      ownerEmail: orNull(form.ownerEmail),
      whatsappNumber: orNull(form.whatsappNumber),
      weeklyHours,
      isVegOnly: form.isVegOnly,
      costForTwo: form.costForTwo ? Number(form.costForTwo) : null,
      minOrderValue: form.minOrderValue ? Number(form.minOrderValue) : null,
      packagingFee: form.packagingFee ? Number(form.packagingFee) : null,
      fssaiNumber: orNull(form.fssaiNumber),
      fssaiExpiry: form.fssaiNumber ? form.fssaiExpiry : null,
      pan: orNull(form.pan),
      gstin: orNull(form.gstin),
      bankIfsc: orNull(form.bankIfsc),
      bankAccountNumber: orNull(form.bankAccountNumber),
    };

    try {
      await api.updateRestaurant(restaurant.id, payload);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!form) {
    return error ? <div className="error-banner">{error}</div> : <p className="muted">Loading settings…</p>;
  }

  const sectionTitle = (text, hint) => (
    <div style={{ marginBottom: 10 }}>
      <p style={{ fontWeight: 700, margin: 0 }}>{text}</p>
      {hint && <p className="muted" style={{ fontSize: 12, margin: '2px 0 0' }}>{hint}</p>}
    </div>
  );

  return (
    <div style={{ maxWidth: 520 }}>
      <h2 style={{ fontSize: 18, margin: '0 0 2px' }}>Restaurant settings</h2>
      <p className="muted" style={{ marginTop: 0 }}>Everything from registration, editable any time</p>

      {error && <div className="error-banner">{error}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row">
          <div>
            <p style={{ fontWeight: 700 }}>🔔 New order notifications</p>
            <p className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              {pushEnabled === null
                ? 'Checking…'
                : pushEnabled
                  ? 'On — you\'ll be notified the moment a new order comes in'
                  : 'Off — you won\'t be notified of new orders even if your tab is closed'}
            </p>
          </div>
          {isPushSupported() ? (
            <button className="btn-secondary" onClick={togglePush} disabled={pushEnabled === null || pushBusy}>
              {pushBusy ? '…' : pushEnabled ? 'Turn off' : 'Turn on'}
            </button>
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>Not supported here</span>
          )}
        </div>
        {pushError && <div className="error-banner" style={{ marginTop: 8 }}>{pushError}</div>}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        {sectionTitle('Basic information')}
        <div className="stack">
          <input placeholder="Restaurant name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          <input placeholder="Owner name" value={form.ownerName} onChange={(e) => set('ownerName', e.target.value)} />
          <input placeholder="Cuisine type" value={form.cuisineType} onChange={(e) => set('cuisineType', e.target.value)} />
          <input placeholder="Address" value={form.address} onChange={(e) => set('address', e.target.value)} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        {sectionTitle('Owner contact', 'Payment updates, complaints, and order issues go here')}
        <div className="stack">
          <input placeholder="Email address" type="email" value={form.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} />
          <input placeholder="WhatsApp number" value={form.whatsappNumber} onChange={(e) => set('whatsappNumber', e.target.value.replace(/\D/g, ''))} maxLength={10} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        {sectionTitle('Working days & hours')}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {DAYS.map((day) => (
            <label
              key={day}
              style={{
                padding: '5px 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer', userSelect: 'none', border: '1px solid',
                borderColor: form.workingDays[day] ? 'var(--chili)' : '#ddd',
                background: form.workingDays[day] ? '#fdeee8' : 'transparent',
                color: form.workingDays[day] ? 'var(--chili-dark)' : '#8a8378',
                fontWeight: form.workingDays[day] ? 600 : 400,
              }}
            >
              <input
                type="checkbox"
                checked={form.workingDays[day]}
                onChange={(e) => set('workingDays', { ...form.workingDays, [day]: e.target.checked })}
                style={{ display: 'none' }}
              />
              {DAY_LABELS[day]}
            </label>
          ))}
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, marginBottom: 6 }}>
          <input type="radio" checked={form.sameHoursAllDays} onChange={() => set('sameHoursAllDays', true)} style={{ width: 'auto' }} />
          Same time on all working days
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, marginBottom: 10 }}>
          <input type="radio" checked={!form.sameHoursAllDays} onChange={() => set('sameHoursAllDays', false)} style={{ width: 'auto' }} />
          Different timings per day
        </label>
        {form.sameHoursAllDays ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="time" value={form.openTime} onChange={(e) => set('openTime', e.target.value)} aria-label="Open time" />
            <span className="muted">to</span>
            <input type="time" value={form.closeTime} onChange={(e) => set('closeTime', e.target.value)} aria-label="Close time" />
          </div>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {DAYS.filter((d) => form.workingDays[d]).map((day) => (
              <div key={day} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ width: 40, fontSize: 13 }}>{DAY_LABELS[day]}</span>
                <input
                  type="time"
                  value={form.perDayHours[day].open}
                  aria-label={`${day} open time`}
                  onChange={(e) => set('perDayHours', { ...form.perDayHours, [day]: { ...form.perDayHours[day], open: e.target.value } })}
                />
                <span className="muted">to</span>
                <input
                  type="time"
                  value={form.perDayHours[day].close}
                  aria-label={`${day} close time`}
                  onChange={(e) => set('perDayHours', { ...form.perDayHours, [day]: { ...form.perDayHours[day], close: e.target.value } })}
                />
              </div>
            ))}
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>Closing after midnight is fine — e.g. 18:00 to 02:00 runs overnight</p>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        {sectionTitle('Menu basics', 'Shown to customers on your restaurant card')}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, marginBottom: 6 }}>
          <input type="radio" checked={form.isVegOnly} onChange={() => set('isVegOnly', true)} style={{ width: 'auto' }} />
          Veg only 🌱
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, marginBottom: 10 }}>
          <input type="radio" checked={!form.isVegOnly} onChange={() => set('isVegOnly', false)} style={{ width: 'auto' }} />
          Both veg &amp; non-veg
        </label>
        <input placeholder="Cost for two (₹, approximate)" value={form.costForTwo} onChange={(e) => set('costForTwo', e.target.value.replace(/\D/g, ''))} maxLength={5} />
        <input placeholder="Minimum order value (₹, optional)" value={form.minOrderValue} onChange={(e) => set('minOrderValue', e.target.value.replace(/\D/g, ''))} maxLength={5} style={{ marginTop: 8 }} />
        <input placeholder="Packaging fee (₹, optional)" value={form.packagingFee} onChange={(e) => set('packagingFee', e.target.value.replace(/\D/g, ''))} maxLength={4} style={{ marginTop: 8 }} />
        <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          Charged per order to cover containers/packaging. MannaDash caps this platform-wide — an amount above the cap is automatically reduced to the maximum, your order never gets rejected.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        {sectionTitle('Documents & bank', "Approval may be delayed without FSSAI; payouts can't start without bank details")}
        <div className="stack">
          <input placeholder="FSSAI licence number (14 digits)" value={form.fssaiNumber} onChange={(e) => set('fssaiNumber', e.target.value.replace(/\D/g, ''))} maxLength={14} />
          {form.fssaiNumber && (
            <label style={{ fontSize: 13 }} className="muted">
              FSSAI expiry date
              <input type="date" value={form.fssaiExpiry} onChange={(e) => set('fssaiExpiry', e.target.value)} style={{ marginTop: 4 }} />
            </label>
          )}
          <input placeholder="Business / owner PAN" value={form.pan} onChange={(e) => set('pan', upper(e.target.value))} maxLength={10} />
          <input placeholder="GSTIN" value={form.gstin} onChange={(e) => set('gstin', upper(e.target.value))} maxLength={15} />
          <input placeholder="Bank IFSC code" value={form.bankIfsc} onChange={(e) => set('bankIfsc', upper(e.target.value))} maxLength={11} />
          <input placeholder="Bank account number" value={form.bankAccountNumber} onChange={(e) => set('bankAccountNumber', e.target.value.replace(/\D/g, ''))} maxLength={18} />
        </div>
      </div>


      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ fontWeight: 700, margin: '0 0 8px' }}>Change password</p>
        {pwError && <div className="error-banner">{pwError}</div>}
        <div className="stack">
          <input placeholder="Current password" type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} />
          <input placeholder="New password (min 6 characters)" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn-secondary" onClick={changePassword} disabled={changingPw || !currentPw || newPw.length < 6}>
              {changingPw ? 'Changing…' : 'Change password'}
            </button>
            {pwChanged && <span style={{ color: 'var(--curry)', fontWeight: 600, fontSize: 14 }}>✓ Changed</span>}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {savedAt && <span style={{ color: 'var(--curry)', fontWeight: 600, fontSize: 14 }}>✓ Saved</span>}
      </div>
    </div>
  );
}
