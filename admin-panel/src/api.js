const API_BASE = import.meta.env.VITE_API_BASE || 'https://195-201-216-17.nip.io';

function getToken() {
  return localStorage.getItem('mannadash_admin_token');
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
  login: (body) => request('/admin/login', { method: 'POST', body }),

  getRestaurants: () => request('/restaurants'),
  setRestaurantStatus: (id, status) => request(`/restaurants/${id}/status`, { method: 'PATCH', body: { status }, auth: true }),
  getRestaurantKyc: (id) => request(`/restaurants/${id}/kyc`, { auth: true }),
  resetPassword: (role, phone) => request('/admin/reset-password', { method: 'POST', body: { role, phone }, auth: true }),

  getRiders: () => request('/delivery-partners'),
  verifyRider: (id) => request(`/delivery-partners/${id}/verify`, { method: 'PATCH', auth: true }),

  getToken,
  setToken: (token) => localStorage.setItem('mannadash_admin_token', token),
  clearToken: () => localStorage.removeItem('mannadash_admin_token'),
  getStoredAdmin: () => {
    const raw = localStorage.getItem('mannadash_admin');
    return raw ? JSON.parse(raw) : null;
  },
  setStoredAdmin: (a) => localStorage.setItem('mannadash_admin', JSON.stringify(a)),
};
