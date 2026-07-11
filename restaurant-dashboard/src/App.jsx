import { useEffect, useState } from 'react';
import { api } from './api';
import AuthScreen from './screens/AuthScreen';
import MenuScreen from './screens/MenuScreen';
import OrdersScreen from './screens/OrdersScreen';
import OrderHistoryScreen from './screens/OrderHistoryScreen';
import SettingsScreen from './screens/SettingsScreen';
import InsightsScreen from './screens/InsightsScreen';
import ReviewsScreen from './screens/ReviewsScreen';
import OffersScreen from './screens/OffersScreen';

export default function App() {
  const [restaurant, setRestaurant] = useState(api.getStoredRestaurant());
  const [tab, setTab] = useState('orders');
  const [freshStatus, setFreshStatus] = useState(null);

  useEffect(() => {
    if (restaurant) {
      api.getRestaurant(restaurant.id).then(setFreshStatus).catch(() => {});
    }
  }, [restaurant]);

  if (!restaurant) {
    return (
      <div>
        <AuthScreen onAuthed={setRestaurant} />
      </div>
    );
  }

  function logout() {
    // Same fix as the rider app: clearing only the token left the cached restaurant
    // object behind, so a refresh after logout re-hydrated from stale localStorage
    // with no valid token underneath.
    api.clearToken();
    api.clearStoredRestaurant();
    setRestaurant(null);
    setFreshStatus(null);
  }

  const status = freshStatus?.status || restaurant.status;

  return (
    <div className="app-shell">
      <div className="topbar">
        <span className="brand">MannaDash for Restaurants</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="muted">{restaurant.name}</span>
          {freshStatus?.ratingAvg > 0 && (
            <span className="pill">★ {Number(freshStatus.ratingAvg).toFixed(1)} ({freshStatus.ratingCount})</span>
          )}
          <button className="btn-secondary" onClick={logout}>Log out</button>
        </div>
      </div>

      {status === 'pending' && (
        <div className="error-banner" style={{ background: '#fff2d6', borderColor: 'var(--turmeric)', color: '#8a5a00' }}>
          <strong>Awaiting approval.</strong> Your restaurant won't appear to customers until an admin approves it.
        </div>
      )}

      {status === 'suspended' && (
        <div className="error-banner">Your restaurant is currently suspended and won't receive orders.</div>
      )}

      <div className="tabs">
        <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>Orders</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>Order History</button>
        <button className={tab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}>Menu</button>
        <button className={tab === 'insights' ? 'active' : ''} onClick={() => setTab('insights')}>Insights</button>
        <button className={tab === 'reviews' ? 'active' : ''} onClick={() => setTab('reviews')}>Reviews</button>
        <button className={tab === 'offers' ? 'active' : ''} onClick={() => setTab('offers')}>Offers</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>Settings</button>
      </div>

      {tab === 'orders' && <OrdersScreen restaurant={restaurant} />}
      {tab === 'history' && <OrderHistoryScreen />}
      {tab === 'menu' && <MenuScreen restaurant={restaurant} />}
      {tab === 'insights' && <InsightsScreen />}
      {tab === 'reviews' && <ReviewsScreen restaurant={restaurant} />}
      {tab === 'offers' && <OffersScreen restaurant={restaurant} />}
      {tab === 'settings' && <SettingsScreen restaurant={restaurant} />}
    </div>
  );
}
