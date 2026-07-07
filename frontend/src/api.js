const API_BASE = import.meta.env.VITE_API_BASE || 'https://195-201-216-17.nip.io';

function getToken() {
  return localStorage.getItem('dabba_token');
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
  // Auth
  signup: (body) => request('/auth/signup', { method: 'POST', body }),
  login: (body) => request('/auth/login', { method: 'POST', body }),

  // Restaurants
  getNearbyRestaurants: (lat, lng, radius = 8000) =>
    request(`/restaurants/nearby?lat=${lat}&lng=${lng}&radius=${radius}`),
  getRestaurant: (id) => request(`/restaurants/${id}`),

  // Menu
  getMenuItems: (restaurantId) => request(`/menu-items?restaurantId=${restaurantId}`),

  // Orders
  placeOrder: (body) => request('/orders', { method: 'POST', body, auth: true }),
  getMyOrders: () => request('/orders', { auth: true }),
  getOrder: (id) => request(`/orders/${id}`, { auth: true }),
  cancelOrder: (id) => request(`/orders/${id}/status`, { method: 'PATCH', body: { status: 'cancelled' }, auth: true }),
  createPayment: (orderId) => request(`/orders/${orderId}/create-payment`, { method: 'POST', auth: true }),
  rateOrder: (orderId, body) => request(`/orders/${orderId}/rating`, { method: 'POST', body, auth: true }),
  getSavedAddresses: () => request('/customers/me/addresses', { auth: true }),
  saveAddress: (body) => request('/customers/me/addresses', { method: 'POST', body, auth: true }),
  removeAddress: (id) => request(`/customers/me/addresses/${id}`, { method: 'DELETE', auth: true }),

  getToken,
  setToken: (token) => localStorage.setItem('dabba_token', token),
  clearToken: () => localStorage.removeItem('dabba_token'),
  getStoredUser: () => {
    const raw = localStorage.getItem('dabba_user');
    return raw ? JSON.parse(raw) : null;
  },
  setStoredUser: (user) => localStorage.setItem('dabba_user', JSON.stringify(user)),
};

export const SOCKET_URL = API_BASE;
