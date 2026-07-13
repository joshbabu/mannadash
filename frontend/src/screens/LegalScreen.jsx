import { useState } from 'react';

// DRAFT STARTER CONTENT — NOT REVIEWED BY A LAWYER. This is reasonable, standard-shape
// text for an Indian food-delivery marketplace, written to be a genuine starting point,
// not filler. But real legal exposure (liability limits, refund obligations, data
// handling under India's DPDP Act) needs an actual lawyer's review before this is
// something MannaDash should rely on in a dispute. Update LAST_UPDATED when it's
// actually reviewed/changed — don't leave it stale.
const LAST_UPDATED = 'July 2026';

const TERMS_SECTIONS = [
  {
    heading: '1. Acceptance of these terms',
    body: `By creating an account or placing an order on MannaDash, you agree to these Terms of Service. If you don't agree, please don't use the app.`,
  },
  {
    heading: '2. What MannaDash is',
    body: `MannaDash is a marketplace connecting you with independent restaurant partners and delivery riders in Hyderabad. Restaurants prepare and are responsible for the food you order; MannaDash facilitates ordering, payment, and delivery coordination.`,
  },
  {
    heading: '3. Your account',
    body: `You're responsible for keeping your account and password secure, and for all activity under your account. Provide accurate delivery address and contact information — inaccurate details may delay or prevent delivery.`,
  },
  {
    heading: '4. Orders and payment',
    body: `Prices, availability, and estimated delivery times are set by individual restaurants and may change. You may pay by cash on delivery or online payment where available. Placing an order is an offer to purchase, which the restaurant may accept or decline (e.g. if an item becomes unavailable).`,
  },
  {
    heading: '5. Cancellations and refunds',
    body: `You can cancel an order free of charge any time before the restaurant accepts it. Once accepted, cancellation may not be possible, as the restaurant may have already started preparing your food. If a restaurant fails to accept your order in time, it's automatically cancelled and you are not charged. Refunds for paid orders are processed to your original payment method.`,
  },
  {
    heading: '6. Delivery',
    body: `Estimated delivery times are estimates, not guarantees — actual times can vary with traffic, weather, and order volume. Please ensure someone is available to receive the order at the address and time provided.`,
  },
  {
    heading: '7. Conduct',
    body: `Please don't misuse the platform — this includes providing false information, abusing delivery partners or restaurant staff, or attempting to circumvent payment or safety features.`,
  },
  {
    heading: '8. Liability',
    body: `MannaDash facilitates the connection between you, restaurants, and delivery partners, but food quality and preparation are the responsibility of the restaurant partner. To the extent permitted by law, MannaDash's liability for any claim is limited to the amount you paid for the relevant order.`,
  },
  {
    heading: '9. Changes to these terms',
    body: `We may update these terms from time to time. Continued use of MannaDash after a change means you accept the updated terms.`,
  },
  {
    heading: '10. Governing law',
    body: `These terms are governed by the laws of India, and disputes are subject to the jurisdiction of the courts in Hyderabad, Telangana.`,
  },
  {
    heading: '11. Contact',
    body: `Questions about these terms can be sent to the contact details available in the app.`,
  },
];

const PRIVACY_SECTIONS = [
  {
    heading: '1. Information we collect',
    body: `To provide the service, we collect: your name and phone number; delivery addresses and location; order history and payment method (we don't store full card details — those are handled by our payment processor); and app usage information like device type, for reliability and support.`,
  },
  {
    heading: '2. How we use it',
    body: `We use this information to process and deliver your orders, communicate order updates, provide customer support, and improve the service. We do not sell your personal information.`,
  },
  {
    heading: '3. Who we share it with',
    body: `Your name, delivery address, and order details are shared with the restaurant preparing your order and the delivery partner assigned to it — this is necessary to fulfil the order. We don't share your information with unrelated third parties for their own marketing.`,
  },
  {
    heading: '4. Data retention',
    body: `We keep order and account information for as long as your account is active, and as needed to meet legal, tax, and accounting obligations after that.`,
  },
  {
    heading: '5. Your rights',
    body: `You can review and update your account details in the app, and can request account deletion by contacting support. Some information may be retained where required by law (e.g. transaction records).`,
  },
  {
    heading: '6. Security',
    body: `We use industry-standard measures (encrypted connections, hashed passwords) to protect your information, though no system is completely immune to risk.`,
  },
  {
    heading: '7. Location data',
    body: `We use your location (or an address you provide) to find nearby restaurants and calculate delivery routes and fees. You can control location permissions through your device settings.`,
  },
  {
    heading: '8. Children',
    body: `MannaDash is not directed at children under 18, and we don't knowingly collect information from them.`,
  },
  {
    heading: '9. Changes to this policy',
    body: `We may update this policy from time to time; the "last updated" date at the top reflects the most recent version.`,
  },
  {
    heading: '10. Contact',
    body: `Questions about this policy can be sent to the contact details available in the app.`,
  },
];

export default function LegalScreen({ initialDoc = 'terms', onBack }) {
  const [doc, setDoc] = useState(initialDoc); // 'terms' | 'privacy'
  const sections = doc === 'terms' ? TERMS_SECTIONS : PRIVACY_SECTIONS;

  return (
    <div className="screen">
      <button className="btn-secondary" onClick={onBack} style={{ marginBottom: 16 }}>
        ← Back
      </button>
      <div className="row" style={{ gap: 8, marginBottom: 16 }}>
        <button
          className="btn-secondary"
          style={doc === 'terms' ? { background: 'var(--chili)', color: '#fff', borderColor: 'var(--chili-dark)' } : {}}
          onClick={() => setDoc('terms')}
        >
          Terms of Service
        </button>
        <button
          className="btn-secondary"
          style={doc === 'privacy' ? { background: 'var(--chili)', color: '#fff', borderColor: 'var(--chili-dark)' } : {}}
          onClick={() => setDoc('privacy')}
        >
          Privacy Policy
        </button>
      </div>

      <h1 style={{ fontSize: 22 }}>{doc === 'terms' ? 'Terms of Service' : 'Privacy Policy'}</h1>
      <p className="muted" style={{ marginBottom: 20 }}>Last updated: {LAST_UPDATED}</p>

      <div className="stack">
        {sections.map((s) => (
          <div key={s.heading}>
            <h3 style={{ fontSize: 15, marginBottom: 4 }}>{s.heading}</h3>
            <p className="muted" style={{ lineHeight: 1.6 }}>{s.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
