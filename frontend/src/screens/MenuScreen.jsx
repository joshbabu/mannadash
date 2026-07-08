import { useEffect, useState } from 'react';
import { api } from '../api';

export default function MenuScreen({ restaurant, onBack, onCheckout, initialCart }) {
  const [items, setItems] = useState([]);
  const [cart, setCart] = useState({}); // menuItemId -> quantity
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [vegOnly, setVegOnly] = useState(false);
  const [expandedDescriptions, setExpandedDescriptions] = useState(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState(new Set());

  useEffect(() => {
    api
      .getMenuItems(restaurant.id)
      .then((fetched) => {
        setItems(fetched);
        // Seed the cart from a past order, but only for items that still exist and are available —
        // a restaurant may have removed or sold out an item since the original order
        if (initialCart) {
          const validCart = {};
          for (const [menuItemId, qty] of Object.entries(initialCart)) {
            const stillExists = fetched.find((i) => i.id === menuItemId && i.isAvailable);
            if (stillExists) validCart[menuItemId] = qty;
          }
          setCart(validCart);
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
  const visibleItems = vegOnly ? items.filter((item) => item.isVeg) : items;
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
                      <h3 style={{ fontSize: 16 }}>{item.name} {item.isVeg ? '🌱' : ''}</h3>
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

      {cartCount > 0 && (
        <div style={{ position: 'fixed', bottom: 20, left: 20, right: 20, maxWidth: 440, margin: '0 auto' }}>
          <button className="btn-primary" onClick={goToCheckout}>
            View cart · {cartCount} item{cartCount > 1 ? 's' : ''} · ₹{cartTotal.toFixed(0)}
          </button>
        </div>
      )}
    </div>
  );
}
