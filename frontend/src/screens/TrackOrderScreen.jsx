import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { api, SOCKET_URL } from '../api';
import StarRating from '../components/StarRating';
import LiveMap from '../components/LiveMap';
import ComplaintModal from './ComplaintModal';
import { generateTaxInvoiceDraft } from '../utils/taxInvoiceDraft';
import { DELIVERY_TYPES } from '../utils/delivery-type';
import { enablePushNotifications, isPushSupported, getInitialPushStatus, silentlyRefreshSubscription } from '../utils/pushNotifications';

// Same gradient palette + deterministic hash as RestaurantListScreen's bannerFor — kept as
// a small local copy (matching this codebase's convention of duplicating a few lines over
// introducing a shared-utils file) rather than pulling in that screen's full photo-lookup
// machinery just for a 48px thumbnail here.
const BANNER_GRADIENTS = [
  'linear-gradient(135deg, #f4a200 0%, #e4572e 100%)',
  'linear-gradient(135deg, #e4572e 0%, #a3341f 100%)',
  'linear-gradient(135deg, #4c7a52 0%, #2e5a3a 100%)',
  'linear-gradient(135deg, #d98324 0%, #8c4a1e 100%)',
  'linear-gradient(135deg, #c1432e 0%, #6a2a55 100%)',
];
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function gradientFor(name) {
  return BANNER_GRADIENTS[hashString(name || '') % BANNER_GRADIENTS.length];
}

// "900019XXXX" style — first 6 digits visible, rest masked. Real phone numbers appear
// elsewhere in the app to the account owner; this is a receipt shown back to the same
// customer, but keeping the masking consistent with the reference is a reasonable default.
function maskPhone(phone) {
  if (!phone) return '';
  const digits = String(phone);
  return digits.length <= 6 ? digits : `${digits.slice(0, 6)}${'X'.repeat(digits.length - 6)}`;
}

const STAGES = [
  { key: 'placed', label: 'Order placed' },
  { key: 'accepted', label: 'Accepted by restaurant' },
  { key: 'preparing', label: 'Preparing your food' },
  { key: 'ready_for_pickup', label: 'Ready for pickup' },
  { key: 'picked_up', label: 'Rider on the way' },
  { key: 'delivered', label: 'Delivered' },
];

// Backend returns PostGIS points as GeoJSON: { type: 'Point', coordinates: [lng, lat] }
function parseGeoPoint(geo) {
  if (!geo?.coordinates) return null;
  return { lng: geo.coordinates[0], lat: geo.coordinates[1] };
}

