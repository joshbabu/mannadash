import { useEffect, useState } from 'react';
import { api } from '../api';

// Default delivery point for the MVP demo — matches the restaurant list's default search center
const DEFAULT_LAT = 17.45;
const DEFAULT_LNG = 78.39;

export default function CheckoutScreen({ restaurant, orderItems, menuItems, onBack, onOrderPlaced }) {
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState(DEFAULT_LAT);
  const [longitude, setLongitude] = useState(DEFAULT_LNG);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [saveThisAddress, setSaveThisAddress] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cod'); // COD until Razorpay goes live
  const [instructions, setInstructions] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [appliedOffer, setAppliedOffer] = useState(null); // { offerName, discountAmount, fromCode }
  const [deliveryFee, setDeliveryFee] = useState(null);
  const [promoError, setPromoError] = useState('');
  const [checkingPromo, setCheckingPromo] = useState(false);
  const [cutleryNeeded, setCutleryNeeded] = useState(false);
  const [showBillDetails, setShowBillDetails] = useState(false);
  // A local, checkout-owned copy of the cart so quantities can be adjusted right here —
  // MenuScreen's own cart is untouched, so hitting Back still shows what was originally
  // added there. Seeded once from the prop; array index is a stable enough key since this
  // list never reorders, only quantities change or a line disappears at zero.
  const [cartItems, setCartItems] = useState(orderItems);

  function changeLineQty(index, delta) {
    setCartItems((prev) => {
      const next = [...prev];
      const newQty = next[index].quantity + delta;
      if (newQty <= 0) {
        next.splice(index, 1);
      } else {
        next[index] = { ...next[index], quantity: newQty };
      }
      return next;
    });
  }

  useEffect(() => {
    api.getSavedAddresses().then(setSavedAddresses).catch(() => {});
  }, []);

  function pickSavedAddress(saved) {
    setAddress(saved.address);
    setLatitude(saved.latitude);
    setLongitude(saved.longitude);
    setSaveThisAddress(false);
  }

  const lines = cartItems.map((oi) => {
    const item = menuItems.find((m) => m.id === oi.menuItemId);
    const selectedOptions = (oi.selectedOptionIds || [])
      .map((optId) => {
        for (const group of item?.variantGroups || []) {
          const opt = group.options.find((o) => o.id === optId);
          if (opt) return { label: opt.label, priceDelta: Number(opt.priceDelta) };
        }
        return null;
      })
      .filter(Boolean);
    const unitPrice = Number(item?.price || 0) + selectedOptions.reduce((s, o) => s + o.priceDelta, 0);
    return { ...oi, name: item?.name, price: unitPrice, selectedOptions };
  });
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);

  // Silently check for the best automatic offer whenever the cart or delivery point is
  // known — no customer action needed. A later successful code application overrides this.
  useEffect(() => {
    if (subtotal <= 0) return;
    api
      .previewOffer({ restaurantId: restaurant.id, subtotal, latitude, longitude })
      .then((res) => {
        setDeliveryFee(res.deliveryFee);
        if (res.applied) setAppliedOffer({ offerName: res.offerName, discountAmount: res.discountAmount, fromCode: false });
      })
      .catch(() => {});
  }, [subtotal, latitude, longitude, restaurant.id]);

  async function applyPromoCode() {
    if (!promoCodeInput.trim()) return;
    setPromoError('');
    setCheckingPromo(true);
    try {
      const res = await api.previewOffer({ restaurantId: restaurant.id, subtotal, latitude, longitude, promoCode: promoCodeInput.trim() });
      setDeliveryFee(res.deliveryFee);
      if (res.applied) {
        setAppliedOffer({ offerName: res.offerName, discountAmount: res.discountAmount, fromCode: true });
      } else {
        setPromoError(res.reason || "That code didn't work");
      }
    } catch (err) {
      setPromoError(err.message);
    } finally {
      setCheckingPromo(false);
    }
  }

  function removePromoCode() {
    setAppliedOffer(null);
    setPromoCodeInput('');
    setPromoError('');
  }

  async function placeOrder() {
    if (cartItems.length === 0) {
      setError('Your cart is empty — add something before placing an order');
      return;
    }
    if (!address.trim()) {
      setError('Add a delivery address so the rider knows where to go');
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (saveThisAddress && newLabel.trim()) {
        api.saveAddress({ label: newLabel.trim(), address, latitude, longitude }).catch(() => {});
      }
      const order = await api.placeOrder({
        restaurantId: restaurant.id,
        items: cartItems,
        deliveryAddress: address,
        latitude,
        longitude,
        paymentMethod,
        cutleryNeeded,
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
        ...(appliedOffer?.fromCode ? { promoCode: promoCodeInput.trim() } : {}),
      });
      onOrderPlaced(order);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="screen" style={{ paddingBottom: 90 }}>
      <button className="btn-secondary" onClick={onBack} style={{ marginTop: 12, marginBottom: 12 }}>
        ← Back to menu
      </button>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>Your order</h1>

      {appliedOffer && (
        <div style={{ background: '#e3edd8', color: 'var(--curry, #2e7d32)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontWeight: 600 }}>
          🎉 ₹{appliedOffer.discountAmount.toFixed(0)} saved on this order!
        </div>
      )}

      <div id="checkout-cart-summary" className="card">
        {lines.map((l, i) => (
          <div className="row" key={`${l.menuItemId}-${i}`} style={{ marginBottom: 10 }}>
            <span>
              {l.name}
              {l.selectedOptions?.length > 0 && (
                <span className="muted"> ({l.selectedOptions.map((o) => o.label).join(', ')})</span>
              )}
              <br />
              <span className="muted" style={{ fontSize: 13 }}>₹{l.price.toFixed(0)} each</span>
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="qty-control">
                <button onClick={() => changeLineQty(i, -1)}>−</button>
                <span style={{ minWidth: 16, textAlign: 'center' }}>{l.quantity}</span>
                <button onClick={() => changeLineQty(i, 1)}>+</button>
              </div>
              <span style={{ minWidth: 48, textAlign: 'right' }}>₹{(l.price * l.quantity).toFixed(0)}</span>
            </div>
          </div>
        ))}
        {cartItems.length === 0 && <p className="muted">Your cart is empty.</p>}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginTop: 4 }}>
          <input type="checkbox" checked={cutleryNeeded} onChange={(e) => setCutleryNeeded(e.target.checked)} style={{ width: 'auto' }} />
          🍴 Send cutlery
        </label>

        <div style={{ borderTop: '1px solid #e5ddc9', margin: '10px 0' }} />
        <div className="row" style={{ fontWeight: 600 }}>
          <span>Subtotal</span>
          <span>₹{subtotal.toFixed(0)}</span>
        </div>
        {appliedOffer && (
          <div className="row" style={{ color: 'var(--curry, #2e7d32)', marginTop: 4 }}>
            <span>🎉 {appliedOffer.offerName}</span>
            <span>
              -₹{appliedOffer.discountAmount.toFixed(0)}
              {appliedOffer.fromCode && (
                <button className="btn-ghost" style={{ marginLeft: 8, fontSize: 12, padding: '0 4px' }} onClick={removePromoCode}>
                  ✕
                </button>
              )}
            </span>
          </div>
        )}
        <div className="row" style={{ marginTop: 4 }}>
          <span className="muted">Delivery fee</span>
          <span>{deliveryFee == null ? 'calculated below' : `₹${deliveryFee.toFixed(0)}`}</span>
        </div>
        {deliveryFee != null && (
          <div className="row" style={{ fontWeight: 700, marginTop: 6, paddingTop: 6, borderTop: '1px solid #e5ddc9' }}>
            <span>Total</span>
            <span>₹{Math.max(0, subtotal + deliveryFee - (appliedOffer?.discountAmount || 0)).toFixed(0)}</span>
          </div>
        )}

        {!appliedOffer?.fromCode && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              placeholder="Have a promo code?"
              value={promoCodeInput}
              onChange={(e) => setPromoCodeInput(e.target.value.toUpperCase())}
              style={{ flex: 1, background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd' }}
            />
            <button className="btn-secondary" onClick={applyPromoCode} disabled={checkingPromo || !promoCodeInput.trim()}>
              {checkingPromo ? 'Checking…' : 'Apply'}
            </button>
          </div>
        )}
        {promoError && <p style={{ color: 'var(--chili-dark)', fontSize: 13, marginTop: 6 }}>{promoError}</p>}
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15, marginBottom: 10 }}>Delivery address</h3>

        {savedAddresses.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {savedAddresses.map((saved) => (
              <button
                key={saved.id}
                className="btn-secondary"
                style={{ color: 'var(--chili-dark)', borderColor: 'var(--chili)' }}
                onClick={() => pickSavedAddress(saved)}
              >
                📍 {saved.label}
              </button>
            ))}
          </div>
        )}

        <textarea
          rows={3}
          placeholder="Flat / house number, street, landmark"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd' }}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginTop: 10 }}>
          <input type="checkbox" checked={saveThisAddress} onChange={(e) => setSaveThisAddress(e.target.checked)} style={{ width: 'auto' }} />
          Save this address for next time
        </label>
        {saveThisAddress && (
          <input
            placeholder="Label it (e.g. Home, Work)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', marginTop: 8 }}
          />
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}
      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ fontWeight: 700, margin: '0 0 8px' }}>Cooking instructions <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>(optional)</span></p>
        <textarea
          placeholder="e.g. less spicy, no onions…"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          maxLength={300}
          rows={2}
          style={{ width: '100%', resize: 'vertical' }}
        />
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <p style={{ fontWeight: 700, margin: '0 0 8px' }}>Payment</p>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 15, marginBottom: 6 }}>
          <input type="radio" checked={paymentMethod === 'cod'} onChange={() => setPaymentMethod('cod')} style={{ width: 'auto' }} />
          💵 Cash on delivery
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 15, color: '#9a917f' }}>
          <input type="radio" disabled style={{ width: 'auto' }} />
          💳 Pay online <span style={{ fontSize: 12 }}>(coming soon)</span>
        </label>
      </div>


      <div
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, background: 'var(--paper, #fdf8ef)',
          borderTop: '1px solid #e5ddc9', padding: '12px 20px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 12, zIndex: 40,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, color: 'var(--charcoal)' }}>
            {deliveryFee == null ? 'Calculating…' : `To Pay ₹${Math.max(0, subtotal + deliveryFee - (appliedOffer?.discountAmount || 0)).toFixed(0)}`}
          </div>
          <button
            className="btn-ghost"
            style={{ fontSize: 12, padding: 0, color: 'var(--chili-dark)' }}
            onClick={() => document.getElementById('checkout-cart-summary')?.scrollIntoView({ behavior: 'smooth' })}
          >
            View detailed bill
          </button>
        </div>
        <button className="btn-primary" style={{ flex: 'none', minWidth: 160 }} onClick={placeOrder} disabled={loading || cartItems.length === 0}>
          {loading ? 'Placing order…' : 'Place order'}
        </button>
      </div>
    </div>
  );
}
