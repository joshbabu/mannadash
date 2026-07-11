# MannaDash — Project Status Handoff

*Last updated: end of the session that built operating hours, payouts, refunds, push
notifications, stock photos, and menu UI polish.*

## What this is

A Zomato/Swiggy-style food delivery platform for Hyderabad. Four apps, one backend, deployed and
live. GitHub: `joshbabu/mannadash`.

## Live URLs

- Backend API: `https://195-201-216-17.nip.io`
- Customer app: `mannadash-customer.pages.dev`
- Restaurant dashboard: `mannadash-restaurant.pages.dev`
- Rider app: `mannadash-rider.pages.dev`
- Admin panel: `mannadash-admin.pages.dev`
- Server: Hetzner VPS, Docker Compose (Postgres/PostGIS + NestJS + Caddy)

## Stack

NestJS backend, TypeORM/Postgres+PostGIS, React (Vite) × 4 frontends, Socket.io for live
updates, Docker/docker-compose for production, GitHub Actions for CI/CD, Cloudflare Pages for
frontend hosting, Cloudflare R2 for file storage.

## Everything that's been built (all live, all tested unless noted)

**Core platform**: multi-tenant restaurant/rider onboarding with admin approval, real-time order
lifecycle (placed → accepted → preparing → ready → picked up → delivered), live map tracking via
OpenStreetMap/Leaflet, ratings & reviews (restaurant + rider), rider earnings tracking, restaurant
insights dashboard (revenue, repeat customers, cancellation rate, peak hours, top items).

**This session's additions**:
- Restaurant operating hours (with overnight-wraparound handling)
- Rider payout tracking (admin-issued, double-pay-proof)
- Customer-initiated order cancellation (before restaurant accepts) + auto-flagged refund tracking
- Real push notifications (rider app + restaurant dashboard) — needs your own VAPID keys, already
  set up and confirmed working live
- Auto-fetched menu photos (Unsplash primary, Wikimedia fallback) + manual upload override
- Menu polish: discount pricing display, veg-only filter, bestseller badges (real sales data),
  truncated descriptions, collapsible categories with counts

**Restaurant improvement plan — Phase 1 (onboarding wizard) DONE**:
- 3-step registration wizard in the restaurant dashboard (Restaurant Info → Documents → Hours & Menu),
  modeled on Swiggy's partner onboarding
- New restaurant fields: owner email + WhatsApp, per-day weekly hours (jsonb, overnight-safe,
  takes precedence over the legacy single window), FSSAI number + expiry, PAN, GSTIN, bank
  IFSC + account, veg-only flag, cost-for-two
- PAN and bank details are @Exclude'd from every public response; the only way to read them is
  the admin/owner-guarded `GET /restaurants/:id/kyc`
- Admin panel: "Review KYC" panel on pending applications, with a red warning when the FSSAI
  licence is expired or expires within 30 days
- Order placement enforces per-day hours (closed days, per-day windows, overnight spillover)
- Tests: 19 new backend tests (weekly-hours logic + onboarding API + KYC access control) and a
  Playwright spec driving the full wizard in a real browser
- Remaining phases: 2) Order History page, 3) Live Orders board + online/offline toggle,
  4) customer app surfacing of veg-only / cost-for-two

**CI/CD**: `.github/workflows/test-and-deploy.yml` — one consolidated pipeline. `test` (backend
Jest, 22 tests) and `e2e` (Playwright, full cross-app flow) run first; `deploy-backend` and
`deploy-frontends` (all 4 apps) only run if both pass. Cloudflare's own auto-deploy is disabled on
all 4 projects — GitHub Actions is now the only thing that can actually deploy.

## Launch-readiness roadmap (gap analysis vs Zomato/Swiggy feature anatomy)

- **Phase A — Cash on Delivery: DONE.** Customers choose COD at checkout (default until Razorpay
  is live), rider app shows "Collect ₹X in cash", delivery flips the order to paid, cancelling an
  unpaid COD order flags no refund, and the Razorpay path refuses COD orders. Real paid orders
  are now possible with no gateway.
- **Phase B — Password reset: DONE (admin-assisted).** Admin panel has a "Reset a password"
  card (role + phone → temp password to relay over call/WhatsApp); all three apps have a
  Change Password UI backed by role-locked endpoints. SMS-OTP was deliberately deferred:
  SMS to Indian numbers requires DLT registration (Indian entity documents) — same root
  blocker as Razorpay. The self-service upgrade path when ready is **WhatsApp OTP via
  Meta's Cloud API** (works from a non-Indian business number; users' WhatsApp numbers are
  already captured at onboarding); the admin reset stays as the support fallback.
  *(Fixed during Phase F work: the "Reset a password" card was accidentally nested inside
  the pending-restaurants conditional, so it silently disappeared whenever the approval
  queue was empty — moved to always render regardless of tab or pending count.)*