// Straight-line distance, not real road distance — same honest simplification the
// backend's own ETA estimate already makes (see AVG_DELIVERY_SPEED_MPS in
// orders.service.ts), reusing that exact same speed constant here so the two numbers
// a customer might see (order-creation ETA vs this live one) don't quietly disagree.
const AVG_DELIVERY_SPEED_MPS = 5.56; // ~20km/h average city delivery speed
function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Prints (or saves as PDF) a clean, branded, single-page receipt. A dedicated window is
// used instead of printing the app page: printing the SPA directly captured the dark app
// background and paginated hidden content into a blank second page.
function printReceipt(order) {
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const time = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const itemRows = (order.items || [])
    .map(
      (i) =>
        `<tr><td>${esc(i.menuItem?.name)} × ${i.quantity}${i.selectedOptions?.length ? ` <span style="color:#6b6156">(${esc(i.selectedOptions.map((o) => o.optionLabel).join(', '))})</span>` : ''}</td><td class="r">₹${(Number(i.priceAtOrder) * i.quantity).toFixed(0)}</td></tr>`,
    )
    .join('');
  const w = window.open('', '_blank', 'width=420,height=640');
  if (!w) return; // popup blocked — nothing to do
  w.document.write(`<!doctype html><html><head><title>MannaDash receipt #${esc(order.id.slice(0, 8))}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #1f1b16; margin: 24px; }
  h1 { font-size: 22px; color: #b3421f; margin: 0; }
  .muted { color: #6b6156; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
  td { padding: 3px 0; }
  .r { text-align: right; }
  .rule td { border-top: 1px solid #d8cdb8; padding-top: 6px; }
  .total td { font-weight: 700; font-size: 15px; }
  .footer { margin-top: 18px; font-size: 12px; color: #6b6156; text-align: center; }
</style></head><body>
  <h1>MannaDash</h1>
  <p class="muted">Receipt #${esc(order.id.slice(0, 8))} · ${esc(new Date(order.placedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }))}</p>
  <p><strong>${esc(order.restaurant?.name)}</strong><br/>
  <span class="muted">Placed ${time(order.placedAt)}${order.deliveredAt ? ` · Delivered ${time(order.deliveredAt)}` : ''}${order.deliveryPartner ? ` by ${esc(order.deliveryPartner.name)}` : ''}</span></p>
  <p class="muted">Picked up from: ${esc(order.restaurant?.address || order.restaurant?.name)}<br/>Delivered to: ${esc(order.deliveryAddress)}</p>
  <table>
    ${itemRows}
    <tr class="rule"><td class="muted">Item total</td><td class="r">₹${Number(order.subtotal).toFixed(0)}</td></tr>
    <tr><td class="muted">Delivery fee</td><td class="r">₹${Number(order.deliveryFee).toFixed(0)}</td></tr>
    ${order.deliveryType && order.deliveryType !== 'standard' ? (() => {
      const cfg = DELIVERY_TYPES.find((d) => d.value === order.deliveryType);
      const s = cfg?.surcharge ?? 0;
      return `<tr><td class="muted">${esc(cfg?.label)}</td><td class="r">${s > 0 ? '+' : '-'}₹${Math.abs(s)}</td></tr>`;
    })() : ''}
    ${Number(order.tipAmount) > 0 ? `<tr><td class="muted">Tip for rider</td><td class="r">+₹${Number(order.tipAmount).toFixed(0)}</td></tr>` : ''}
    ${Number(order.platformFeeAmount) > 0 ? `<tr><td class="muted">Platform fee</td><td class="r">+₹${Number(order.platformFeeAmount).toFixed(2)}</td></tr>` : ''}
    ${Number(order.packagingFeeAmount) > 0 ? `<tr><td class="muted">Packaging fee</td><td class="r">+₹${Number(order.packagingFeeAmount).toFixed(2)}</td></tr>` : ''}
    ${Number(order.restaurantGstAmount) > 0 ? `<tr><td class="muted">Restaurant GST</td><td class="r">+₹${Number(order.restaurantGstAmount).toFixed(2)}</td></tr>` : ''}
    ${Number(order.deliveryGstAmount) > 0 ? `<tr><td class="muted">GST on delivery</td><td class="r">+₹${Number(order.deliveryGstAmount).toFixed(2)}</td></tr>` : ''}
    ${order.discountAmount != null && Number(order.discountAmount) > 0 ? `<tr style="color:#2e7d32"><td>🎉 ${esc(order.appliedOfferName)}</td><td class="r">-₹${Number(order.discountAmount).toFixed(0)}</td></tr>` : ''}
    <tr class="total"><td>Total</td><td class="r">₹${Number(order.total).toFixed(0)}</td></tr>
    <tr><td class="muted">${order.paymentMethod === 'cod' ? 'Cash on delivery' : 'Online payment'}</td><td class="r">${esc(order.paymentStatus)}</td></tr>
  </table>
  <p class="footer">Thanks for ordering with MannaDash 🍛</p>
<script>window.onload = () => { window.print(); };</script>
</body></html>`);
  w.document.close();
}

