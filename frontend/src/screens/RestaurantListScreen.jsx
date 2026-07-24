import { useEffect, useState } from 'react';
import { api } from '../api';
import FilterModal from './FilterModal';
import AddressPickerScreen from './AddressPickerScreen';
import { isRestaurantOpenNow } from '../utils/restaurant-hours';

// Warm food-toned gradients for the card banner when no real photo matches the cuisine.
// Picked deterministically per restaurant (by name) so a given place always looks the same.
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

// Hitech City, Hyderabad — reasonable default center for the MVP demo area
const DEFAULT_LAT = 17.4435;
const DEFAULT_LNG = 78.3772;

// Curated quick-tap categories — tapping one just fills the same search box that already
// drives both the instant name/cuisine filter and the debounced dish search, so this adds
// zero new backend logic, purely a faster way to trigger what's already there. Fixed,
// hand-picked list rather than data-driven off actual order volume — at launch stage
// with a limited restaurant base, "most popular" would be thin or empty in places.
//
// searchTerm (when present) overrides label for the actual query, singular instead of
// plural — a plain substring search for "Cakes" never matches a dish literally named
// "Butterscotch Cake" (singular), but "Cake" matches both "Cake" and "Cakes" since the
// plural always contains the singular as a substring. label stays plural for the button
// itself, since that's the natural, expected way to read a category chip. Deliberately
// NOT applied to "Fries" — "Fries" (not "Fry") is the natural dish-name form itself
// (e.g. "Masala Fries"), so singularizing it would make matches worse, not better.
// "Pastry" uses a truncated root ("pastr") instead of the full singular — English's
// irregular y→ies plurals (Pastry/Pastries) break the "singular is a substring of the
// plural" trick that works for regular -s plurals, since "Pastry" is NOT a substring of
// "Pastries". A short common root sidesteps the irregularity entirely and matches both.
const QUICK_CATEGORIES = [
  { label: 'Biryani', icon: '🍛' },
  { label: 'Pizza', icon: '🍕' },
  { label: 'Burgers', icon: '🍔', searchTerm: 'Burger' },
  { label: 'Shawarma', icon: '🌯' },
  { label: 'Momos', icon: '🥟', searchTerm: 'Momo' },
  { label: 'Noodles', icon: '🍜', searchTerm: 'Noodle' },
  { label: 'Dosa', icon: '🫓' },
  { label: 'Idli', icon: '🍚' },
  { label: 'Pasta', icon: '🍝' },
  { label: 'Fries', icon: '🍟' },
  { label: 'Salad', icon: '🥗' },
  { label: 'Cakes', icon: '🍰', searchTerm: 'Cake' },
  { label: 'Pastry', icon: '🥐', searchTerm: 'pastr' },
  { label: 'Ice Cream', icon: '🍦' },
  { label: 'Shake', icon: '🥤' },
];

