import { useState } from 'react';
import { api } from './api';
import LoginScreen from './screens/LoginScreen';
import DashboardScreen from './screens/DashboardScreen';

export default function App() {
  const [admin, setAdmin] = useState(api.getStoredAdmin());

  if (!admin) {
    return <LoginScreen onAuthed={setAdmin} />;
  }

  function logout() {
    // Same fix applied across all four apps: clearing only the token left the cached
    // admin object behind, so a refresh after logout re-hydrated from stale localStorage
    // with no valid token underneath.
    api.clearToken();
    api.clearStoredAdmin();
    setAdmin(null);
  }

  return <DashboardScreen onLogout={logout} />;
}
