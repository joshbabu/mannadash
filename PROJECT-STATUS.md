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
- **Phase G — Customer push notifications: DONE.** The backend infrastructure
  (`PushSubscription`, `PushService`, the `/push/subscribe` endpoint) was already fully
  generic by role — zero backend changes needed for subscription itself, confirmed by a
  test that a customer can use the exact same endpoint riders/restaurants already use.
  Wired into `updateStatus()`: a customer gets notified at the three moments they actually
  care about — accepted, picked up, delivered — plus cancelled with an honest reason
  (acceptance-timeout vs restaurant-initiated), deliberately skipping non-actionable
  internal transitions like "preparing". Frontend: copied the existing generic
  `sw.js`/`pushNotifications.js` from the rider app verbatim (no customer-specific logic
  needed) and added the same "Enable notifications" prompt pattern to `TrackOrderScreen`
  — the moment a customer is actually watching an order, not buried in settings.
  **Follow-up, same session:** iOS Safari blocks the underlying Push API entirely unless
  a site has been added to the Home Screen as an installed PWA (an Apple restriction, not
  fixable from the app side) — so added basic PWA installability: `manifest.json`, a real
  icon set (`icon-192.png`/`icon-512.png`/`apple-touch-icon.png` — replaced the leftover
  Vite-scaffold purple favicon that was never actually MannaDash-branded), and the
  Apple-specific meta tags iOS needs (it ignores `manifest.json` for install behavior).
  Android/Chrome/desktop already worked without any of this; this specifically unblocks
  iOS. Regression-checked in Playwright: manifest is linked, fetchable, and has icons.
  **Confirmed working end to end in production**, all three roles (customer/restaurant/
  rider), after a real incident and its full fix — see lesson 10 below for the complete
  chain (a malformed VAPID key briefly took down the whole backend, then a stale-browser-
  subscription bug, then an Apple-specific VAPID subject issue — each found and fixed in
  turn with a real repro test, not guessed away).