export default function TrackOrderScreen({ orderId, onBack, onPayNow }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [riderPosition, setRiderPosition] = useState(null);
  const [restaurantRating, setRestaurantRating] = useState(0);
  const [deliveryRating, setDeliveryRating] = useState(0);
  const [comment, setComment] = useState('');
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [ratingError, setRatingError] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [pushStatus, setPushStatus] = useState(getInitialPushStatus); // 'idle' | 'enabling' | 'enabled' | 'error' | 'unsupported'
  const [pushError, setPushError] = useState('');
  const [showSupport, setShowSupport] = useState(false);

  useEffect(() => {
    if (pushStatus === 'enabled') silentlyRefreshSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEnablePush() {
    setPushStatus('enabling');
    setPushError('');
    try {
      await enablePushNotifications();
      setPushStatus('enabled');
    } catch (err) {
      setPushStatus('error');
      setPushError(err.message);
    }
  }

  // The server is the source of truth for "already rated" — local state alone re-asked
  // for a rating on every page reload (and resubmitting hit the duplicate-rating error)
  useEffect(() => {
    if (order?.status === 'delivered') {
      api.getOrderRating(order.id).then((res) => {
        if (res.rated) setRatingSubmitted(true);
      }).catch(() => {});
    }
  }, [order?.status, order?.id]);

  useEffect(() => {
    let socket;

    api
      .getOrder(orderId)
      .then(setOrder)
      .catch((err) => setError(err.message));

    socket = io(SOCKET_URL);
    socket.on('connect', () => socket.emit('subscribeToOrder', orderId));
    socket.on('orderUpdate', (updated) => setOrder(updated));
    socket.on('riderLocation', ({ lat, lng }) => setRiderPosition({ lat, lng }));

    return () => socket.disconnect();
  }, [orderId]);

  if (error) {
    return (
      <div className="screen">
        <button className="btn-secondary" onClick={onBack} style={{ marginTop: 12 }}>← Back</button>
        <div className="error-banner" style={{ marginTop: 16 }}>{error}</div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="screen">
        <p className="muted" style={{ marginTop: 40, textAlign: 'center' }}>Loading your order…</p>
      </div>
    );
  }

  const isCancelled = order.status === 'cancelled';
  const currentIndex = STAGES.findIndex((s) => s.key === order.status);

  async function submitRating() {
    setRatingError('');
    setSubmittingRating(true);
    try {
      await api.rateOrder(orderId, { restaurantRating, deliveryRating, comment: comment || undefined });
      setRatingSubmitted(true);
    } catch (err) {
      // Treat "already rated" as success from the UI's perspective — nothing more to do
      if (err.message.toLowerCase().includes('already been rated')) {
        setRatingSubmitted(true);
      } else {
        setRatingError(err.message);
      }
    } finally {
      setSubmittingRating(false);
    }
  }

  async function cancelOrder() {
    if (!window.confirm('Cancel this order? This cannot be undone.')) return;
    setCancelling(true);
    setCancelError('');
    try {
      const updated = await api.cancelOrder(orderId);
      setOrder(updated);
    } catch (err) {
      setCancelError(err.message);
    } finally {
      setCancelling(false);
    }
  }

  const destination = order ? parseGeoPoint(order.deliveryLocation) : null;
  let distanceRemainingKm = null;
  let etaMinutes = null;
  if (riderPosition && destination) {
    const meters = haversineMeters(riderPosition, destination);
    distanceRemainingKm = meters / 1000;
    etaMinutes = Math.max(1, Math.round(meters / AVG_DELIVERY_SPEED_MPS / 60));
  }

  return (
    <div className="screen">
      <div className="row" style={{ marginTop: 12, marginBottom: 12 }}>
        <button className="btn-secondary" onClick={onBack}>← Back</button>
        <button
          className="btn-secondary"
          onClick={() => setShowSupport(true)}
          style={{ color: 'var(--chili-dark)', borderColor: 'var(--chili)' }}
        >
          🎧 Support
        </button>
      </div>
      {showSupport && (
        <ComplaintModal orderId={order?.id} onClose={() => setShowSupport(false)} />
      )}
      <h1 style={{ fontSize: 22 }}>{order.status === 'delivered' ? 'Order Details' : order.restaurant.name}</h1>
      {order.status === 'delivered' && <p className="muted" style={{ marginTop: -8 }}>{order.restaurant.name}</p>}
      <p className="muted">Order total ₹{Number(order.total).toFixed(0)}</p>
      {order.paymentMethod === 'cod' && order.paymentStatus === 'pending' && (
        <p style={{ background: '#fff2d6', color: '#8a5a00', padding: '8px 12px', borderRadius: 8, fontSize: 14, fontWeight: 600 }}>
          💵 Pay ₹{Number(order.total).toFixed(0)} in cash when your order arrives
        </p>
      )}
      {!isCancelled && order.status !== 'delivered' && order.estimatedDeliveryAt && (
        <p className="muted">
          Estimated delivery by{' '}
          {new Date(order.estimatedDeliveryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </p>
      )}

      {isPushSupported() && pushStatus === 'idle' && !isCancelled && order.status !== 'delivered' && (
        <div className="card" style={{ marginBottom: 14 }}>
          <p style={{ margin: '0 0 10px' }}>🔔 Get notified the moment your order status changes.</p>
          <button className="btn-secondary" onClick={handleEnablePush}>Enable notifications</button>
        </div>
      )}
      {pushStatus === 'enabling' && <p className="muted" style={{ marginBottom: 14 }}>Enabling notifications…</p>}
      {pushStatus === 'error' && <p className="muted" style={{ marginBottom: 14, color: 'var(--chili)' }}>Couldn't enable notifications: {pushError}</p>}

      {order.status === 'placed' && (
        <div style={{ marginBottom: 16 }}>
          {cancelError && <div className="error-banner">{cancelError}</div>}
          <button className="btn-secondary" style={{ color: 'var(--chili-dark)', borderColor: 'var(--chili)' }} onClick={cancelOrder} disabled={cancelling}>
            {cancelling ? 'Cancelling…' : 'Cancel order'}
          </button>
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>You can cancel free of charge until the restaurant accepts it.</p>
        </div>
      )}

      {isCancelled ? (
        <div className="error-banner" style={{ marginTop: 20 }}>
          {order.cancelReason === 'acceptance_timeout'
            ? "The restaurant didn't respond in time, so this order was automatically cancelled."
            : order.cancelReason === 'restaurant'
            ? 'The restaurant cancelled this order.'
            : 'You cancelled this order.'}
        </div>
      ) : (
        <div className="tiffin-stack">
          {[...STAGES].reverse().map((stage, i) => {
            const stageIndex = STAGES.length - 1 - i;
            const filled = stageIndex < currentIndex;
            const current = stageIndex === currentIndex;
            return (
              <div key={stage.key}>
                {i === STAGES.length - 1 && <div className="tiffin-handle" />}
                <div className={`tiffin-tier ${filled ? 'filled' : ''} ${current ? 'current' : ''}`}>
                  {stage.label}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {order.status !== 'delivered' && (
        <div className="card" style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Delivering to</h3>
          <p style={{ margin: 0 }}>{order.deliveryAddress}</p>
        </div>
      )}

      {order.deliveryPartner && (
        <div className="card">
          <h3 style={{ fontSize: 15, marginBottom: 4 }}>Your rider</h3>
          <p style={{ margin: 0 }}>{order.deliveryPartner.name} · {order.deliveryPartner.vehicleType}</p>
        </div>
      )}

      {order.deliveryPartner && order.deliveryLocation && !['delivered', 'cancelled'].includes(order.status) && (
        <div style={{ marginBottom: 14 }}>
          <LiveMap
            riderPosition={riderPosition}
            destination={destination}
          />
          {riderPosition ? (
            <p style={{ marginTop: 8, fontSize: 14, fontWeight: 700, textAlign: 'center', color: 'var(--paper)' }}>
              🛵 {distanceRemainingKm.toFixed(1)} km away · ~{etaMinutes} min
              <span className="muted" style={{ fontSize: 11, fontWeight: 400, display: 'block', marginTop: 2 }}>
                Straight-line distance and an estimate — actual roads and traffic will vary
              </span>
            </p>
          ) : (
            <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>Waiting for your rider's live location…</p>
          )}
        </div>
      )}

      {order.status === 'delivered' && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <span style={{ fontSize: 26 }}>🛍️</span>
              <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--charcoal)' }}>Order was delivered</span>
            </div>
            {/* Delivery timeline — mirrors what the customer actually experienced */}
            <div style={{ fontSize: 13, borderTop: '1px solid #eee4d4', paddingTop: 10 }}>
              <p style={{ margin: '0 0 4px' }}>
                <span className="muted">Placed</span>{' '}
                {new Date(order.placedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
              </p>
              {order.pickedUpAt && (
                <p style={{ margin: '0 0 4px' }}>
                  <span className="muted">Picked up from {order.restaurant?.name}{order.restaurant?.address ? `, ${order.restaurant.address}` : ''}</span>{' '}
                  {new Date(order.pickedUpAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                </p>
              )}
              {order.deliveredAt && (
                <p style={{ margin: 0 }}>
                  <span className="muted">Delivered</span>{' '}
                  {new Date(order.deliveredAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                  {order.deliveryPartner && <> · by {order.deliveryPartner.name}</>}
                </p>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 48, height: 48, borderRadius: 10, flexShrink: 0, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 22,
                  background: gradientFor(order.restaurant?.name),
                }}
              >
                🍽️
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: 'var(--charcoal)' }}>{order.restaurant?.name}</p>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>{order.restaurant?.address}</p>
              </div>
              {order.restaurant?.phone && (
                <a
                  href={`tel:${order.restaurant.phone}`}
                  aria-label="Call restaurant"
                  style={{
                    width: 36, height: 36, borderRadius: '50%', background: '#fdf8ef', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, textDecoration: 'none',
                  }}
                >
                  📞
                </a>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <span className="muted" style={{ fontSize: 13 }}>Order ID: #{order.id.slice(0, 8)}</span>
              <button
                className="btn-secondary"
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => navigator.clipboard?.writeText(order.id)}
              >
                Copy
              </button>
            </div>
            {order.items?.map((item) => (
              <div key={item.id} className="row" style={{ marginBottom: 6, alignItems: 'flex-start' }}>
                <span style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}>
                  <span
                    aria-hidden
                    style={{
                      marginTop: 5, width: 10, height: 10, flexShrink: 0,
                      border: `1.5px solid ${item.menuItem?.isVeg ? '#2e6b34' : '#b3261e'}`,
                    }}
                  />
                  <span>
                    {item.menuItem?.name} × {item.quantity}
                    {item.selectedOptions?.length > 0 && (
                      <span className="muted"> ({item.selectedOptions.map((o) => o.optionLabel).join(', ')})</span>
                    )}
                  </span>
                </span>
                <span style={{ fontSize: 14 }}>₹{(Number(item.priceAtOrder) * item.quantity).toFixed(0)}</span>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 15, color: 'var(--charcoal)' }}>
                🧾 Bill Summary
              </span>
              <button
                onClick={() => printReceipt(order)}
                aria-label="Download bill"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--chili-dark)' }}
              >
                ⬇️
              </button>
            </div>
            <div style={{ fontSize: 14 }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="muted">Item total</span>
                <span>₹{Number(order.subtotal).toFixed(2)}</span>
              </div>
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="muted">Delivery partner fee</span>
                <span>₹{Number(order.deliveryFee).toFixed(2)}</span>
              </div>
              {order.deliveryType && order.deliveryType !== 'standard' && (
                <div className="row" style={{ marginBottom: 6 }}>
                  <span className="muted">{DELIVERY_TYPES.find((d) => d.value === order.deliveryType)?.label}</span>
                  <span>
                    {(() => {
                      const s = DELIVERY_TYPES.find((d) => d.value === order.deliveryType)?.surcharge ?? 0;
                      return s > 0 ? `+₹${s}` : `-₹${Math.abs(s)}`;
                    })()}
                  </span>
                </div>
              )}
              {Number(order.tipAmount) > 0 && (
                <div className="row" style={{ marginBottom: 6 }}>
                  <span className="muted">Tip for rider</span>
                  <span>+₹{Number(order.tipAmount).toFixed(2)}</span>
                </div>
              )}
              {Number(order.platformFeeAmount) > 0 && (
                <div className="row" style={{ marginBottom: 6 }}>
                  <span className="muted">Platform fee</span>
                  <span>₹{Number(order.platformFeeAmount).toFixed(2)}</span>
                </div>
              )}
              {Number(order.packagingFeeAmount) > 0 && (
                <div className="row" style={{ marginBottom: 6 }}>
                  <span className="muted">Packaging fee</span>
                  <span>₹{Number(order.packagingFeeAmount).toFixed(2)}</span>
                </div>
              )}
              {/* GST rows only ever appear on an order actually placed while GST_ENABLED
                  was on — see gst-config.util.ts. Nothing here fabricates a tax line. */}
              {Number(order.restaurantGstAmount) > 0 && (
                <div className="row" style={{ marginBottom: 6 }}>
                  <span className="muted">GST (govt. taxes)</span>
                  <span>₹{Number(order.restaurantGstAmount).toFixed(2)}</span>
                </div>
              )}
              {Number(order.deliveryGstAmount) > 0 && (
                <div className="row" style={{ marginBottom: 6 }}>
                  <span className="muted">GST on delivery</span>
                  <span>₹{Number(order.deliveryGstAmount).toFixed(2)}</span>
                </div>
              )}
              {order.discountAmount != null && Number(order.discountAmount) > 0 && (
                <div className="row" style={{ marginBottom: 6, color: 'var(--curry, #2e7d32)' }}>
                  <span>🎉 {order.appliedOfferName}</span>
                  <span>-₹{Number(order.discountAmount).toFixed(2)}</span>
                </div>
              )}
              <div className="row" style={{ fontWeight: 700, fontSize: 15, borderTop: '1px solid #eee4d4', paddingTop: 10, marginTop: 4 }}>
                <span>Paid</span>
                <span>₹{Number(order.total).toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="row" style={{ marginBottom: 12 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 34, height: 34, borderRadius: '50%', background: '#e5ddc9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>
                  👤
                </span>
                <span>
                  <span style={{ display: 'block', fontWeight: 700, fontSize: 14, color: 'var(--charcoal)' }}>{order.customer?.user?.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#8a8074' }}>{maskPhone(order.customer?.user?.phone)}</span>
                </span>
              </span>
            </div>
            <div style={{ borderTop: '1px solid #eee4d4', paddingTop: 10, marginBottom: 10 }}>
              <p className="muted" style={{ margin: '0 0 2px', fontSize: 12 }}>Payment method</p>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--charcoal)' }}>
                {order.paymentMethod === 'cod' ? '💵 Cash on delivery' : '💳 Paid online'}
              </p>
            </div>
            <div style={{ borderTop: '1px solid #eee4d4', paddingTop: 10, marginBottom: 10 }}>
              <p className="muted" style={{ margin: '0 0 2px', fontSize: 12 }}>Payment date</p>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--charcoal)' }}>
                {new Date(order.deliveredAt || order.placedAt).toLocaleString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </p>
            </div>
            <div style={{ borderTop: '1px solid #eee4d4', paddingTop: 10 }}>
              <p className="muted" style={{ margin: '0 0 2px', fontSize: 12 }}>Delivery address</p>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--charcoal)' }}>{order.deliveryAddress}</p>
            </div>
          </div>
        </>
      )}

      {order.status === 'delivered' && (
        <div className="card" id="order-receipt">
          <button className="btn-secondary" style={{ marginBottom: 10, width: '100%' }} onClick={() => printReceipt(order)}>
            ⬇ Invoice
          </button>
          {order.paymentStatus === 'paid' && (
            <>
              <button
                className="btn-secondary"
                style={{ marginBottom: 6, width: '100%', fontSize: 13 }}
                onClick={() => generateTaxInvoiceDraft(order.id)}
              >
                🧾 Tax Invoice (preview — placeholder GST numbers)
              </button>
              <p className="muted" style={{ fontSize: 11.5, marginBottom: 14 }}>
                Not a final tax document yet — GSTIN/PAN fields are placeholders until MannaDash is GST-registered.
              </p>
            </>
          )}

          {ratingSubmitted ? (
            <p style={{ margin: 0, fontWeight: 600, color: 'var(--curry)' }}>Thanks for rating your order!</p>
          ) : (
            <>
              <h3 style={{ fontSize: 16, marginBottom: 12 }}>How was your order?</h3>
              {ratingError && <div className="error-banner" style={{ background: 'rgba(228,87,46,0.1)', color: 'var(--chili-dark)', border: '1px solid var(--chili)' }}>{ratingError}</div>}
              <StarRating label="Food quality" value={restaurantRating} onChange={setRestaurantRating} />
              <StarRating label="Delivery experience" value={deliveryRating} onChange={setDeliveryRating} />
              <textarea
                placeholder="Any comments? (optional)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', marginBottom: 12 }}
              />
              <button
                className="btn-primary"
                onClick={submitRating}
                disabled={submittingRating || restaurantRating === 0 || deliveryRating === 0}
              >
                {submittingRating ? 'Submitting…' : 'Submit rating'}
              </button>
            </>
          )}
        </div>
      )}

      {order.paymentStatus === 'pending' && order.paymentMethod !== 'cod' && (
        <button className="btn-primary" onClick={() => onPayNow(order)}>
          Pay ₹{Number(order.total).toFixed(0)}
        </button>
      )}
      {order.paymentStatus === 'paid' && (
        <div className="pill" style={{ background: 'var(--curry)', color: '#fff' }}>Paid</div>
      )}
    </div>
  );
}
