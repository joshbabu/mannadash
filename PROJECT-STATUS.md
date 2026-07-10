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
- **Phase B — Password reset** (decide: SMS-OTP via provider vs admin-assisted reset)
- **Phase C — Order acceptance timeout** (auto-cancel orders no restaurant touches)
- **Phase D — ~~Saved addresses~~ already built** (checkout has save/pick with labels)
- **Phase E — Delivery fee & minimum order review** (currently flat ₹30, no minimum)
- **Phase F — No-rider-available handling**
- **Phase G — Customer push notifications** (restaurant + rider already have push)
- **Phase H — Dish-level search** (find restaurants BY dish, not just name/cuisine)
- **Phase I — Launch checklist**: packaging charges, coupons/first-order offers, receipts,
  terms & privacy pages
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
