const API_BASE = import.meta.env.VITE_API_BASE || 'https://195-201-216-17.nip.io';

function getToken() {
  return localStorage.getItem('dabba_rider_token');
}

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = Array.isArray(data?.message) ? data.message.join(', ') : data?.message || 'Something went wrong';
    throw new Error(message);
  }

  return data;
}

export const api = {
  signup: (body) => request('/delivery-partners/signup', { method: 'POST', body }),
  login: (body) => request('/delivery-partners/login', { method: 'POST', body }),
  changePassword: (body) => request('/delivery-partners/me/change-password', { method: 'POST', body, auth: true }),
  getRider: (id) => request(`/delivery-partners/${id}`),

  setAvailability: (isAvailable) =>
    request('/delivery-partners/me/availability', { method: 'PATCH', body: { isAvailable }, auth: true }),
  updateLocation: (latitude, longitude) =>
    request('/delivery-partners/me/location', { method: 'PATCH', body: { latitude, longitude }, auth: true }),

  getMyOrders: () => request('/orders/rider/mine', { auth: true }),
  getMyEarnings: () => request('/orders/rider/earnings', { auth: true }),
  getVapidPublicKey: () => request('/push/vapid-public-key'),
  subscribeToPush: (subscription) => request('/push/subscribe', { method: 'POST', body: { subscription }, auth: true }),
  unsubscribeFromPush: () => request('/push/subscribe', { method: 'DELETE', auth: true }),
  getPushStatus: () => request('/push/status', { auth: true }),
  updateOrderStatus: (id, status) => request(`/orders/${id}/status`, { method: 'PATCH', body: { status }, auth: true }),

  getToken,
  setToken: (token) => localStorage.setItem('dabba_rider_token', token),
  clearToken: () => localStorage.removeItem('dabba_rider_token'),
  clearStoredRider: () => localStorage.removeItem('dabba_rider'),
  getStoredRider: () => {
    const raw = localStorage.getItem('dabba_rider');
    return raw ? JSON.parse(raw) : null;
  },
  setStoredRider: (r) => localStorage.setItem('dabba_rider', JSON.stringify(r)),
};

export const SOCKET_URL = API_BASE;
