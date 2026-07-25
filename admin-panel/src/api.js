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
  getAllComplaints: () => request('/orders/complaints/admin', { auth: true }),
  respondToComplaint: (complaintId, body) => request(`/orders/complaints/${complaintId}/respond`, { method: 'PATCH', body, auth: true }),
  resetPassword: (role, phone) => request('/admin/reset-password', { method: 'POST', body: { role, phone }, auth: true }),
  getStaleUnassignedOrders: () => request('/admin/stale-unassigned-orders', { auth: true }),

  getRiders: () => request('/delivery-partners'),
  verifyRider: (id) => request(`/delivery-partners/${id}/verify`, { method: 'PATCH', auth: true }),

  getShifts: () => request('/shifts', { auth: true }),
  createShift: (body) => request('/shifts', { method: 'POST', body, auth: true }),
  getIncentives: () => request('/incentives', { auth: true }),
  createIncentive: (body) => request('/incentives', { method: 'POST', body, auth: true }),
  deactivateIncentive: (id) => request(`/incentives/${id}/deactivate`, { method: 'PATCH', auth: true }),
  getAnnouncements: () => request('/announcements', { auth: true }),
  createAnnouncement: (body) => request('/announcements', { method: 'POST', body, auth: true }),
  deactivateAnnouncement: (id) => request(`/announcements/${id}/deactivate`, { method: 'PATCH', auth: true }),
  getReferrals: () => request('/referrals', { auth: true }),
  getSosAlerts: () => request('/sos-alerts', { auth: true }),

  getToken,
  setToken: (token) => localStorage.setItem('mannadash_admin_token', token),
  clearToken: () => localStorage.removeItem('mannadash_admin_token'),
  clearStoredAdmin: () => localStorage.removeItem('mannadash_admin'),
  getStoredAdmin: () => {
    const raw = localStorage.getItem('mannadash_admin');
    return raw ? JSON.parse(raw) : null;
  },
  setStoredAdmin: (a) => localStorage.setItem('mannadash_admin', JSON.stringify(a)),
};
