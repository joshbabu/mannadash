import { useEffect, useState } from 'react';
import { api } from '../api';
import VariantPicker from '../components/VariantPicker';

// "Open today: 09:00–22:00" / "Closed today" from whichever hours scheme is configured
function todayHoursLabel(restaurant) {
  const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const weekly = restaurant.weeklyHours;
  if (weekly && Object.keys(weekly).length > 0) {
    const today = weekly[DAY_KEYS[new Date().getDay()]];
    return today ? `Open today: ${today.open}–${today.close}` : 'Closed today';
  }
  if (restaurant.openTime && restaurant.closeTime) return `Open daily: ${restaurant.openTime}–${restaurant.closeTime}`;
  return 'Open all day';
}

export default function MenuScreen({ restaurant, onBack, onCheckout, initialCart }) {
  const [items, setItems] = useState([]);
  // lineKey -> { menuItemId, quantity, selectedOptionIds }. lineKey is the plain menuItemId
  // for a dish with no variant groups (unchanged from before), or `${menuItemId}::${sorted
  // option ids}` for a specific variant combination — so "Litti Chokha, Large" and "Litti
  // Chokha, Small" are separate lines with independent quantities, while a dish with no
  // variants behaves exactly as it always has.
  const [cart, setCart] = useState({});
  const [pickerItem, setPickerItem] = useState(null); // menu item currently showing its variant picker
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dietFilter, setDietFilter] = useState('all'); // 'all' | 'veg' | 'nonveg'
  const [sortBy, setSortBy] = useState('relevance'); // 'relevance' | 'priceLow' | 'priceHigh'
  const [topPicksOnly, setTopPicksOnly] = useState(false);
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [showAllOffers, setShowAllOffers] = useState(false);
  const [showCategorySheet, setShowCategorySheet] = useState(false);
  const [expandedDescriptions, setExpandedDescriptions] = useState(new Set());
  const [expandedNutrition, setExpandedNutrition] = useState(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState(new Set());
  const [droppedFromReorder, setDroppedFromReorder] = useState(0);
  const [menuSearch, setMenuSearch] = useState('');
  const [reviews, setReviews] = useState([]);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [offers, setOffers] = useState([]);

  useEffect(() => {
    api.getRestaurantReviews(restaurant.id).then(setReviews).catch(() => {});
    api.getPublicOffers(restaurant.id).then(setOffers).catch(() => {});
    api
      .getMenuItems(restaurant.id)
      .then((fetched) => {
        setItems(fetched);
        // Seed the cart from a past order, but only for items that still exist, are
        // available, AND have no variant groups — a dish that now has required
        // customizations (or didn't before) can't be safely auto-filled, since we don't
        // know which size/spice-level the customer would pick today. Same "tell them why"
        // treatment as an unavailable item.
        if (initialCart) {
          const nextCart = {};
          let dropped = 0;
          for (const [menuItemId, qty] of Object.entries(initialCart)) {
            const stillExists = fetched.find((i) => i.id === menuItemId && i.isAvailable);
            if (stillExists && !(stillExists.variantGroups?.length > 0)) {
              nextCart[menuItemId] = { menuItemId, quantity: qty, selectedOptionIds: [] };
            } else {
              dropped += 1;
            }
          }
          setCart(nextCart);
          setDroppedFromReorder(dropped);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [restaurant.id]);

  function lineKeyFor(menuItemId, selectedOptionIds) {
    if (!selectedOptionIds || selectedOptionIds.length === 0) return menuItemId;
    return `${menuItemId}::${[...selectedOptionIds].sort().join(',')}`;
  }

  function changeQty(lineKey, delta, menuItemId, selectedOptionIds = []) {
    setCart((prev) => {
      const next = { ...prev };
      const existing = next[lineKey];
      const newQty = (existing?.quantity || 0) + delta;
      if (newQty <= 0) {
        delete next[lineKey];
      } else {
        next[lineKey] = { menuItemId, quantity: newQty, selectedOptionIds };
      }
      return next;
    });
  }

  // Called from the variant picker once the customer confirms their choices
  function addCartLine(menuItemId, selectedOptionIds) {
    const key = lineKeyFor(menuItemId, selectedOptionIds);
    changeQty(key, 1, menuItemId, selectedOptionIds);
    setPickerItem(null);
  }

  // Base price + every selected option's delta, for one unit of this line
  function lineUnitPrice(line) {
    const item = items.find((i) => i.id === line.menuItemId);
    if (!item) return 0;
    let price = Number(item.price);
    for (const optId of line.selectedOptionIds || []) {
      for (const group of item.variantGroups || []) {
        const opt = group.options.find((o) => o.id === optId);
        if (opt) price += Number(opt.priceDelta);
      }
    }
    return price;
  }

  function lineLabel(line) {
    const item = items.find((i) => i.id === line.menuItemId);
    const labels = [];
    for (const optId of line.selectedOptionIds || []) {
      for (const group of item?.variantGroups || []) {
        const opt = group.options.find((o) => o.id === optId);
        if (opt) labels.push(opt.label);
      }
    }
    return labels.join(', ');
  }

  const cartLines = Object.entries(cart).map(([lineKey, line]) => ({ lineKey, ...line }));
  const cartCount = cartLines.reduce((a, l) => a + l.quantity, 0);
  const cartTotal = cartLines.reduce((sum, l) => sum + lineUnitPrice(l) * l.quantity, 0);

  const CATEGORY_LABELS = { breakfast: 'Breakfast', starter: 'Starters', lunch: 'Lunch', dinner: 'Dinner', main: 'Mains', dessert: 'Desserts', beverage: 'Beverages' };
  const CATEGORY_ORDER = ['breakfast', 'starter', 'lunch', 'dinner', 'main', 'dessert', 'beverage'];
  const searched = menuSearch
    ? items.filter(
        (item) =>
          item.name.toLowerCase().includes(menuSearch.toLowerCase()) ||
          (item.description || '').toLowerCase().includes(menuSearch.toLowerCase()),
      )
    : items;
  const dietFiltered =
    dietFilter === 'veg'
      ? searched.filter((item) => item.isVeg)
      : dietFilter === 'nonveg'
        ? searched.filter((item) => !item.isVeg)
        : searched;
  // "Top picks" = the same bestseller flag the item cards badge, i.e. Swiggy's "Highly reordered"
  const visibleItems = topPicksOnly ? dietFiltered.filter((item) => item.isBestseller) : dietFiltered;

  function sortItems(arr) {
    if (sortBy === 'priceLow') return [...arr].sort((a, b) => Number(a.price) - Number(b.price));
    if (sortBy === 'priceHigh') return [...arr].sort((a, b) => Number(b.price) - Number(a.price));
    return arr;
  }
  const groupedItems = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    items: sortItems(visibleItems.filter((item) => item.category === cat)),
  })).filter((group) => group.items.length > 0);

  const activeFilterCount = (dietFilter !== 'all' ? 1 : 0) + (sortBy !== 'relevance' ? 1 : 0) + (topPicksOnly ? 1 : 0);
  function clearAllFilters() {
    setDietFilter('all');
    setSortBy('relevance');
    setTopPicksOnly(false);
  }

  function toggleDescription(itemId) {
    setExpandedDescriptions((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function toggleNutrition(itemId) {
    setExpandedNutrition((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  // Same 4/4/9 formula as the restaurant dashboard's NutritionEditor — kept in sync by
  // comment rather than a shared import, since these are two separate frontend projects.
  function calculateCalories(protein, carbs, fat) {
    return Math.round((Number(protein) || 0) * 4 + (Number(carbs) || 0) * 4 + (Number(fat) || 0) * 9);
  }

  function toggleCategory(category) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function goToCheckout() {
    const orderItems = cartLines.map((l) => ({
      menuItemId: l.menuItemId,
      quantity: l.quantity,
      ...(l.selectedOptionIds?.length ? { selectedOptionIds: l.selectedOptionIds } : {}),
    }));
    onCheckout(restaurant, orderItems, items);
  }

  function offerLabel(o) {
    if (o.discountType === 'free_delivery') return 'Free delivery';
    if (o.discountType === 'percentage') {
      return `${Number(o.discountValue)}% OFF${o.maxDiscountAmount ? ` up to ₹${Number(o.maxDiscountAmount).toFixed(0)}` : ''}`;
    }
    return `₹${Number(o.discountValue).toFixed(0)} OFF`;
  }

  function scrollToCategory(category) {
    setShowCategorySheet(false);
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      next.delete(category); // make sure the section is expanded before we jump to it
      return next;
    });
    // let the section expand first, then scroll it into view
    setTimeout(() => {
      document.getElementById(`cat-${category}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  const prep = restaurant.avgPrepTimeMins || 30;
  const distanceKm = restaurant.distanceMeters != null ? (restaurant.distanceMeters / 1000).toFixed(1) : null;
  const rating = Number(restaurant.ratingAvg || 0);
  const ratingCountLabel =
    restaurant.ratingCount >= 1000 ? `${(restaurant.ratingCount / 1000).toFixed(1)}K` : `${restaurant.ratingCount || 0}`;

  return (
    <div className="screen">
      {/* Icon-only back affordance (Swiggy-style), but the accessible name stays "← Back"
          so screen readers — and the cross-app e2e navigation locators — keep working. */}
      <button className="menu-back" aria-label="← Back" onClick={onBack}>←</button>

      <div className="menu-header">
        <div className="menu-header__top">
          <h1 className="menu-header__name">
            {restaurant.name}
            {restaurant.isVegOnly && <span className="veg-badge" style={{ marginLeft: 10, verticalAlign: 'middle' }}>🌱 Pure Veg</span>}
          </h1>
          {rating > 0 && (
            <div className="menu-rating">
              <span className="menu-rating__badge">{rating.toFixed(1)} ★</span>
              <span className="menu-rating__count">{ratingCountLabel} ratings</span>
            </div>
          )}
        </div>
        <p className="menu-header__meta">
          {distanceKm && <>📍 {distanceKm} km · </>}
          {restaurant.cuisineType}
          <br />
          <span className="sub">🛵 {prep}–{prep + 5} mins · {todayHoursLabel(restaurant)}</span>
        </p>

        {offers.length > 0 && (
          <div className="menu-offers">
            <button className="menu-offers__head" onClick={() => setShowAllOffers((v) => !v)}>
              <span className="menu-offers__icon">🏷️</span>
              <span className="menu-offers__title">{offerLabel(offers[0])}{offers[0].hasCode ? ' with code' : ''}</span>
              <span className="menu-offers__count">{offers.length} offer{offers.length > 1 ? 's' : ''} {showAllOffers ? '▴' : '▾'}</span>
            </button>
            {showAllOffers && (
              <div className="menu-offers__list">
                {offers.map((o) => (
                  <div key={o.id} className="menu-offer-row">
                    <span className="code">{o.discountType === 'free_delivery' ? '🛵' : '🎉'}</span>
                    <span>
                      {offerLabel(o)}{o.hasCode ? ' with code' : ''}
                      {o.minOrderValue ? ` · above ₹${Number(o.minOrderValue).toFixed(0)}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="menu-controls">
        <input
          placeholder={`Search in ${restaurant.name}…`}
          value={menuSearch}
          onChange={(e) => setMenuSearch(e.target.value)}
          style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', marginBottom: 10 }}
        />
        <div className="diet-chips">
          <button
            className={`filters-btn ${activeFilterCount > 0 ? 'has-active' : ''}`}
            onClick={() => setShowFilterSheet(true)}
          >
            ⚙️ Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
          {[
            { key: 'all', label: 'All' },
            { key: 'veg', label: 'Veg', cls: 'veg', mark: true },
            { key: 'nonveg', label: 'Non-veg', cls: 'nonveg', mark: true },
          ].map((c) => (
            <button
              key={c.key}
              className={`diet-chip ${c.cls || ''} ${dietFilter === c.key ? 'active' : ''}`}
              aria-pressed={dietFilter === c.key}
              onClick={() => setDietFilter(c.key)}
            >
              {c.mark && <span className="mark" />}
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {droppedFromReorder > 0 && (
        <div className="error-banner" style={{ background: '#fff2d6', borderColor: 'var(--turmeric)', color: '#8a5a00' }}>
          {droppedFromReorder} item{droppedFromReorder === 1 ? ' from your previous order is' : 's from your previous order are'} no
          longer available — the rest {droppedFromReorder === 1 ? 'is' : 'are'} in your cart.
        </div>
      )}
      {loading && (
        <div aria-label="Loading menu">
          {[0, 1, 2, 3].map((i) => (
            <div className="skeleton-menu-item" key={i}>
              <div style={{ flex: 1 }}>
                <div className="skeleton-block" style={{ height: 15, width: '70%', marginBottom: 10 }} />
                <div className="skeleton-block" style={{ height: 12, width: '35%', marginBottom: 10 }} />
                <div className="skeleton-block" style={{ height: 11, width: '90%' }} />
              </div>
              <div className="skeleton-block" style={{ width: 84, height: 84, borderRadius: 10, flexShrink: 0 }} />
            </div>
          ))}
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <div className="card" style={{ textAlign: 'center', marginTop: 16 }}>
          <p style={{ margin: 0 }}>No items on the menu yet.</p>
          <p className="muted" style={{ color: '#6b6156', marginTop: 4 }}>Check back once the restaurant adds its menu.</p>
        </div>
      )}
      {!loading && !error && items.length > 0 && visibleItems.length === 0 && !menuSearch && (
        <div className="card" style={{ textAlign: 'center', marginTop: 16 }}>
          <p style={{ margin: 0 }}>No {dietFilter === 'veg' ? 'veg' : 'non-veg'} items on this menu.</p>
        </div>
      )}

      {groupedItems.map((group) => {
        const isCollapsed = collapsedCategories.has(group.category);
        return (
        <div key={group.category} id={`cat-${group.category}`} className="menu-cat">
          <button className="menu-cat__head" onClick={() => toggleCategory(group.category)}>
            {CATEGORY_LABELS[group.category]} <span className="count">({group.items.length})</span>
            <span className={`chev ${isCollapsed ? 'collapsed' : ''}`}>▾</span>
          </button>
          {!isCollapsed && (
          <div className="stack">
            {group.items.map((item) => {
              const hasDiscount = item.originalPrice && Number(item.originalPrice) > Number(item.price);
              const isLongDescription = item.description && item.description.length > 80;
              const isExpanded = expandedDescriptions.has(item.id);
              const shownDescription = isLongDescription && !isExpanded
                ? item.description.slice(0, 80) + '…'
                : item.description;
              return (
              <div key={item.id} className="card">
                <div className="menu-item">
                  <div className="menu-item__info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className={item.isVeg ? 'veg-mark' : 'nonveg-mark'} title={item.isVeg ? 'Veg' : 'Non-veg'} />
                      {item.isBestseller && <span className="menu-item__badge">⭐ Bestseller</span>}
                    </div>
                    <h3 className="menu-item__name">{item.name}</h3>
                    <p className="menu-item__price">
                      {hasDiscount && <span className="was">₹{Number(item.originalPrice).toFixed(0)}</span>}
                      ₹{Number(item.price).toFixed(0)}
                    </p>
                    {item.description && (
                      <p className="menu-item__desc">
                        {shownDescription}
                        {isLongDescription && (
                          <span className="more" onClick={() => toggleDescription(item.id)}>
                            {isExpanded ? ' less' : ' more'}
                          </span>
                        )}
                      </p>
                    )}
                    {item.weightGrams != null && (
                      <div style={{ marginTop: 4 }}>
                        <span
                          onClick={() => toggleNutrition(item.id)}
                          style={{ color: 'var(--chili-dark)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                        >
                          🥗 {calculateCalories(item.proteinGrams, item.carbsGrams, item.fatGrams)} kcal · {item.weightGrams}g
                          {expandedNutrition.has(item.id) ? ' (hide)' : ' (details)'}
                        </span>
                        {expandedNutrition.has(item.id) && (
                          <p className="muted" style={{ fontSize: 12, margin: '2px 0 0' }}>
                            {item.proteinGrams != null && <>Protein {item.proteinGrams}g · </>}
                            {item.carbsGrams != null && <>Carbs {item.carbsGrams}g · </>}
                            {item.fatGrams != null && <>Fat {item.fatGrams}g</>}
                            {item.fibreGrams != null && <> · Fibre {item.fibreGrams}g</>}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="menu-item__media">
                    {item.imageUrl ? (
                      <img className="menu-item__img" src={item.imageUrl} alt={item.name} />
                    ) : (
                      <div className="menu-item__img menu-item__img--placeholder">🍽️</div>
                    )}
                    <div className="menu-item__action">
                      {!item.isAvailable ? (
                        <div className="menu-item__soldout">Sold out</div>
                      ) : item.variantGroups?.length > 0 ? (
                        <button className="menu-item__add" onClick={() => setPickerItem(item)}>ADD +</button>
                      ) : cart[item.id] ? (
                        <div className="menu-item__stepper">
                          <button aria-label="Decrease quantity" onClick={() => changeQty(item.id, -1, item.id, [])}>−</button>
                          <span>{cart[item.id].quantity}</span>
                          <button aria-label="Increase quantity" onClick={() => changeQty(item.id, 1, item.id, [])}>+</button>
                        </div>
                      ) : (
                        <button className="menu-item__add" onClick={() => changeQty(item.id, 1, item.id, [])}>ADD +</button>
                      )}
                    </div>
                    {item.variantGroups?.length > 0 && <div className="menu-item__custom">customisable</div>}
                  </div>
                </div>

                {/* Lines already in the cart for this specific dish — each variant
                    combination gets its own row with an independent quantity stepper */}
                {cartLines
                  .filter((l) => l.menuItemId === item.id && l.selectedOptionIds?.length > 0)
                  .map((line) => (
                    <div key={line.lineKey} className="row" style={{ marginTop: 6, paddingLeft: 12, fontSize: 13 }}>
                      <span className="muted">{lineLabel(line)} · ₹{lineUnitPrice(line).toFixed(0)}</span>
                      <div className="qty-control">
                        <button onClick={() => changeQty(line.lineKey, -1, line.menuItemId, line.selectedOptionIds)}>−</button>
                        <span style={{ minWidth: 16, textAlign: 'center' }}>{line.quantity}</span>
                        <button onClick={() => changeQty(line.lineKey, 1, line.menuItemId, line.selectedOptionIds)}>+</button>
                      </div>
                    </div>
                  ))}
              </div>
              );
            })}
          </div>
          )}
        </div>
        );
      })}

      {menuSearch && visibleItems.length === 0 && (
        <p className="muted" style={{ textAlign: 'center' }}>Nothing on the menu matches “{menuSearch}”</p>
      )}

      {reviews.length > 0 && (
        <div id="menu-reviews" className="card" style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 16, margin: '0 0 8px' }}>Reviews ({reviews.length})</h3>
          {[5, 4, 3, 2, 1].map((star) => {
            const count = reviews.filter((r) => r.restaurantRating === star).length;
            return (
              <div key={star} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 2 }}>
                <span style={{ width: 24 }} className="muted">{star}★</span>
                <div style={{ flex: 1, height: 6, background: '#eee4d4', borderRadius: 3 }}>
                  <div style={{ width: `${(count / reviews.length) * 100}%`, height: 6, background: 'var(--turmeric, #d9930d)', borderRadius: 3 }} />
                </div>
                <span style={{ width: 20, textAlign: 'right' }} className="muted">{count}</span>
              </div>
            );
          })}
          <div style={{ marginTop: 10 }}>
            {(showAllReviews ? reviews : reviews.filter((r) => r.comment).slice(0, 3)).map((r) => (
              <div key={r.id} style={{ borderTop: '1px solid #eee4d4', paddingTop: 8, marginTop: 8, fontSize: 14 }}>
                <p style={{ margin: 0 }}>
                  <strong>{r.customerName}</strong>{' '}
                  <span style={{ color: 'var(--turmeric, #d9930d)' }}>{'★'.repeat(r.restaurantRating)}</span>
                  <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>
                    {new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                </p>
                {r.comment && <p style={{ margin: '2px 0 0' }}>{r.comment}</p>}
                {r.replyText && (
                  <div style={{ marginTop: 6, marginLeft: 12, paddingLeft: 10, borderLeft: '2px solid var(--turmeric, #d9930d)' }}>
                    <p className="muted" style={{ margin: 0, fontSize: 12, fontWeight: 600 }}>Reply from the restaurant</p>
                    <p style={{ margin: '2px 0 0', fontSize: 13 }}>{r.replyText}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
          {reviews.length > 3 && (
            <button className="btn-secondary" style={{ marginTop: 10 }} onClick={() => setShowAllReviews(!showAllReviews)}>
              {showAllReviews ? 'Show fewer' : `Show all ${reviews.length} reviews`}
            </button>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: 14, marginBottom: cartCount > 0 ? 80 : 20, fontSize: 13 }}>
        <p style={{ fontWeight: 700, margin: '0 0 4px' }}>{restaurant.name}</p>
        <p className="muted" style={{ margin: '0 0 2px' }}>{restaurant.address}</p>
        <p className="muted" style={{ margin: '0 0 2px' }}>{todayHoursLabel(restaurant)}</p>
        {restaurant.fssaiNumber && (
          <p className="muted" style={{ margin: restaurant.minOrderValue ? '0 0 2px' : 0 }}>FSSAI Lic. No. {restaurant.fssaiNumber}</p>
        )}
        {restaurant.minOrderValue && (
          <p className="muted" style={{ margin: 0 }}>Minimum order: ₹{restaurant.minOrderValue}</p>
        )}
      </div>

      {cartCount > 0 && (
        <div style={{ position: 'fixed', bottom: 20, left: 20, right: 20, maxWidth: 440, margin: '0 auto' }}>
          {restaurant.minOrderValue && cartTotal < restaurant.minOrderValue ? (
            <div className="btn-primary" style={{ textAlign: 'center', opacity: 0.7, cursor: 'default' }}>
              Add ₹{(restaurant.minOrderValue - cartTotal).toFixed(0)} more to reach the ₹{restaurant.minOrderValue} minimum
            </div>
          ) : (
            <button className="btn-primary" onClick={goToCheckout}>
              View cart · {cartCount} item{cartCount > 1 ? 's' : ''} · ₹{cartTotal.toFixed(0)}
            </button>
          )}
        </div>
      )}

      {groupedItems.length > 1 && !showCategorySheet && (
        <button className="menu-fab" onClick={() => setShowCategorySheet(true)}>
          🍽️ Menu
        </button>
      )}

      {showFilterSheet && (
        <div className="menu-sheet__backdrop" onClick={() => setShowFilterSheet(false)}>
          <div className="menu-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ padding: '14px 20px 4px' }}>
              <h3 style={{ fontSize: 18 }}>Filters and Sorting</h3>
              <button className="btn-ghost" style={{ fontSize: 18, color: 'var(--charcoal)' }} onClick={() => setShowFilterSheet(false)}>✕</button>
            </div>

            <div className="filter-section">
              <p className="filter-section__title">Sort by</p>
              <div className="filter-options">
                {[
                  { key: 'priceLow', label: 'Price — low to high' },
                  { key: 'priceHigh', label: 'Price — high to low' },
                ].map((s) => (
                  <button
                    key={s.key}
                    className={`filter-option ${sortBy === s.key ? 'active' : ''}`}
                    onClick={() => setSortBy(sortBy === s.key ? 'relevance' : s.key)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-section">
              <p className="filter-section__title">Veg / Non-veg preference</p>
              <div className="filter-options">
                {[
                  { key: 'veg', label: '🌱 Veg', cls: 'veg' },
                  { key: 'nonveg', label: '🔺 Non-veg', cls: 'nonveg' },
                ].map((d) => (
                  <button
                    key={d.key}
                    className={`filter-option ${d.cls} ${dietFilter === d.key ? 'active' : ''}`}
                    onClick={() => setDietFilter(dietFilter === d.key ? 'all' : d.key)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-section">
              <p className="filter-section__title">Top picks</p>
              <div className="filter-options">
                <button
                  className={`filter-option ${topPicksOnly ? 'active' : ''}`}
                  onClick={() => setTopPicksOnly((v) => !v)}
                >
                  🔁 Highly reordered
                </button>
              </div>
            </div>

            <div className="filter-actions">
              <button className="clear" onClick={clearAllFilters}>Clear All</button>
              <button className="apply" onClick={() => setShowFilterSheet(false)}>
                Apply{groupedItems.reduce((n, g) => n + g.items.length, 0) ? ` (${groupedItems.reduce((n, g) => n + g.items.length, 0)})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCategorySheet && (
        <div className="menu-sheet__backdrop" onClick={() => setShowCategorySheet(false)}>
          <div className="menu-sheet" onClick={(e) => e.stopPropagation()}>
            {groupedItems.map((g) => (
              <button key={g.category} className="menu-sheet__row" onClick={() => scrollToCategory(g.category)}>
                <span>{CATEGORY_LABELS[g.category]}</span>
                <span className="count">{g.items.length}</span>
              </button>
            ))}
            <button className="menu-sheet__close" onClick={() => setShowCategorySheet(false)}>✕ Close</button>
          </div>
        </div>
      )}

      {pickerItem && (
        <VariantPicker
          item={pickerItem}
          onCancel={() => setPickerItem(null)}
          onConfirm={(selectedOptionIds) => addCartLine(pickerItem.id, selectedOptionIds)}
        />
      )}
    </div>
  );
}
