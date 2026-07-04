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
    api.clearToken();
    setAdmin(null);
  }

  return <DashboardScreen onLogout={logout} />;
}
