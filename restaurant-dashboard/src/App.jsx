import { useEffect, useState } from 'react';
import { api } from './api';
import AuthScreen from './screens/AuthScreen';
import MenuScreen from './screens/MenuScreen';
import OrdersScreen from './screens/OrdersScreen';
import InsightsScreen from './screens/InsightsScreen';

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
    api.clearToken();
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
            <span className="pill">★ {Number(freshStatus.ratingAvg).toFixed(1)}</span>
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
        <button className={tab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}>Menu</button>
        <button className={tab === 'insights' ? 'active' : ''} onClick={() => setTab('insights')}>Insights</button>
      </div>

      {tab === 'orders' && <OrdersScreen restaurant={restaurant} />}
      {tab === 'menu' && <MenuScreen restaurant={restaurant} />}
      {tab === 'insights' && <InsightsScreen />}
    </div>
  );
}