- **Phase H — Dish-level search: DONE.** Extends the existing geo search (`findNearby`)
  with an optional `dish` param, rather than a separate endpoint — dish search still
  respects the same geographic/open/approved constraints a hyperlocal app needs (no use
  surfacing a restaurant 50km away, or one that's currently closed). Case-insensitive
  substring match against currently-*available* menu items only — a sold-out dish
  wouldn't help anyone. Returns which dish(es) actually matched (`matchedDishes`), so the
  UI can explain *why* a restaurant showed up for a search that doesn't match its own
  name. Frontend: the existing instant client-side name/cuisine filter is untouched;
  dish matches come from a debounced (350ms) backend call and get merged in — a
  restaurant found only by dish still shows up, with a "🍽️ [dish name]" line explaining
  the match. 8 backend tests (case-insensitivity, partial matches, sold-out exclusion,
  radius exclusion, closed-restaurant exclusion, multi-dish matching, and confirming
  zero behavior change when no dish search is performed) plus a real-browser Playwright
  step searching a dish name that shares nothing with the restaurant's own name.
  **Same-session follow-up**: a tappable category icon row (Biryani, Pizza, Dosa, Momos,
  etc. — 15 curated, hand-picked for launch rather than derived from actual order volume,
  which would be thin this early) sits above the search box, matching the Swiggy/Zomato
  reference pattern. Tapping one just fills the same search box that already drives both
  the instant name/cuisine filter and the debounced dish search — no new backend logic,
  purely a faster way to trigger what's already there. Tap again to clear it.
- **Phase I — Launch checklist**: packaging charges, coupons/first-order offers, receipts,
  terms & privacy pages, **GST line** (platform is liable for 5% GST on restaurant orders under
  section 9(5) — touches order math, receipts, and payouts; needs its own careful session)
- **Phase J — Item variants & add-ons: DONE.** `MenuItemVariantGroup` (name, `required`,
  `selectionType: 'single' | 'multiple'`) owns `MenuItemVariantOption` rows (label,
  priceDelta); a dish can have several groups (Size AND Spice Level independently).
  `OrderItemOption` snapshots what was actually picked and its price at order time — proven
  by an e2e test that deletes the variant group after ordering and confirms the historical
  order is untouched. Price is always computed server-side (base + every selected delta),
  with an explicit test for the spoofing case (pointing at another restaurant's option id).
  Restaurant dashboard: a "Variants" panel per menu item (add/edit/delete groups, sync
  options on edit — upsert by id, drop what's removed). Customer app: cart state changed
  from `{menuItemId: qty}` to keying on item + selected options, so "Litti Chokha, Large"
  and "Litti Chokha, Small" are separate lines; a picker modal opens on Add for any dish
  with variant groups, disables "Add to cart" until required groups are satisfied, and
  shows the live running price. Kitchen card, restaurant order history, and the customer
  receipt (on-screen and printed) all show the selected options per line. Backend: 98
  tests, all passing, including the security case; Playwright: one self-contained step
  (a second dish, so it doesn't disturb the primary flow's existing price assertions)
  driving the full picker → cart → checkout journey in a real browser.
- **Phase K — Nutritional info per serving: DONE.** Five optional gram fields on `MenuItem`
  (weight, protein, carbs, fat, fibre) — deliberately no stored calorie count; it's derived
  as `4×protein + 4×carbs + 9×fat` everywhere it's shown (dashboard's live preview while
  typing, customer's expandable "🥗 N kcal" line), so a manually-typed number can never
  drift from the macros that supposedly produced it. Dashboard: collapsible section on the
  add-item form, plus a per-item "+ Add nutritional info" editor for dishes that already
  exist (`NutritionEditor.jsx`, small and flat — no groups, unlike variants). Fully optional
  end to end; a dish with none of these set behaves exactly as before.
- **Phase L — Restaurant partner dashboard suite** (from the Zomato partner-app reference —
  this is the owner-facing half of the platform, distinct from anything customer-facing, and
  the largest remaining body of work). Breaks into independently shippable pieces:
  - **L1 — Offers & coupons engine: DONE.** One `Offer` entity spans two very different UX
    modes: `code: null` = automatic (best eligible offer applies itself silently, comparing
    ACTUAL computed discount when several qualify, not just declared value) and `code: set`
    = the customer types it, and a valid code always wins over whatever would've applied
    automatically — a deliberate customer action should take precedence. Three discount
    types (percentage with an optional cap, flat ₹, free delivery). Full eligibility engine:
    minimum order, first-order-only audience (checked against real delivery history), day-
    of-week/time-of-day windows, and per-customer/total usage limits backed by an
    `OfferRedemption` ledger — counted, never a counter column that could drift. An invalid
    or ineligible code throws a SPECIFIC reason ("needs a minimum order of ₹500"), never
    silence. `POST /offers/preview` mirrors the real resolution but never throws, so
    checkout can show why a code didn't work inline. Public listing exposes automatic
    offers in full but code-based ones only as a blind teaser (`hasCode: true`, no `code`
    field) — tested explicitly that the literal code string never appears in that response.
    Restaurant dashboard: new Offers tab, full CRUD, pause/resume without losing redemption
    history. Customer: an offers teaser on the menu page, a checkout banner for whichever
    offer applies automatically, and a promo code box that overrides it. 23 backend tests
    (compiled clean and passed 20/20 on the very first real run — the rest of the session's
    hard-won lessons about locator ambiguity and cross-file test isolation clearly paid off
    here) plus a full real-browser thread proving code-overrides-automatic in an actual UI.
    This also unlocks the coupons item already sitting in Phase I.
  - **Checkout UX pass (Uber Eats/Swiggy reference): DONE.** A combined "🎉 ₹X saved on
    this order!" banner instead of the discount being buried in the price breakdown; a
    sticky bottom "To Pay ₹X" bar with the CTA always visible; quantity steppers directly
    in the checkout item list (a checkout-local cart copy — MenuScreen's own cart is
    untouched, so Back still shows what was originally added there); an opt-in "🍴 Send
    cutlery" checkbox; a "You are ordering for [name], updates on [phone]" banner from the
    account's own details; and a **Delivery Type / Tip / Instructions tab bar**.
    Delivery Type (Express +₹29 / Standard / Eco -₹5) isn't just a price tag — Express
    genuinely jumps the queue in `retryUnassignedReadyOrders()` (see L1's dispatch-priority
    note below), the honest version of "faster" a single shared rider pool can actually
    deliver on, proven by a test that places a Standard order BEFORE an Express one and
    confirms Express still wins the one available rider. Tips flow straight to the rider's
    own earnings, added to (never touched by commission on) the delivery fee — the rider
    earnings screen shows delivery fee and tip as separate line items so a rider can see
    when they were tipped, not just a lump sum.
  - **Platform fee & GST: built AND deployed, currently in testing mode.** MannaDash isn't
    GST-registered yet (confirmed directly), so real customers never see this until it's
    deliberately turned on for good — but Joshua wanted to preview it in dev, so it's live
    and toggleable right now. Two different things live in
    `backend/src/orders/gst-config.util.ts`: **platform fee** (MannaDash's own charge, not
    a tax — can be on any time, no registration needed) and **GST** (real tax law — CGST
    Act section 9(5) makes the *platform*, not the individual restaurant, liable to
    collect and remit once registered as an e-commerce operator; turning this on before
    registration would mean charging a tax that isn't actually going anywhere real). Both
    are env-var-gated (`PLATFORM_FEE_AMOUNT`, `GST_ENABLED`, `GST_RESTAURANT_RATE_PERCENT`,
    `GST_DELIVERY_RATE_PERCENT`) and always server-computed — a client attempting to send
    these fields on an order gets rejected outright (`forbidNonWhitelisted`), not silently
    ignored. Fully tested (`gst-and-platform-fee.e2e-spec.ts`, 6 tests): genuinely zero
    when unconfigured, platform fee independent of GST, both GST lines computed correctly
    once enabled, commission never inflated by either, GST on delivery computed from the
    real fee before any offer discount. **Advice given, not yet decided:** recommended
    launching with platform fee at ₹0 as a differentiator against Swiggy/Zomato's creeping
    ₹10ish fees. The frontend is driven entirely by what the backend returns — nothing
    extra shows unless the backend actually returns a nonzero value, no separate frontend
    flag to keep in sync.

    **How it's actually toggled** (`.github/workflows/toggle-gst.yml`): a manual-only
    GitHub Actions workflow (`workflow_dispatch` — never fires on a push) that SSHs in
    using the same `SSH_HOST`/`SSH_USER`/`SSH_PRIVATE_KEY` secrets the normal deploy
    already uses, surgically rewrites just those four lines in the server's real `.env`
    (backed up first, every other line — DB password, JWT secret — untouched), and
    restarts the backend container. All four values (on/off + the three numbers) are
    typed directly into the "Run workflow" form — a deliberate testing-phase choice so
    nothing needs a GitHub secret set up first. **Before real customers are on the
    platform**, switch `platform_fee_amount`/`gst_restaurant_rate`/`gst_delivery_rate`
    to repo secrets instead (Settings → Secrets and variables → Actions) — form inputs
    are visible in that run's log, fine for now, not once these are live numbers.
    **The rates used (5% food, 18% delivery) are the commonly-cited ones as of this
    writing, NOT verified tax advice — confirm the actual applicable rates with an
    accountant before relying on this for real orders**, even though the mechanism
    itself is proven and working.
  - **L2 — Customer complaints inbox**: a structured complaint/ticket table (order-linked,
    status: open/resolved), surfaced in the admin panel first, restaurant dashboard second.
  - **L3 — Review replies: DONE.** `Rating` gained `replyText`/`repliedAt`; a restaurant-
    owner-guarded `PATCH /orders/ratings/:id/reply` (ownership checked through
    `order.restaurant`, since Rating has no direct restaurant FK). One reply per review,
    editable in place — replying again overwrites rather than stacking a thread, matching
    Zomato's model (tested explicitly). Restaurant dashboard gained its first-ever Reviews
    tab (`ReviewsScreen.jsx`) to actually see and answer reviews — reuses the existing
    public reviews endpoint rather than adding a parallel authed one. Customer menu screen
    shows the reply under the original comment, quoted-reply style.
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
5. **Every app's `logout()` cleared the token but not the cached user object** — same bug,
   copy-pasted into all four apps at initial build. In-memory state reset masked it within a
   tab; only a refresh right after logout exposed it (stale cache re-hydrates the dashboard
   with no valid token → real "Unauthorized" errors under a UI that still looks logged in).
   Found by manual testing, not by a test — a reminder that "log out, then refresh" is a real
   user path worth checking by hand even when the happy path is covered. Now regression-locked
   in `e2e/tests/auth-logout.spec.ts` for all four apps.
6. **The light-card-in-dark-theme contrast bug is now a confirmed pattern, not a one-off** —
   third occurrence (admin KYC panel, the receipt, and now the Phase J variant picker + its
   checkout summary). Root cause every time: the customer app is dark-themed globally, but
   `.card` uses a light "paper" background as an intentional light-mode island — and `.muted`
   defaults to a light gray tuned for the dark background, so it's invisible (not missing,
   genuinely rendered, just unreadable) on any card. First fix on this attempt was WRONG —
   assumed a stale browser tab rather than checking the actual CSS, and told Joshua so before
   verifying. Correct process going forward: any new light `.card` surface in the customer
   app needs `#that-card-id .muted { color: #6b6156 }` added in `theme.css` from the start,
   not discovered after a user reports invisible text. Both the picker and checkout summary
   are now regression-locked with `toHaveCSS('color', ...)` assertions (not just `toBeVisible`,
   which passes even when text is genuinely unreadable).
   **Update (Phase K/L3 session): consolidated all four one-off fixes into a single
   structural rule, `.card .muted { color: #6b6156; }`, once it became clear nearly every
   screen in the app combines the two and a fifth occurrence (the reviews card) turned up
   on inspection before anyone even reported it. Provably safe as a blanket rule since it's
   a descendant selector — it can only ever touch `.muted` text that's physically nested
   inside a `.card`, which is uniformly light-background everywhere in this app.**
7. **A test asserting "no X exists" is only true in isolation, not in a full-suite run
   against a shared DB.** `no-rider-handling`'s "leaves an order alone when no rider exists
   at all" assumed exactly that — but riders created by unrelated spec files (anywhere near
   the shared default test coordinates) can be real and available by the time this test's
   assertion runs, invalidating the premise. The other two tests in that same file already
   used isolated coordinates for this exact reason; this one didn't, since it wasn't
   expected to need it, until Phase L3's new spec (which also creates riders) changed the
   full-suite's timing enough to expose it. Lesson: any test whose assertion depends on
   "nothing else exists" needs the same spatial isolation as tests asserting "the sweep
   found MY thing" — the two are symmetric risks, not just the latter.
8. **`CheckoutScreen.jsx` had accumulated real duplication before the delivery-type/tip
   build even started** — a complete-but-unwired earlier pass had already added
   `DELIVERY_TYPES`/`TIP_PRESETS` state, a properly-extracted `utils/delivery-type.js`, and
   two full standalone cards, none of which had been surfaced or mentioned. Building on top
   without checking first produced duplicate `useState` declarations (a hard compile
   error, caught immediately) and, more worryingly, a duplicate "ordering for" banner that
   would have silently rendered twice (no compile error — just visibly wrong). Lesson: for
   a file this actively churned in one session, grep for the state/constant names *before*
   adding them, not just read the section you're about to touch — the rest of the file may
   already have moved. The existing delivery-type/tip Playwright assertions turned out to
   already be correct and complete once found, which cut real rework — worth checking what's
   already there before writing new tests too, not just new code.
9. **Similarly-named patches for the same feature are genuinely confusable, in practice, not
   just in theory.** Setting up the GST toggle produced three patches in close succession —
   `platform-fee-gst.patch`, `gst-env-passthrough.patch`, `toggle-gst-workflow.patch` — and
   Joshua legitimately re-applied `toggle-gst-workflow.patch` a second time thinking it was
   `gst-env-passthrough.patch`, which silently did nothing (already applied → nothing to
   commit → no push → no CI run), and cost real back-and-forth to diagnose (had to walk
   through `docker exec ... env | grep GST` coming back empty before finding the actual
   cause). Lesson: when several patches land in one sitting for one feature, say the target
   *filename* explicitly every time ("this one touches docker-compose.prod.yml", "this one
   touches .github/workflows/"), not just the patch's own filename — the person applying
   them is juggling a Downloads folder, not reading diffs before running `git apply`.
10. **A real production outage happened testing Phase G, and it's worth having the full
    chain written down.** Testing customer push on iOS surfaced `BadJwtToken` from Apple's
    push service — turned out unrelated to iOS or the new customer code (it also broke
    the already-working restaurant push), and traced to the VAPID key pair in `.env`
    being malformed. A manual key-rotation attempt then wrote the literal placeholder text
    `<paste the new public key here>` into `.env` (an easy mistake copying a multi-step
    command block), and NestJS's `PushService` constructor — which only guards against
    keys being *absent*, not *malformed* — threw uncaught during dependency injection,
    **crashing the entire backend**, not just push. Recovered by removing the VAPID lines
    entirely (matches the "absent" guard, restores everything else immediately) before
    fixing the actual key pair. Even after generating a genuinely fresh, correctly-matched
    pair, `BadJwtToken` persisted — because `pushManager.subscribe()` doesn't replace an
    existing browser-side subscription when called with a *different* key; it silently
    hands back the old (now-invalid) one. Fixed in `pushNotifications.js` (all three
    apps — same bug, copy-pasted three times, only ever surfaced once a key was rotated):
    explicitly `unsubscribe()` any existing subscription before creating a new one.
    Two real lessons: **(a)** any constructor/startup code that validates external config
    should fail closed to "disabled" on malformed input, the same way it already does for
    missing input — a stricter guard here would have prevented the outage entirely;
    **(b)** rotating a push VAPID key isn't just a server-side change, every existing
    client subscription is now silently stale and needs an explicit, verified resubscribe,
    not just "tap the button again."

    **The actual final root cause, found after the two fixes above:** even with a fresh,
    correctly-matched key pair and genuinely new subscriptions, Apple's push service kept
    rejecting every send with `BadJwtToken` — every other role (restaurant, rider) failed
    identically, ruling out anything iOS- or customer-specific. The remaining suspect was
    the VAPID **subject** claim (a contact URI embedded in every push JWT), hardcoded to
    the placeholder `mailto:admin@mannadash.example`. Made it configurable via
    `VAPID_SUBJECT` (`gst-config.util.ts`-style env var, defaults to the old placeholder
    so nothing changes for anyone who hasn't set it) and passed through
    `docker-compose.prod.yml` the same way as the GST vars earlier. Pointing it at a real,
    working email resolved `BadJwtToken` for the customer immediately. Restaurant and
    rider then showed a *different*, more specific error — `VapidPkHashMismatch` — which
    is Apple's push service explicitly confirming "this subscription was created with a
    different public key than you're signing with now": exactly the same stale-subscription
    issue from lesson (b) above, just surfacing per-role as each app's session got
    refreshed. Once all three apps had gone through a fresh resubscribe against the final,
    correct config, all push notifications worked cleanly with zero warnings in the logs.
    **Honest note on confidence**: the VAPID-subject fix was proposed as a well-motivated
    experiment based on other developers' reports of this exact Apple-specific symptom,
    not a diagnosis I could verify with certainty from documentation alone — it happened
    to be correct, but the more reliable path when this class of narrow, platform-specific
    issue comes up again is to check current, actively-maintained sources (e.g. open
    issues on the `web-push-node/web-push` GitHub repo) rather than assume the general
    explanation holds for whatever the current spec version's real behavior is.

    Regression-tested end to end: `push.e2e-spec.ts` now covers a malformed public key,
    a malformed VAPID_SUBJECT (same fail-closed guard covers both), a custom subject
    actually taking effect, and the default subject still working when unset — 9 tests,
    all reproducing tonight's real failure modes rather than just checking happy paths.

## For the new chat

Paste this file's contents, or just reference "MannaDash" — Claude's memory system should also
already have a lot of this context from earlier conversations in this project. If picking up a
specific unfinished thread, mention it explicitly (e.g. "let's do the domain name next" or
"let's finish restaurant dashboard photo polish").
