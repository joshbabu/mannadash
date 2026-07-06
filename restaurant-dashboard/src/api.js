const API_BASE = import.meta.env.VITE_API_BASE || 'https://195-201-216-17.nip.io';

function getToken() {
  return localStorage.getItem('dabba_restaurant_token');
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
  // Restaurant application + owner auth
  registerRestaurant: (body) => request('/restaurants', { method: 'POST', body }),
  claimRestaurant: (body) => request('/restaurants/signup', { method: 'POST', body }),
  login: (body) => request('/restaurants/login', { method: 'POST', body }),
  getRestaurant: (id) => request(`/restaurants/${id}`),

  // Menu
  getMenuItems: (restaurantId) => request(`/menu-items?restaurantId=${restaurantId}`),
  createMenuItem: (body) => request('/menu-items', { method: 'POST', body, auth: true }),
  updateMenuItem: (id, body) => request(`/menu-items/${id}`, { method: 'PATCH', body, auth: true }),
  setMenuItemAvailability: (id, isAvailable) =>
    request(`/menu-items/${id}/availability`, { method: 'PATCH', body: { isAvailable }, auth: true }),
  deleteMenuItem: (id) => request(`/menu-items/${id}`, { method: 'DELETE', auth: true }),
  uploadMenuItemImage: (id, imageBase64) => request(`/menu-items/${id}/image`, { method: 'POST', body: { imageBase64 }, auth: true }),

  // Orders
  getMyOrders: () => request('/orders/restaurant/mine', { auth: true }),
  getMyInsights: () => request('/orders/restaurant/insights', { auth: true }),
  updateOrderStatus: (id, status) => request(`/orders/${id}/status`, { method: 'PATCH', body: { status }, auth: true }),
  assignRider: (id) => request(`/orders/${id}/assign-rider`, { method: 'POST', auth: true }),
  assignSpecificRider: (orderId, riderId) => request(`/orders/${orderId}/assign-rider/${riderId}`, { method: 'POST', auth: true }),

  // Riders — visibility into who's online near this restaurant, for manual assignment
  getAvailableRidersNearby: (lat, lng) => request(`/delivery-partners/available?lat=${lat}&lng=${lng}`, { auth: true }),

  getToken,
  setToken: (token) => localStorage.setItem('dabba_restaurant_token', token),
  clearToken: () => localStorage.removeItem('dabba_restaurant_token'),
  getStoredRestaurant: () => {
    const raw = localStorage.getItem('dabba_restaurant');
    return raw ? JSON.parse(raw) : null;
  },
  setStoredRestaurant: (r) => localStorage.setItem('dabba_restaurant', JSON.stringify(r)),
};

export const SOCKET_URL = API_BASE;
