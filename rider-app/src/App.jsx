import { useState } from 'react';
import { api } from './api';
import AuthScreen from './screens/AuthScreen';
import HomeScreen from './screens/HomeScreen';

export default function App() {
  const [rider, setRider] = useState(api.getStoredRider());

  if (!rider) {
    return <AuthScreen onAuthed={setRider} />;
  }

  function logout() {
    // Both keys must go — clearing only the token left the cached rider object behind,
    // so a page refresh after logout re-hydrated the dashboard from stale localStorage
    // with no valid token underneath: "You're online" (fake, from cache) alongside a real
    // "Unauthorized" banner from every API call failing. In-memory setRider(null) alone
    // masked this within the same tab session; only a refresh exposed the stale cache.
    api.clearToken();
    api.clearStoredRider();
    setRider(null);
  }

  return <HomeScreen rider={rider} onLogout={logout} />;
}