export default function RestaurantListScreen({ onSelectRestaurant, scheduledFor, onSetScheduledFor, budgetFilterActive }) {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState('distance'); // 'distance' | 'rating'
  const [searchQuery, setSearchQuery] = useState('');
  const [currentLatLng, setCurrentLatLng] = useState({ lat: DEFAULT_LAT, lng: DEFAULT_LNG });
  const [dishMatches, setDishMatches] = useState([]); // restaurants found by dish, not name/cuisine
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState(new Set());
  const [showFilterModal, setShowFilterModal] = useState(false);
  const EMPTY_FILTERS = { nearFast: false, noPackaging: false, pureVeg: false, ratingMin: null, hasOffer: false, priceRange: null, fssaiCertified: false, budgetMeal: false };
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [showAddressPicker, setShowAddressPicker] = useState(false);
  const [showLocationBanner, setShowLocationBanner] = useState(false);
  const [showLocationDeniedModal, setShowLocationDeniedModal] = useState(false);

  // Driven by the "Under ₹250" bottom-nav tab — kept in sync rather than owned here, since
  // that button needs to work as a real nav tab (switching away from Orders, showing an
  // active state) which only App.jsx's tab state can coordinate.
  useEffect(() => {
    setFilters((f) => (f.budgetMeal === !!budgetFilterActive ? f : { ...f, budgetMeal: !!budgetFilterActive }));
  }, [budgetFilterActive]);

  // Nudges the person to grant location access, mirroring the "Location Permission is Off"
  // banner competitors show — but only when it's actually off and they haven't already
  // granted it once this device (re-nagging every visit after they've said yes is worse
  // than not asking at all).
  useEffect(() => {
    if (!navigator.geolocation) return;
    if (localStorage.getItem('mannadash_location_granted') === 'true') return;
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' })
        .then((status) => {
          setShowLocationBanner(status.state !== 'granted');
          status.onchange = () => setShowLocationBanner(status.state !== 'granted');
        })
        .catch(() => setShowLocationBanner(true));
    } else {
      // Permissions API isn't available on this browser (notably older Safari) — fall
      // back to showing the prompt rather than silently assuming it's already granted.
      setShowLocationBanner(true);
    }
  }, []);

  useEffect(() => {
    // Distances/km on every restaurant card come from whatever lat/lng we call load()
    // with — so the initial load has to wait on saved addresses and use the default one's
    // coordinates when there is one, instead of always starting from the hardcoded
    // Hitech City fallback while the address bar shows "Home".
    api.getSavedAddresses()
      .then((addrs) => {
        setSavedAddresses(addrs);
        if (addrs.length > 0) {
          setSelectedAddress(addrs[0]);
          load(Number(addrs[0].latitude), Number(addrs[0].longitude));
        } else {
          load(DEFAULT_LAT, DEFAULT_LNG);
        }
      })
      .catch(() => load(DEFAULT_LAT, DEFAULT_LNG));
  }, []);

  function pickAddress(addr) {
    setSelectedAddress(addr);
    setShowAddressPicker(false);
    load(Number(addr.latitude), Number(addr.longitude));
  }

  function toggleBooleanFilter(key) {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  useEffect(() => {
    api.getFavorites().then((favs) => setFavoriteIds(new Set(favs.map((f) => f.id)))).catch(() => {});
  }, []);

  function toggleFavorite(restaurantId) {
    const isFavorited = favoriteIds.has(restaurantId);
    // Optimistic update — the heart should flip instantly, not wait on a round trip.
    // Reverted if the request actually fails, rather than left in a state that lies
    // about what's really saved server-side.
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (isFavorited) next.delete(restaurantId);
      else next.add(restaurantId);
      return next;
    });
    const request = isFavorited ? api.removeFavorite(restaurantId) : api.addFavorite(restaurantId);
    request.catch(() => {
      setFavoriteIds((prev) => {
        const reverted = new Set(prev);
        if (isFavorited) reverted.add(restaurantId);
        else reverted.delete(restaurantId);
        return reverted;
      });
    });
  }
  const [categoryPhotos, setCategoryPhotos] = useState({}); // { 'Biryani': url | null, ... }

  // Real photos per category — fetched once (backend caches these for 24h server-side too,
  // so this is cheap even across many customers). Falls back to the existing emoji icon
  // below for any category with no photo yet, or if this fetch itself fails.
  useEffect(() => {
    api.getCategoryPhotos().then(setCategoryPhotos).catch(() => {});
  }, []);

  // Phase H: dish-level search. The name/cuisine filter below is instant (client-side,
  // already-loaded data); dish search needs the backend (dish names aren't in the list
  // response at all) so it's debounced rather than fired on every keystroke.
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setDishMatches([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .getNearbyRestaurants(currentLatLng.lat, currentLatLng.lng, 8000, q)
        .then(setDishMatches)
        .catch(() => setDishMatches([]));
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, currentLatLng]);

  async function load(lat, lng) {
    setLoading(true);
    setError('');
    setCurrentLatLng({ lat, lng });
    try {
      const results = await api.getNearbyRestaurants(lat, lng);
      setRestaurants(results);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function locateMe() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        localStorage.setItem('mannadash_location_granted', 'true');
        setShowLocationBanner(false);
        load(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        // Covers both "user just tapped Deny on the native prompt" and "permission was
        // already permanently denied, so the browser didn't even show a prompt" — either
        // way the browser won't let a script re-trigger the prompt, so the only real next
        // step is pointing them at their OS Settings instead of asking again.
        if (err.code === err.PERMISSION_DENIED) setShowLocationDeniedModal(true);
        load(DEFAULT_LAT, DEFAULT_LNG);
      },
    );
  }

  const filteredRestaurants = restaurants.filter((r) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || r.cuisineType.toLowerCase().includes(q);
  });

  // Union of name/cuisine matches (instant) and dish matches (debounced, from the
  // backend) — a restaurant found only by dish still needs to actually appear, even if
  // its own name/cuisine never mentioned the search term at all
  const existingIds = new Set(filteredRestaurants.map((r) => r.id));
  const dishOnlyMatches = dishMatches.filter((r) => !existingIds.has(r.id));
  const combinedRestaurants = [...filteredRestaurants, ...dishOnlyMatches];

  // Every filter reads a real field already on the restaurant object — no fake/placeholder
  // badges. Filters combine with AND (each one narrows further), matching the reference.
  // Price buckets use the restaurant's minimum available price ("starting from"), not a
  // requirement that every single item fall in the bucket — matches how this kind of
  // filter reads elsewhere (a restaurant "under ₹200" means you *can* eat there for that,
  // not that everything on the menu is).
  const passesFilters = (r) => {
    if (filters.nearFast && !(r.distanceMeters <= 3000 && r.avgPrepTimeMins <= 30)) return false;
    if (filters.noPackaging && !(!r.packagingFee || Number(r.packagingFee) === 0)) return false;
    if (filters.pureVeg && r.isVegOnly !== true) return false;
    if (filters.ratingMin && Number(r.ratingAvg || 0) < filters.ratingMin) return false;
    if (filters.hasOffer && !r.hasActiveOffer) return false;
    if (filters.fssaiCertified && !r.fssaiNumber) return false;
    if (filters.budgetMeal && !(r.priceRange && Number(r.priceRange.minPrice) <= 250)) return false;
    if (filters.priceRange && r.priceRange) {
      const min = Number(r.priceRange.minPrice);
      if (filters.priceRange === 'under200' && !(min <= 200)) return false;
      if (filters.priceRange === '200to400' && !(min > 200 && min <= 400)) return false;
      if (filters.priceRange === 'above400' && !(min > 400)) return false;
    } else if (filters.priceRange) {
      return false; // no price data at all — can't confirm it matches, so don't include it
    }
    return true;
  };
  const filteredByQuickFilters = combinedRestaurants.filter(passesFilters);

  const sortedRestaurants = [...filteredByQuickFilters].sort((a, b) => {
    if (sortBy === 'rating') return Number(b.ratingAvg || 0) - Number(a.ratingAvg || 0);
    if (sortBy === 'deliveryTime') return a.avgPrepTimeMins - b.avgPrepTimeMins;
    return a.distanceMeters - b.distanceMeters;
  });

  const activeFilterCount = Object.entries(filters).filter(([, v]) => v).length;

  // "Recommended for you" — no per-user recommendation model exists, so rather than
  // faking one, this ranks by signals that are already real fields on the restaurant:
  // open right now, then highest rating, with an active offer as a tiebreaker nudge.
  // Only shown unfiltered/unsearched — it's meant as a browse-time surface, not another
  // place search results need to duplicate through.
  const recommended = !searchQuery.trim()
    ? [...restaurants]
        .filter((r) => isRestaurantOpenNow(r) && Number(r.ratingAvg || 0) > 0)
        .sort((a, b) => {
          const offerDiff = (b.hasActiveOffer ? 1 : 0) - (a.hasActiveOffer ? 1 : 0);
          if (offerDiff !== 0) return offerDiff;
          return Number(b.ratingAvg || 0) - Number(a.ratingAvg || 0);
        })
        .slice(0, 8)
    : [];

  // Pick a hero banner for a card: a real food photo when the cuisine maps to one of the
  // known categories (reusing the same photos the category row already loaded), otherwise
  // a deterministic warm gradient + emoji so every card still reads as image-forward.
  function bannerFor(r) {
    const cuisine = (r.cuisineType || '').toLowerCase();
    const matched = QUICK_CATEGORIES.find((cat) => {
      const term = (cat.searchTerm || cat.label).toLowerCase();
      return cuisine.includes(cat.label.toLowerCase()) || cuisine.includes(term);
    });
    const photo = matched ? categoryPhotos[matched.label] : null;
    if (photo) return { style: { backgroundImage: `url(${photo})` }, emoji: null };
    const grad = BANNER_GRADIENTS[hashString(r.name || '') % BANNER_GRADIENTS.length];
    return { style: { background: grad }, emoji: matched ? matched.icon : '🍽️' };
  }

  return (
    <div className="screen">
      <button
        data-testid="address-bar"
        onClick={() => setShowAddressPicker(true)}
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%', textAlign: 'left',
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          marginTop: 12, marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 20, lineHeight: '24px' }}>📍</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--paper)' }}>
              {selectedAddress ? selectedAddress.label : 'Set delivery location'}
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>▾</span>
          </span>
          <span
            style={{
              display: 'block', fontSize: 12, color: 'var(--text-dim)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {selectedAddress ? selectedAddress.address : 'Tap to choose a saved address'}
          </span>
        </span>
      </button>

      {showLocationBanner && (
        <div
          style={{
            position: 'fixed', left: 0, right: 0, bottom: 96, zIndex: 50,
            display: 'flex', justifyContent: 'center', padding: '0 20px', pointerEvents: 'none',
          }}
        >
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 12, background: '#2f6fed', borderRadius: 14,
              padding: '14px 16px', width: '100%', maxWidth: 440, boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              pointerEvents: 'auto', animation: 'slide-up-toast 0.3s ease-out',
            }}
          >
            <span style={{ fontSize: 20 }}>📍</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 800, color: '#fff', marginBottom: 2 }}>Location Permission is Off</p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
                Granting location permission will ensure accurate address and hassle-free delivery
              </p>
            </div>
            <button
              onClick={locateMe}
              style={{
                background: '#fff', color: '#2f6fed', border: 'none', borderRadius: 10, padding: '8px 16px',
                fontWeight: 800, fontSize: 13, cursor: 'pointer', flexShrink: 0,
              }}
            >
              GRANT
            </button>
            <button
              onClick={() => setShowLocationBanner(false)}
              aria-label="Dismiss"
              style={{
                background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', fontSize: 16,
                cursor: 'pointer', flexShrink: 0, padding: '0 0 0 2px', lineHeight: 1,
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {showLocationDeniedModal && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div style={{ background: '#fff', borderRadius: 14, overflow: 'hidden', width: '100%', maxWidth: 300, textAlign: 'center' }}>
            <div style={{ padding: '24px 20px 20px' }}>
              <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--charcoal)', marginBottom: 10 }}>Enable Location Services</p>
              <p style={{ fontSize: 14, color: '#4a463f', lineHeight: 1.4 }}>
                Please go to Settings and enable location services for MannaDash.
              </p>
            </div>
            <div style={{ display: 'flex', borderTop: '1px solid #e5ddc9' }}>
              <button
                onClick={() => setShowLocationDeniedModal(false)}
                style={{ flex: 1, padding: '13px 0', background: 'none', border: 'none', borderRight: '1px solid #e5ddc9', color: '#2f6fed', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => setShowLocationDeniedModal(false)}
                style={{ flex: 1, padding: '13px 0', background: 'none', border: 'none', color: '#2f6fed', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
              >
                Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddressPicker && (
        <AddressPickerScreen
          addresses={savedAddresses}
          selectedAddress={selectedAddress}
          onClose={() => setShowAddressPicker(false)}
          onSelectAddress={pickAddress}
          onAddressesUpdated={(updated) => {
            setSavedAddresses(updated);
            if (selectedAddress) {
              const stillThere = updated.find((a) => a.id === selectedAddress.id);
              setSelectedAddress(stillThere || null);
            }
          }}
          onUseMyLocation={() => { setShowAddressPicker(false); locateMe(); }}
          defaultLatLng={currentLatLng}
        />
      )}

      <div
        style={{
          position: 'sticky', top: 0, zIndex: 20,
          margin: '0 -20px', padding: '8px 20px 0',
          background: 'rgba(28, 27, 41, 0.92)', backdropFilter: 'blur(10px)',
          boxShadow: '0 8px 16px rgba(0,0,0,0.25)',
        }}
      >
      <input
        placeholder="Search by name, cuisine, or dish…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', marginBottom: 12 }}
      />
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, marginBottom: 8 }}>
        <button
          key="clear-all"
          aria-label="All"
          onClick={() => setSearchQuery('')}
          style={{
            flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', minWidth: 56,
          }}
        >
          <span
            style={{
              width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 20,
              background: !searchQuery.trim() ? 'var(--chili)' : '#fdf8ef',
              border: !searchQuery.trim() ? '2px solid var(--chili-dark)' : '1px solid #e5ddc9',
            }}
          >
            🍽️
          </span>
          <span style={{ fontSize: 11, color: !searchQuery.trim() ? 'var(--chili)' : 'var(--text-secondary, #c9c2b4)', fontWeight: !searchQuery.trim() ? 700 : 400 }}>
            All
          </span>
        </button>
        {QUICK_CATEGORIES.map((cat) => {
          const queryValue = cat.searchTerm || cat.label;
          const active = searchQuery.trim().toLowerCase() === queryValue.toLowerCase();
          return (
            <button
              key={cat.label}
              aria-label={`${cat.icon} ${cat.label}`}
              onClick={() => setSearchQuery(active ? '' : queryValue)}
              style={{
                flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', minWidth: 56,
              }}
            >
              <span
                style={{
                  width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 22,
                  background: categoryPhotos[cat.label]
                    ? `url(${categoryPhotos[cat.label]}) center/cover`
                    : (active ? 'var(--chili)' : '#fdf8ef'),
                  border: active ? '2px solid var(--chili-dark)' : '1px solid #e5ddc9',
                }}
              >
                {!categoryPhotos[cat.label] && cat.icon}
              </span>
              <span style={{ fontSize: 11, color: active ? 'var(--chili)' : 'var(--text-secondary, #c9c2b4)', fontWeight: active ? 700 : 400, whiteSpace: 'nowrap' }}>
                {cat.label}
              </span>
            </button>
          );
        })}
        <button
          key="all-categories"
          aria-label="See all categories"
          onClick={() => setShowAllCategories(true)}
          style={{
            flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px', minWidth: 56,
          }}
        >
          <span
            style={{
              width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 20, background: '#fdf8ef', border: '1px solid #e5ddc9',
            }}
          >
            ⋯
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-secondary, #c9c2b4)' }}>See all</span>
        </button>
      </div>
      </div>

      {showAllCategories && (
        <div
          onClick={() => setShowAllCategories(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            id="all-categories-modal"
            style={{ width: '100%', maxWidth: 480, maxHeight: '75vh', overflowY: 'auto', borderRadius: '24px 24px 0 0', marginBottom: 0 }}
          >
            <div className="row" style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 18 }}>All categories</h3>
              <button className="btn-secondary" onClick={() => setShowAllCategories(false)}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
              {QUICK_CATEGORIES.map((cat) => {
                const queryValue = cat.searchTerm || cat.label;
                const active = searchQuery.trim().toLowerCase() === queryValue.toLowerCase();
                return (
                  <button
                    key={cat.label}
                    aria-label={`${cat.icon} ${cat.label}`}
                    onClick={() => {
                      setSearchQuery(active ? '' : queryValue);
                      setShowAllCategories(false);
                    }}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      background: 'none', border: 'none', cursor: 'pointer', padding: '4px 2px',
                    }}
                  >
                    <span
                      style={{
                        width: 52, height: 52, borderRadius: '50%', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', fontSize: 22,
                        background: categoryPhotos[cat.label]
                          ? `url(${categoryPhotos[cat.label]}) center/cover`
                          : (active ? 'var(--chili)' : '#fdf8ef'),
                        border: active ? '2px solid var(--chili-dark)' : '1px solid #e5ddc9',
                      }}
                    >
                      {!categoryPhotos[cat.label] && cat.icon}
                    </span>
                    <span style={{ fontSize: 11, color: active ? 'var(--chili)' : '#6b6156', fontWeight: active ? 700 : 400, textAlign: 'center' }}>
                      {cat.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8 }}>
        <button
          onClick={() => setShowFilterModal(true)}
          style={{
            flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
            whiteSpace: 'nowrap', cursor: 'pointer', background: '#fdf8ef', color: 'var(--charcoal)',
            border: '1px solid #e5ddc9',
          }}
        >
          ⚙️ Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>
        {[
          { key: 'nearFast', icon: '⚡', label: 'Near & Fast', isActive: filters.nearFast, onToggle: () => toggleBooleanFilter('nearFast') },
          { key: 'noPackaging', icon: '📦', label: 'No packaging charges', isActive: filters.noPackaging, onToggle: () => toggleBooleanFilter('noPackaging') },
          { key: 'pureVeg', icon: '🌱', label: 'Pure Veg', isActive: filters.pureVeg, onToggle: () => toggleBooleanFilter('pureVeg') },
          { key: 'topRated', icon: '⭐', label: 'Rated 4.0+', isActive: filters.ratingMin === 4.0, onToggle: () => setFilters((prev) => ({ ...prev, ratingMin: prev.ratingMin === 4.0 ? null : 4.0 })) },
        ].map((f) => (
          <button
            key={f.key}
            onClick={f.onToggle}
            aria-pressed={f.isActive}
            style={{
              flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600,
              whiteSpace: 'nowrap', cursor: 'pointer',
              background: f.isActive ? 'var(--chili)' : '#fdf8ef',
              color: f.isActive ? '#fff' : 'var(--charcoal)',
              border: f.isActive ? '1px solid var(--chili-dark)' : '1px solid #e5ddc9',
            }}
          >
            {f.icon} {f.label}
          </button>
        ))}
      </div>
      {scheduledFor && (
        <div className="row" style={{ background: '#fdf8ef', borderRadius: 12, padding: '10px 14px', marginBottom: 12 }}>
          <span style={{ color: 'var(--charcoal)', fontSize: 13, fontWeight: 600 }}>
            🕐 Scheduled for {new Date(scheduledFor).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
          </span>
          <button className="btn-secondary" onClick={() => onSetScheduledFor(null)} style={{ fontSize: 12, padding: '4px 10px' }}>
            Cancel
          </button>
        </div>
      )}
      <div className="row" style={{ marginBottom: 16, gap: 8 }}>
        <button className="btn-secondary" onClick={locateMe}>
          📍 Use my location
        </button>
        <button
          className="btn-secondary"
          onClick={() => setSortBy(sortBy === 'distance' ? 'rating' : 'distance')}
        >
          Sort: {sortBy === 'distance' ? 'Nearest' : 'Top rated'}
        </button>
      </div>

      {!loading && recommended.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 10 }}>
            Recommended for you
          </p>
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
            {recommended.map((r) => {
              const banner = bannerFor(r);
              return (
                <button
                  key={r.id}
                  onClick={() => onSelectRestaurant(r)}
                  style={{
                    flex: '0 0 auto', width: 150, textAlign: 'left', background: 'var(--card-gradient)',
                    borderRadius: 14, overflow: 'hidden', boxShadow: '0 10px 22px rgba(0,0,0,0.3)', border: 'none', cursor: 'pointer',
                  }}
                >
                  <div style={{ position: 'relative', height: 90, ...banner.style }}>
                    {banner.emoji && (
                      <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34 }}>
                        {banner.emoji}
                      </span>
                    )}
                    {r.hasActiveOffer && (
                      <span style={{ position: 'absolute', top: 6, left: 6, background: 'rgba(0,0,0,0.65)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '3px 6px', borderRadius: 5 }}>
                        OFFER
                      </span>
                    )}
                  </div>
                  <div style={{ padding: '8px 10px 10px' }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--charcoal)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.name}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6b6156', marginTop: 2 }}>
                      <span style={{ color: '#2e6b34', fontWeight: 700 }}>★ {Number(r.ratingAvg).toFixed(1)}</span>
                      <span>· {r.avgPrepTimeMins} mins</span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}
      {loading && (
        <div aria-label="Loading restaurants">
          {[0, 1, 2].map((i) => (
            <div className="skeleton-rest-card" key={i}>
              <div className="skeleton-block skeleton-rest-card__banner" style={{ borderRadius: 0 }} />
              <div className="skeleton-rest-card__body">
                <div className="skeleton-block" style={{ height: 16, width: '55%', marginBottom: 10 }} />
                <div className="skeleton-block" style={{ height: 12, width: '75%', marginBottom: 8 }} />
                <div className="skeleton-block" style={{ height: 12, width: '40%' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && restaurants.length === 0 && !error && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p>No restaurants nearby yet.</p>
          <p className="muted" style={{ color: '#6b6156' }}>Try widening the search or check back soon — MannaDash is just getting started here.</p>
        </div>
      )}
      {!loading && restaurants.length > 0 && sortedRestaurants.length === 0 && !error && (
        <div className="card" style={{ textAlign: 'center' }}>
          <p>No restaurants match your filters.</p>
          <button className="btn-secondary" onClick={() => setFilters(EMPTY_FILTERS)} style={{ marginTop: 8 }}>
            Clear filters
          </button>
        </div>
      )}

      <div className="stack">
        {sortedRestaurants.map((r) => {
          const banner = bannerFor(r);
          const openNow = isRestaurantOpenNow(r);
          const rating = Number(r.ratingAvg || 0);
          const prep = r.avgPrepTimeMins;
          return (
            <div
              key={r.id}
              className="rest-card"
              role="button"
              aria-label={`View menu for ${r.name}`}
              tabIndex={0}
              onClick={() => onSelectRestaurant(r)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectRestaurant(r); }}
            >
              <div className="rest-card__banner" style={banner.style}>
                {banner.emoji && <span className="rest-card__banner-emoji">{banner.emoji}</span>}
                <button
                  className={`rest-card__fav${favoriteIds.has(r.id) ? ' is-favorited' : ''}`}
                  aria-label={favoriteIds.has(r.id) ? 'Remove from favorites' : 'Add to favorites'}
                  onClick={(e) => { e.stopPropagation(); toggleFavorite(r.id); }}
                >
                  {favoriteIds.has(r.id) ? '❤️' : '🤍'}
                </button>
                {r.hasActiveOffer && <span className="rest-card__offer">🏷️ Offers available</span>}
                {!openNow && <div className="rest-card__closed">Currently closed</div>}
              </div>
              <div className="rest-card__body">
                <div className="rest-card__title-row">
                  <span className="rest-card__name">{r.name}</span>
                  {rating > 0 ? (
                    <span className="rating-badge">{rating.toFixed(1)} ★</span>
                  ) : (
                    <span className="rating-badge rating-badge--new">New</span>
                  )}
                </div>
                <p className="rest-card__cuisine">
                  {r.cuisineType}
                  {r.costForTwo ? ` · ₹${r.costForTwo} for two` : ''}
                </p>
                <div className="rest-card__meta">
                  {r.isVegOnly && <span className="veg-badge">🌱 Pure Veg</span>}
                  {r.isVegOnly && <span className="dot" />}
                  <span>⏱ {prep}–{prep + 10} min</span>
                  <span className="dot" />
                  <span>{(r.distanceMeters / 1000).toFixed(1)} km</span>
                  {rating > 0 && (
                    <>
                      <span className="dot" />
                      <span>{r.ratingCount} {r.ratingCount === 1 ? 'rating' : 'ratings'}</span>
                    </>
                  )}
                </div>
                {r.matchedDishes?.length > 0 && (
                  <p className="rest-card__dish-hit">🍽️ {r.matchedDishes.join(', ')}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {showFilterModal && (
        <FilterModal
          filters={filters}
          onChangeFilters={setFilters}
          sortBy={sortBy}
          onChangeSortBy={setSortBy}
          scheduledFor={scheduledFor}
          onSetScheduledFor={onSetScheduledFor}
          onClose={() => setShowFilterModal(false)}
          resultCount={sortedRestaurants.length}
        />
      )}
    </div>
  );
}
