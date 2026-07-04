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
    api.clearToken();
    setRider(null);
  }

  return <HomeScreen rider={rider} onLogout={logout} />;
}
