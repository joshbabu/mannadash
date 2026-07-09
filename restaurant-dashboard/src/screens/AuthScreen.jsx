import { useState } from 'react';
import { api } from '../api';

/**
 * Login + a 3-step onboarding wizard (modeled on Swiggy's partner flow):
 *   1. Restaurant Information — identity, address, owner contact
 *   2. Documents — FSSAI, PAN, GSTIN, bank details for payouts
 *   3. Hours & Menu — working days, per-day or uniform timings, veg-only, cost for two
 * Everything is collected client-side and submitted as ONE registration call at the end —
 * the restaurant has no auth token until after approval + claim, so there's nothing to
 * PATCH against mid-wizard.
 */

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun' };

const PATTERNS = {
  phone: { re: /^[6-9]\d{9}$/, msg: 'Phone must be a 10-digit mobile number' },
  whatsapp: { re: /^[6-9]\d{9}$/, msg: 'WhatsApp must be a 10-digit mobile number' },
  email: { re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, msg: 'Enter a valid email address' },
  fssai: { re: /^\d{14}$/, msg: 'FSSAI licence number is exactly 14 digits' },
  pan: { re: /^[A-Z]{5}\d{4}[A-Z]$/, msg: 'PAN looks wrong — format is AAAAA9999A' },
  gstin: { re: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, msg: 'GSTIN looks wrong — it is 15 characters' },
  ifsc: { re: /^[A-Z]{4}0[A-Z0-9]{6}$/, msg: 'IFSC looks wrong — format is HDFC0001234' },
  bankAccount: { re: /^\d{9,18}$/, msg: 'Account number should be 9–18 digits' },
};

const STEPS = ['Restaurant Information', 'Documents', 'Hours & Menu'];

