import { useEffect, useState } from 'react';
import { api } from '../api';

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
  const [cart, setCart] = useState({}); // menuItemId -> quantity
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [vegOnly, setVegOnly] = useState(false);
  const [expandedDescriptions, setExpandedDescriptions] = useState(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState(new Set());
  const [droppedFromReorder, setDroppedFromReorder] = useState(0);
  const [menuSearch, setMenuSearch] = useState('');
  const [reviews, setReviews] = useState([]);
  const [showAllReviews, setShowAllReviews] = useState(false);

  useEffect(() => {
    api.getRestaurantReviews(restaurant.id).then(setReviews).catch(() => {});
    api
      .getMenuItems(restaurant.id)
      .then((fetched) => {
        setItems(fetched);
        // Seed the cart from a past order, but only for items that still exist and are available —
        // a restaurant may have removed or sold out an item since the original order
        if (initialCart) {
          const validCart = {};
          let dropped = 0;
          for (const [menuItemId, qty] of Object.entries(initialCart)) {
            const stillExists = fetched.find((i) => i.id === menuItemId && i.isAvailable);
            if (stillExists) validCart[menuItemId] = qty;
            else dropped += 1; // removed from the menu or sold out since the original order
          }
          setCart(validCart);
          // Correct-but-silent is confusing: tell the customer WHY their cart is smaller
          setDroppedFromReorder(dropped);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [restaurant.id]);

  function changeQty(itemId, delta) {
    setCart((prev) => {
      const next = { ...prev };
      const newQty = (next[itemId] || 0) + delta;
      if (newQty <= 0) delete next[itemId];
      else next[itemId] = newQty;
      return next;
    });
  }

  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const cartTotal = items.reduce((sum, item) => sum + (cart[item.id] || 0) * Number(item.price), 0);

  const CATEGORY_LABELS = { breakfast: 'Breakfast', starter: 'Starters', lunch: 'Lunch', dinner: 'Dinner', main: 'Mains', dessert: 'Desserts', beverage: 'Beverages' };
  const CATEGORY_ORDER = ['breakfast', 'starter', 'lunch', 'dinner', 'main', 'dessert', 'beverage'];
  const searched = menuSearch
    ? items.filter(
        (item) =>
          item.name.toLowerCase().includes(menuSearch.toLowerCase()) ||
          (item.description || '').toLowerCase().includes(menuSearch.toLowerCase()),
      )
    : items;
  const visibleItems = vegOnly ? searched.filter((item) => item.isVeg) : searched;
  const groupedItems = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    items: visibleItems.filter((item) => item.category === cat),
  })).filter((group) => group.items.length > 0);

  function toggleDescription(itemId) {
    setExpandedDescriptions((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
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
    const orderItems = Object.entries(cart).map(([menuItemId, quantity]) => ({ menuItemId, quantity }));
    onCheckout(restaurant, orderItems, items);
  }

  return (
    <div className="screen">
      <button className="btn-secondary" onClick={onBack} style={{ marginTop: 12, marginBottom: 12 }}>
        ← Back
      </button>
      <h1 style={{ fontSize: 24 }}>{restaurant.name}</h1>
      <p className="muted">
        {Number(restaurant.ratingAvg) > 0 && <>★ {Number(restaurant.ratingAvg).toFixed(1)} ({restaurant.ratingCount}) · </>}
        {restaurant.cuisineType}
      </p>

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 4, fontSize: 14 }}>
        <input type="checkbox" checked={vegOnly} onChange={(e) => setVegOnly(e.target.checked)} />
        🌱 Veg only
      </label>

      {error && <div className="error-banner">{error}</div>}
      <input
        placeholder={`Search in ${restaurant.name}…`}
        value={menuSearch}
        onChange={(e) => setMenuSearch(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      {droppedFromReorder > 0 && (
        <div className="error-banner" style={{ background: '#fff2d6', borderColor: 'var(--turmeric)', color: '#8a5a00' }}>
          {droppedFromReorder} item{droppedFromReorder === 1 ? ' from your previous order is' : 's from your previous order are'} no
          longer available — the rest {droppedFromReorder === 1 ? 'is' : 'are'} in your cart.
        </div>
      )}
      {loading && <p className="muted">Loading menu…</p>}
      {!loading && !error && items.length === 0 && (
        <div className="card" style={{ textAlign: 'center', marginTop: 16 }}>
          <p style={{ margin: 0 }}>No items on the menu yet.</p>
          <p className="muted" style={{ color: '#6b6156', marginTop: 4 }}>Check back once the restaurant adds its menu.</p>
        </div>
      )}
      {!loading && !error && items.length > 0 && visibleItems.length === 0 && (
        <div className="card" style={{ textAlign: 'center', marginTop: 16 }}>
          <p style={{ margin: 0 }}>No veg items on this menu.</p>
        </div>
      )}

      {groupedItems.map((group) => {
        const isCollapsed = collapsedCategories.has(group.category);
        return (
        <div key={group.category} style={{ marginTop: 20 }}>
          <h2
            style={{ fontSize: 18, color: 'var(--turmeric)', marginBottom: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            onClick={() => toggleCategory(group.category)}
          >
            {CATEGORY_LABELS[group.category]} ({group.items.length})
            <span style={{ fontSize: 14, transform: isCollapsed ? 'rotate(-90deg)' : 'none', display: 'inline-block' }}>▾</span>
          </h2>
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
                <div className="row">
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover' }} />
                    ) : (
                      <div style={{ width: 56, height: 56, borderRadius: 10, background: 'var(--paper-dim, #f3ecdc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🍽️</div>
                    )}
                    <div>
                      {item.isBestseller && (
                        <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 600, color: 'var(--chili-dark)', background: '#fdeee8', borderRadius: 4, padding: '1px 6px', marginBottom: 3 }}>
                          ⭐ Bestseller
                        </span>
                      )}
                      <h3 style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span
                          title={item.isVeg ? 'Veg' : 'Non-veg'}
                          style={{
                            width: 14, height: 14, border: `2px solid ${item.isVeg ? '#1b8a3a' : '#8a2a1b'}`,
                            borderRadius: 3, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.isVeg ? '#1b8a3a' : '#8a2a1b' }} />
                        </span>
                        {item.name}
                      </h3>
                      {item.description && (
                        <p className="muted" style={{ color: '#8a8378', fontSize: 13, margin: '2px 0' }}>
                          {shownDescription}
                          {isLongDescription && (
                            <span
                              onClick={() => toggleDescription(item.id)}
                              style={{ color: 'var(--chili-dark)', cursor: 'pointer', fontWeight: 600, marginLeft: 4 }}
                            >
                              {isExpanded ? 'less' : 'more'}
                            </span>
                          )}
                        </p>
                      )}
                      {hasDiscount ? (
                        <p className="muted" style={{ margin: 0 }}>
                          <span style={{ textDecoration: 'line-through', color: '#a89e8f', marginRight: 6 }}>₹{Number(item.originalPrice).toFixed(0)}</span>
                          <span style={{ background: '#fff3c4', color: '#6b5400', fontWeight: 600, padding: '1px 6px', borderRadius: 4 }}>₹{Number(item.price).toFixed(0)}</span>
                        </p>
                      ) : (
                        <p className="muted" style={{ color: '#6b6156' }}>₹{Number(item.price).toFixed(0)}</p>
                      )}
                    </div>
                  </div>
                  {!item.isAvailable ? (
                    <span className="muted" style={{ color: '#8a8378' }}>Sold out</span>
                  ) : cart[item.id] ? (
                    <div className="qty-control">
                      <button onClick={() => changeQty(item.id, -1)}>−</button>
                      <span style={{ minWidth: 16, textAlign: 'center' }}>{cart[item.id]}</span>
                      <button onClick={() => changeQty(item.id, 1)}>+</button>
                    </div>
                  ) : (
                    <button className="btn-secondary" style={{ color: 'var(--chili-dark)', borderColor: 'var(--chili)' }} onClick={() => changeQty(item.id, 1)}>
                      Add
                    </button>
                  )}
                </div>
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
        <div className="card" style={{ marginTop: 20 }}>
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
    </div>
  );
}