- **Phase C — Order acceptance timeout: DONE.** A restaurant has 7 minutes to accept a placed
  order (mirrors Zomato/Swiggy's short accept-countdown convention); a cron sweep (every 30s)
  nudges the restaurant's live dashboard once at the halfway mark (3.5 min) and auto-cancels
  at the full timeout, reusing the same `updateStatus` path as a manual cancellation so
  refund-flagging and rider-release can't drift between the two. Auto-cancelled orders are
  tagged `cancelReason: 'acceptance_timeout'` (vs `'customer'` / `'restaurant'` for manual
  cancels), and both customer and restaurant apps show the honest reason rather than a bare
  "cancelled" pill. `ACCEPT_TIMEOUT_MINUTES = 7` lives on `OrdersService`; the restaurant
  dashboard mirrors it as `ACCEPT_TIMEOUT_SECONDS` for its live countdown UI — keep both in
  sync if this ever changes.
- **Phase D — ~~Saved addresses~~ already built** (checkout has save/pick with labels)
- **Phase E — Delivery fee & minimum order: DONE.** Flat ₹30 replaced with distance-tiered
  pricing (`backend/src/orders/delivery-fee.util.ts`, a pure function): ₹25 base fee inside
  3km, +₹6/km from 3–7km, +₹8/km beyond 7km, capped at ₹90. Reuses the restaurant↔customer
  distance already computed for the ETA estimate — no new PostGIS query needed. Restaurants
  can also set an optional minimum order value via Settings; checkout won't let a customer
  proceed below it, and the backend enforces it too (defense in depth, not just UI trust).
- **Phase F — No-rider-available handling: DONE.** A cron sweep (45s cadence) retries
  `assignRider` automatically for any ready-for-pickup order with no rider — reuses the
  exact same assignment path as a manual "Auto-assign nearest" click, so a successful retry
  is indistinguishable from a human doing it. The restaurant dashboard shows a live
  "🔍 Searching for a nearby rider…" indicator, turning urgent after
  `OrdersService.READY_STUCK_MINUTES` (5 min) with a "call one directly" prompt. The admin
  panel gets a "⏰ Needs a rider" card — read-only visibility (no auto-action) once an order
  has been stuck past that threshold, with a tap-to-call link to the restaurant. This module
  had a real bug caught by its own tests before shipping: the sweep's initial DB query
  omitted the `restaurant` relation, silently turning every retry attempt into a swallowed
  `TypeError` instead of the expected "no rider nearby" case — fixed, and the catch block now
  only swallows the specific expected exception, rethrowing anything else.
- **Phase G — Customer push notifications** (restaurant + rider already have push)
- **Phase H — Dish-level search** (find restaurants BY dish, not just name/cuisine)
- **Phase I — Launch checklist**: packaging charges, coupons/first-order offers, receipts,
  terms & privacy pages, **GST line** (platform is liable for 5% GST on restaurant orders under
  section 9(5) — touches order math, receipts, and payouts; needs its own careful session)
- **Phase J — Item variants & add-ons** (from the Zomato "Litti Chokha — Small/Medium/Large"
  reference). The real complexity isn't the UI, it's the data model: a `MenuItemVariantGroup`
  (name, `required`, `selectionType: 'single' | 'multiple'`) owning `MenuItemVariantOption`
  rows (label, priceDelta), and `OrderItem` needs to snapshot which options were picked *and*
  their price at order time — same pattern as `priceAtOrder`, extended. Cart state in the
  customer app goes from `{menuItemId: qty}` to keying on a composite of item + selected
  options, since "Litti Chokha, Large" and "Litti Chokha, Small" are different cart lines.
  Kitchen card and receipt both need to render the selected options per line. Sizeable —
  touches menu creation, cart, checkout, order entity, kitchen display, and receipts.
- **Phase K — Nutritional info per serving** (FSSAI-referenced in the reference screenshots:
  weight, protein, carbs, fat, fibre, calories — with calorie count derivable as
  `4×protein + 4×carbs + 9×fat` rather than manually entered, to keep the numbers honest).
  Smaller than variants: a handful of nullable columns on `MenuItem`, an optional expandable
  section on the dish card. Natural to build alongside Phase J since both touch the same
  add/edit-item form.
- **Phase L — Restaurant partner dashboard suite** (from the Zomato partner-app reference —
  this is the owner-facing half of the platform, distinct from anything customer-facing, and
  the largest remaining body of work). Breaks into independently shippable pieces:
  - **L1 — Offers & coupons engine**: percentage/flat discounts, freebie-on-minimum-order,
    audience targeting (all customers vs first-order-only), scheduling (day-of-week, time-of-day
    windows). Needs an `Offer` entity, an eligibility-check step in order pricing, and a
    redemption ledger so an offer's usage can be capped/reported on. This one also *unlocks*
    the coupons item already sitting in Phase I.
  - **L2 — Customer complaints inbox**: a structured complaint/ticket table (order-linked,
    status: open/resolved), surfaced in the admin panel first, restaurant dashboard second.
  - **L3 — Review replies**: owners responding to a rating's comment, threaded under the
    review — a small addition to the existing Rating entity (`replyText`, `repliedAt`) plus a
    restaurant-guarded PATCH.
  - **L4 — Deeper business analytics**: orders-percentage/discount-effectiveness graphs,
    online-percentage trend, delayed/rejected-order rate — most of the raw data already exists
    in the Order table; this is aggregation queries + chart UI on top of what Insights started.
  - **L5 — Notification preferences**: per-channel toggles (push/WhatsApp/email) and a weekly
    digest — meaningful once Phase G (customer push) and a messaging provider exist.
  - Explicitly not planned: the video/"Dish Bytes" reel feature — out of scope for this stage,
    not revisited.
- **Non-code**: domain purchase, Razorpay activation (phone number), Telugu localization (later)

## Known gaps / not yet done

- **Menu photos for restaurant dashboard's own polish** — customer app has all 5 new UI features;
  restaurant dashboard only got the `originalPrice` input, not veg-filter/bestseller display
  (wasn't needed there — that's a customer-facing browsing experience)
- **Restaurant dashboard push notifications** — built and working, but no "attribution" UI for
  Unsplash photos yet (their terms ask for photographer credit on public display — fine for
  testing, worth adding before a real public launch)
- **Domain name** — still on `nip.io` + `.pages.dev`, no real domain purchased
- **Razorpay** — blocked on getting an Indian phone number for account activation
- **Multi-admin** — not needed yet, solo operation

## Security — one open item

Earlier in this session, real R2 credentials were pasted directly into the chat. Instructions
were given to rotate them (create new token, delete old one) — **status of whether this was
actually completed is unconfirmed**. Worth checking `Manage R2 API Tokens` in Cloudflare and
making sure only one current, non-exposed token exists.

## Testing policy (this matters — read `TESTING.md`)

Every new feature, backend or frontend, gets a matching automated test at the same time it's
built — not after. This slipped once this session (cancellation/refund shipped without tests,
caught and fixed same day) — `TESTING.md` has the full story and is worth keeping honest over
time, not just today.

## Real lessons learned this session (worth not re-learning the hard way)

1. **Docker Compose doesn't auto-pass `.env` vars into containers** — every new env var needs an
   explicit line in `docker-compose.prod.yml`'s `environment:` block, or it silently stays empty
   inside the container even though it's correctly in `.env`. This bit us twice (VAPID keys, R2
   menu image vars) before we started proactively checking for it.
2. **Test harness must mirror `main.ts`** — `backend/test/test-helpers.ts` bootstraps the app
   separately from production; any new middleware/config in `main.ts` (like the body-size-limit
   fix) needs the identical change mirrored there, or tests can pass while testing against
   production-inaccurate behavior.
3. **Caddy briefly serves stale responses right after a backend redeploy** — a few seconds to a
   minute of apparent staleness after `docker compose up -d --build` is normal, self-heals
   automatically, not a bug to chase.
4. **This sandbox can't run a real browser or reach every external domain** — Playwright e2e
   tests and things like the Wikimedia/Unsplash stock photo lookups get built and type-checked
   here, but their first *real* run happens in GitHub Actions (which has full internet access) or
   on your actual server — this is expected, not a sign of low confidence in the code.

## For the new chat

Paste this file's contents, or just reference "MannaDash" — Claude's memory system should also
already have a lot of this context from earlier conversations in this project. If picking up a
specific unfinished thread, mention it explicitly (e.g. "let's do the domain name next" or
"let's finish restaurant dashboard photo polish").
