import { useState } from 'react';
import { api } from './api';
import AuthScreen from './screens/AuthScreen';
import RestaurantListScreen from './screens/RestaurantListScreen';
import MenuScreen from './screens/MenuScreen';
import CheckoutScreen from './screens/CheckoutScreen';
import TrackOrderScreen from './screens/TrackOrderScreen';
import OrderHistoryScreen from './screens/OrderHistoryScreen';
import LegalScreen from './screens/LegalScreen';

export default function App() {
  const [user, setUser] = useState(api.getStoredUser());
  const [tab, setTab] = useState('browse'); // 'browse' | 'orders'
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);
  const [reorderCart, setReorderCart] = useState(null);
  const [pendingOrder, setPendingOrder] = useState(null); // { restaurant, orderItems, menuItems }
  const [trackingOrderId, setTrackingOrderId] = useState(null);
  const [legalDoc, setLegalDoc] = useState(null); // null | 'terms' | 'privacy'

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
  if (legalDoc) {
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

  const showBottomNav = !selectedRestaurant && !pendingOrder && !trackingOrderId && !legalDoc;

  return (
    <div className="app-shell">
      <div className="topbar">
        <span className="brand">MannaDash</span>
        <div className="row" style={{ gap: 8 }}>
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
            🍲 Browse
          </button>
          <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>
            📋 Orders
          </button>
        </div>
      )}
    </div>
  );
}