export default function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Login fields
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  // Wizard
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    // Step 1
    ownerName: '',
    name: '',
    cuisineType: '',
    address: '',
    regPhone: '',
    regPassword: '',
    ownerEmail: '',
    whatsappSame: true,
    whatsappNumber: '',
    // Step 2 (all optional — approval and payouts need them, signup doesn't)
    fssaiNumber: '',
    fssaiExpiry: '',
    pan: '',
    noGst: false,
    gstin: '',
    bankIfsc: '',
    bankAccountNumber: '',
    // Step 3
    workingDays: Object.fromEntries(DAYS.map((d) => [d, true])),
    sameHoursAllDays: true,
    openTime: '09:00',
    closeTime: '22:00',
    perDayHours: Object.fromEntries(DAYS.map((d) => [d, { open: '09:00', close: '22:00' }])),
    isVegOnly: false,
    costForTwo: '',
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function handleLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.login({ phone, password });
      api.setToken(result.accessToken);
      api.setStoredRestaurant(result.restaurant);
      onAuthed(result.restaurant);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function validateStep(index) {
    if (index === 0) {
      if (!form.ownerName || !form.name || !form.cuisineType || !form.address) return 'Please fill in all the restaurant details';
      if (!PATTERNS.phone.re.test(form.regPhone)) return PATTERNS.phone.msg;
      if (!PATTERNS.email.re.test(form.ownerEmail)) return PATTERNS.email.msg;
      if (!form.whatsappSame && !PATTERNS.whatsapp.re.test(form.whatsappNumber)) return PATTERNS.whatsapp.msg;
      if (form.regPassword.length < 6) return 'Password should be at least 6 characters';
    }
    if (index === 1) {
      // Every document is optional at this stage, but anything entered must be well-formed
      if (form.fssaiNumber && !PATTERNS.fssai.re.test(form.fssaiNumber)) return PATTERNS.fssai.msg;
      if (form.fssaiNumber && !form.fssaiExpiry) return 'Please add the FSSAI expiry date';
      if (form.pan && !PATTERNS.pan.re.test(form.pan)) return PATTERNS.pan.msg;
      if (!form.noGst && form.gstin && !PATTERNS.gstin.re.test(form.gstin)) return PATTERNS.gstin.msg;
      if (form.bankIfsc && !PATTERNS.ifsc.re.test(form.bankIfsc)) return PATTERNS.ifsc.msg;
      if (form.bankAccountNumber && !PATTERNS.bankAccount.re.test(form.bankAccountNumber)) return PATTERNS.bankAccount.msg;
      if ((form.bankIfsc && !form.bankAccountNumber) || (!form.bankIfsc && form.bankAccountNumber))
        return 'Bank details need both IFSC and account number';
    }
    if (index === 2) {
      if (!DAYS.some((d) => form.workingDays[d])) return 'Select at least one working day';
      if (form.costForTwo && (!/^\d+$/.test(form.costForTwo) || Number(form.costForTwo) < 1))
        return 'Cost for two should be a positive amount';
    }
    return null;
  }

  function next() {
    const problem = validateStep(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setStep((s) => s + 1);
  }

  function buildPayload() {
    const weeklyHours = {};
    for (const day of DAYS) {
      if (!form.workingDays[day]) {
        weeklyHours[day] = null; // explicitly closed
      } else if (form.sameHoursAllDays) {
        weeklyHours[day] = { open: form.openTime, close: form.closeTime };
      } else {
        weeklyHours[day] = { ...form.perDayHours[day] };
      }
    }

    const payload = {
      ownerName: form.ownerName,
      name: form.name,
      cuisineType: form.cuisineType,
      address: form.address,
      phone: form.regPhone,
      // Hyderabad center default — real address geocoding would replace this in production
      latitude: 17.4435,
      longitude: 78.3772,
      ownerEmail: form.ownerEmail,
      whatsappNumber: form.whatsappSame ? form.regPhone : form.whatsappNumber,
      weeklyHours,
      isVegOnly: form.isVegOnly,
    };

    // Optional fields: only include when present — the backend validators (correctly) reject
    // empty strings, and "not provided" must be undefined, not ''
    if (form.fssaiNumber) {
      payload.fssaiNumber = form.fssaiNumber;
      payload.fssaiExpiry = form.fssaiExpiry;
    }
    if (form.pan) payload.pan = form.pan;
    if (!form.noGst && form.gstin) payload.gstin = form.gstin;
    if (form.bankIfsc && form.bankAccountNumber) {
      payload.bankIfsc = form.bankIfsc;
      payload.bankAccountNumber = form.bankAccountNumber;
    }
    if (form.costForTwo) payload.costForTwo = Number(form.costForTwo);
    return payload;
  }

  async function handleSubmit() {
    const problem = validateStep(2);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setLoading(true);
    try {
      const restaurant = await api.registerRestaurant(buildPayload());
      const claimed = await api.claimRestaurant({ restaurantId: restaurant.id, password: form.regPassword });
      api.setToken(claimed.accessToken);
      api.setStoredRestaurant(claimed.restaurant);
      onAuthed(claimed.restaurant);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const upper = (v) => v.toUpperCase().replace(/\s/g, '');

  return (
    <div className="app-shell" style={{ paddingTop: 60, maxWidth: 480 }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div className="display" style={{ fontSize: 32, color: 'var(--chili)' }}>
          MannaDash for Restaurants
        </div>
        <p className="muted" style={{ marginTop: 6 }}>Manage your menu and orders</p>
      </div>

      <div className="tabs">
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log in</button>
        <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Register restaurant</button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="stack">
            <input placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            <input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button className="btn-primary" type="submit" disabled={loading}>
              {loading ? 'Please wait…' : 'Log in'}
            </button>
          </form>
        ) : (
          <div className="stack">
            {/* Stepper header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }} aria-label={`Step ${step + 1} of ${STEPS.length}`}>
              {STEPS.map((label, i) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: i < STEPS.length - 1 ? 1 : 'initial' }}>
                  <div
                    style={{
                      width: 24, height: 24, borderRadius: '50%', fontSize: 13, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      background: i <= step ? 'var(--chili)' : 'var(--paper-dim, #f3ecdc)',
                      color: i <= step ? '#fff' : '#8a8378',
                    }}
                  >
                    {i < step ? '✓' : i + 1}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: i === step ? 700 : 400, color: i === step ? 'inherit' : '#8a8378' }}>
                    {label}
                  </span>
                  {i < STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: i < step ? 'var(--chili)' : 'var(--paper-dim, #f3ecdc)' }} />}
                </div>
              ))}
            </div>

            {step === 0 && (
              <>
                <input placeholder="Your name" value={form.ownerName} onChange={(e) => set('ownerName', e.target.value)} />
                <input placeholder="Restaurant name" value={form.name} onChange={(e) => set('name', e.target.value)} />
                <input placeholder="Cuisine type (e.g. Biryani)" value={form.cuisineType} onChange={(e) => set('cuisineType', e.target.value)} />
                <input placeholder="Address" value={form.address} onChange={(e) => set('address', e.target.value)} />
                <input placeholder="Phone number" value={form.regPhone} onChange={(e) => set('regPhone', e.target.value.replace(/\D/g, ''))} maxLength={10} />
                <input placeholder="Email address" type="email" value={form.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} />
                <p className="muted" style={{ fontSize: 12, margin: '-6px 0 0' }}>You'll get updates on payments, complaints and order issues here</p>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                  <input type="checkbox" checked={form.whatsappSame} onChange={(e) => set('whatsappSame', e.target.checked)} style={{ width: 'auto' }} />
                  My WhatsApp number is same as phone
                </label>
                {!form.whatsappSame && (
                  <input placeholder="WhatsApp number" value={form.whatsappNumber} onChange={(e) => set('whatsappNumber', e.target.value.replace(/\D/g, ''))} maxLength={10} />
                )}
                <input placeholder="Choose a password" type="password" value={form.regPassword} onChange={(e) => set('regPassword', e.target.value)} />
                <button className="btn-primary" type="button" onClick={next}>Next: Documents</button>
              </>
            )}

            {step === 1 && (
              <>
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  You can skip any of these for now — but approval may be delayed without your FSSAI
                  licence, and payouts can't start until bank details are added.
                </p>
                <input placeholder="FSSAI licence number (14 digits)" value={form.fssaiNumber} onChange={(e) => set('fssaiNumber', e.target.value.replace(/\D/g, ''))} maxLength={14} />
                {form.fssaiNumber && (
                  <label style={{ fontSize: 13 }} className="muted">
                    FSSAI expiry date
                    <input type="date" value={form.fssaiExpiry} onChange={(e) => set('fssaiExpiry', e.target.value)} style={{ marginTop: 4 }} />
                  </label>
                )}
                <input placeholder="Business / owner PAN" value={form.pan} onChange={(e) => set('pan', upper(e.target.value))} maxLength={10} />
                <input placeholder="GSTIN" value={form.gstin} onChange={(e) => set('gstin', upper(e.target.value))} maxLength={15} disabled={form.noGst} />
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                  <input type="checkbox" checked={form.noGst} onChange={(e) => set('noGst', e.target.checked)} style={{ width: 'auto' }} />
                  I don't have a GST number
                </label>
                <div style={{ borderTop: '1px solid var(--paper-dim, #f3ecdc)', paddingTop: 12 }}>
                  <p style={{ fontWeight: 600, margin: '0 0 2px' }}>Bank details</p>
                  <p className="muted" style={{ fontSize: 12, margin: '0 0 8px' }}>Payments from MannaDash will be credited here</p>
                  <div className="stack">
                    <input placeholder="Bank IFSC code" value={form.bankIfsc} onChange={(e) => set('bankIfsc', upper(e.target.value))} maxLength={11} />
                    <input placeholder="Bank account number" value={form.bankAccountNumber} onChange={(e) => set('bankAccountNumber', e.target.value.replace(/\D/g, ''))} maxLength={18} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" type="button" onClick={() => { setError(''); setStep(0); }}>Back</button>
                  <button className="btn-primary" type="button" onClick={next} style={{ flex: 1 }}>Next: Hours &amp; Menu</button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <p style={{ fontWeight: 600, margin: 0 }}>Working days</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {DAYS.map((day) => (
                    <label
                      key={day}
                      style={{
                        padding: '5px 10px', borderRadius: 8, fontSize: 13, cursor: 'pointer', userSelect: 'none',
                        border: '1px solid',
                        borderColor: form.workingDays[day] ? 'var(--chili)' : 'var(--paper-dim, #ddd)',
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

                <p style={{ fontWeight: 600, margin: '8px 0 0' }}>Opening &amp; closing time</p>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                  <input type="radio" checked={form.sameHoursAllDays} onChange={() => set('sameHoursAllDays', true)} style={{ width: 'auto' }} />
                  Same time on all working days
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
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

                <p style={{ fontWeight: 600, margin: '8px 0 0' }}>What kind of food is on your menu?</p>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                  <input type="radio" checked={form.isVegOnly} onChange={() => set('isVegOnly', true)} style={{ width: 'auto' }} />
                  Veg only 🌱
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                  <input type="radio" checked={!form.isVegOnly} onChange={() => set('isVegOnly', false)} style={{ width: 'auto' }} />
                  Both veg &amp; non-veg
                </label>

                <input placeholder="Cost for two (₹, approximate)" value={form.costForTwo} onChange={(e) => set('costForTwo', e.target.value.replace(/\D/g, ''))} maxLength={5} />

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" type="button" onClick={() => { setError(''); setStep(1); }}>Back</button>
                  <button className="btn-primary" type="button" onClick={handleSubmit} disabled={loading} style={{ flex: 1 }}>
                    {loading ? 'Registering…' : 'Submit registration'}
                  </button>
                </div>
                <p className="muted">Your restaurant will need admin approval before it appears to customers — you can self-approve from the dashboard for testing.</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
