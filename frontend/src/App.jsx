import { useState } from 'react';
import { api } from './api';
import AuthScreen from './screens/AuthScreen';
import RestaurantListScreen from './screens/RestaurantListScreen';
import MenuScreen from './screens/MenuScreen';
import CheckoutScreen from './screens/CheckoutScreen';
import TrackOrderScreen from './screens/TrackOrderScreen';
import OrderHistoryScreen from './screens/OrderHistoryScreen';
import LegalScreen from './screens/LegalScreen';
import MyAccountScreen from './screens/MyAccountScreen';
import FavoritesScreen from './screens/FavoritesScreen';
import AccountStatementScreen from './screens/AccountStatementScreen';

export default function App() {
  const [user, setUser] = useState(api.getStoredUser());
  const [tab, setTab] = useState('browse'); // 'browse' | 'orders'
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);
  const [reorderCart, setReorderCart] = useState(null);
  const [pendingOrder, setPendingOrder] = useState(null); // { restaurant, orderItems, menuItems }
  const [trackingOrderId, setTrackingOrderId] = useState(null);
  const [legalDoc, setLegalDoc] = useState(null); // null | 'terms' | 'privacy'
  const [showMyAccount, setShowMyAccount] = useState(false);
  const [showFavorites, setShowFavorites] = useState(false);
  const [showStatement, setShowStatement] = useState(false);

  if (!user) {
    return (
      <div className="app-shell">
        <AuthScreen onAuthed={setUser} />
      </div>
    );
  }

  function logout() {
    // Same fix as the rider app: clearing only the token left the cached user behind,
    // so a refresh after logout re-hydrated from stale localStorage with no valid token.
    api.clearToken();
    api.clearStoredUser();
    setUser(null);
  }

  function handleCheckout(restaurant, orderItems, menuItems) {
    setPendingOrder({ restaurant, orderItems, menuItems });
  }

  function handleReorder(order) {
    const cart = {};
    for (const line of order.items) {
      cart[line.menuItem.id] = line.quantity;
    }
    setReorderCart(cart);
    setSelectedRestaurant(order.restaurant);
  }

  function handleOrderPlaced(order) {
    setPendingOrder(null);
    setSelectedRestaurant(null);
    setTrackingOrderId(order.id);
  }

  function handlePayNow(order) {
    api
      .createPayment(order.id)
      .then(() => alert('Payment created — real checkout requires Razorpay keys to be configured.'))
      .catch((err) => alert(err.message));
  }

  let content;
  if (showMyAccount) {
    content = (
      <MyAccountScreen
        onBack={() => setShowMyAccount(false)}
        onViewOrders={() => { setShowMyAccount(false); setTab('orders'); }}
        onViewLegal={() => { setShowMyAccount(false); setLegalDoc('terms'); }}
        onViewFavorites={() => { setShowMyAccount(false); setShowFavorites(true); }}
        onViewStatement={() => { setShowMyAccount(false); setShowStatement(true); }}
        onLogout={logout}
      />
    );
  } else if (showFavorites) {
    content = (
      <FavoritesScreen
        onBack={() => { setShowFavorites(false); setShowMyAccount(true); }}
        onSelectRestaurant={(restaurant) => { setShowFavorites(false); setSelectedRestaurant(restaurant); }}
      />
    );
  } else if (showStatement) {
    content = <AccountStatementScreen onBack={() => { setShowStatement(false); setShowMyAccount(true); }} />;
  } else if (legalDoc) {
    content = <LegalScreen initialDoc={legalDoc} onBack={() => setLegalDoc(null)} />;
  } else if (trackingOrderId) {
    content = (
      <TrackOrderScreen
        orderId={trackingOrderId}
        onBack={() => setTrackingOrderId(null)}
        onPayNow={handlePayNow}
      />
    );
  } else if (pendingOrder) {
    content = (
      <CheckoutScreen
        restaurant={pendingOrder.restaurant}
        orderItems={pendingOrder.orderItems}
        menuItems={pendingOrder.menuItems}
        onBack={() => setPendingOrder(null)}
        onOrderPlaced={handleOrderPlaced}
      />
    );
  } else if (selectedRestaurant) {
    content = (
      <MenuScreen
        restaurant={selectedRestaurant}
        onBack={() => { setSelectedRestaurant(null); setReorderCart(null); }}
        onCheckout={handleCheckout}
        initialCart={reorderCart}
      />
    );
  } else if (tab === 'orders') {
    content = (
      <OrderHistoryScreen
        onSelectOrder={setTrackingOrderId}
        onReorder={handleReorder}
        onViewRestaurant={(restaurant) => {
          setReorderCart(null); // browsing fresh — no pre-filled cart
          setSelectedRestaurant(restaurant);
        }}
      />
    );
  } else {
    content = <RestaurantListScreen onSelectRestaurant={setSelectedRestaurant} />;
  }

  const showBottomNav = !selectedRestaurant && !pendingOrder && !trackingOrderId && !legalDoc && !showMyAccount && !showFavorites && !showStatement;

  return (
    <div className="app-shell">
      <div className="topbar">
        <span className="brand">MannaDash</span>
        <div className="row" style={{ gap: 8 }}>
          <button
            onClick={() => setShowMyAccount(true)}
            aria-label="My account"
            style={{
              width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-gradient)',
              color: '#fff', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 800, cursor: 'pointer',
            }}
          >
            {(user?.name || '?').trim().charAt(0).toUpperCase()}
          </button>
          <button className="btn-secondary" onClick={() => setLegalDoc('terms')} style={{ fontSize: 12, padding: '6px 10px' }}>
            Legal
          </button>
          <button className="btn-secondary" onClick={logout} style={{ fontSize: 12, padding: '6px 10px' }}>
            Log out
          </button>
        </div>
      </div>

      {content}

      {showBottomNav && (
        <div className="bottom-nav">
          <button className={tab === 'browse' ? 'active' : ''} onClick={() => setTab('browse')}>
            🏠 Home
          </button>
          <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>
            📋 Orders
          </button>
        </div>
      )}
    </div>
  );
}
