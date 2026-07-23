import { useState } from 'react';
import { api } from '../api';

// Full-screen "select your location" flow, modeled on the reference screenshot: search,
// a couple of quick actions, then the saved-addresses list with per-row select/edit/delete.
// "Recently searched" from the reference isn't included — there's no backend search-history
// concept to back it with real data, and a fabricated list would just be decoration.
export default function AddressPickerScreen({
  addresses,
  selectedAddress,
  onClose,
  onSelectAddress,
  onAddressesUpdated,
  onUseMyLocation,
  defaultLatLng,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [locationOn, setLocationOn] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [error, setError] = useState('');

  const q = searchQuery.trim().toLowerCase();
  const filteredAddresses = !q
    ? addresses
    : addresses.filter((a) => a.label.toLowerCase().includes(q) || a.address.toLowerCase().includes(q));

  function toggleLocation() {
    const next = !locationOn;
    setLocationOn(next);
    if (next) onUseMyLocation();
  }

  async function addAddress() {
    if (!newLabel.trim() || !newAddress.trim()) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.saveAddress({
        label: newLabel.trim(),
        address: newAddress.trim(),
        latitude: defaultLatLng?.lat ?? 17.45,
        longitude: defaultLatLng?.lng ?? 78.39,
      });
      onAddressesUpdated(updated);
      setNewLabel('');
      setNewAddress('');
      setShowAddForm(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(addr) {
    setEditingId(addr.id);
    setEditLabel(addr.label);
    setEditAddress(addr.address);
    setOpenMenuId(null);
  }

  async function saveEdit(id) {
    if (!editLabel.trim() || !editAddress.trim()) return;
    setSaving(true);
    setError('');
    try {
      const updated = await api.updateAddress(id, { label: editLabel.trim(), address: editAddress.trim() });
      onAddressesUpdated(updated);
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteAddress(id) {
    setOpenMenuId(null);
    try {
      const updated = await api.removeAddress(id);
      onAddressesUpdated(updated);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 80, background: 'var(--paper)', color: 'var(--charcoal)',
        overflowY: 'auto', padding: '20px 20px 40px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <button
          onClick={onClose}
          aria-label="Back"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--charcoal)', padding: 0 }}
        >
          ←
        </button>
        <h2 style={{ fontSize: 20 }}>Select your location</h2>
      </div>

      <input
        placeholder="Search an area or address"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{ width: '100%', background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', marginBottom: 14, borderRadius: 24, padding: '12px 16px' }}
      />

      <div style={{ display: 'flex', gap: 10, marginBottom: 22 }}>
        <button
          onClick={toggleLocation}
          style={{
            flex: 1, textAlign: 'left', background: '#fdf8ef', border: '1px solid #e5ddc9', borderRadius: 14,
            padding: '12px 14px', cursor: 'pointer',
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-block', width: 34, height: 20, borderRadius: 10, marginBottom: 8,
              background: locationOn ? 'var(--chili)' : '#ddd', position: 'relative',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: locationOn ? 16 : 2, width: 16, height: 16, borderRadius: '50%',
              background: '#fff', transition: 'left 0.15s ease',
            }} />
          </span>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--charcoal)' }}>
            Turn on Location
          </span>
        </button>
        <button
          onClick={() => setShowAddForm((v) => !v)}
          style={{
            flex: 1, textAlign: 'left', background: '#fdf8ef', border: '1px solid #e5ddc9', borderRadius: 14,
            padding: '12px 14px', cursor: 'pointer',
          }}
        >
          <span style={{ display: 'block', fontSize: 20, marginBottom: 8 }}>➕</span>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--charcoal)' }}>
            Add New Address
          </span>
        </button>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 14 }}>{error}</div>}

      {showAddForm && (
        <div style={{ background: '#fdf8ef', border: '1px solid #e5ddc9', borderRadius: 14, padding: 14, marginBottom: 20 }}>
          <input
            placeholder="Label (e.g. Home, Work)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            style={{ width: '100%', marginBottom: 8, background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd' }}
          />
          <textarea
            placeholder="Full address"
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            rows={2}
            style={{ width: '100%', marginBottom: 10, background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', resize: 'vertical' }}
          />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn-secondary" onClick={() => setShowAddForm(false)}>Cancel</button>
            <button className="btn-primary" onClick={addAddress} disabled={saving} style={{ width: 'auto', padding: '10px 18px' }}>
              {saving ? 'Saving…' : 'Save address'}
            </button>
          </div>
        </div>
      )}

      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: '#8a8074', textTransform: 'uppercase', marginBottom: 10 }}>
        Saved addresses
      </p>

      {filteredAddresses.length === 0 && (
        <p className="muted" style={{ marginBottom: 20 }}>
          {addresses.length === 0 ? 'No saved addresses yet — add one above.' : 'No saved addresses match your search.'}
        </p>
      )}

      <div className="stack">
        {filteredAddresses.map((a) => {
          const isSelected = selectedAddress?.id === a.id;
          const isEditing = editingId === a.id;
          return (
            <div
              key={a.id}
              style={{
                position: 'relative', background: '#fdf8ef', border: isSelected ? '2px solid var(--chili-dark)' : '1px solid #e5ddc9',
                borderRadius: 14, padding: '12px 14px',
              }}
            >
              {isEditing ? (
                <>
                  <input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    style={{ width: '100%', marginBottom: 8, background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd' }}
                  />
                  <textarea
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    rows={2}
                    style={{ width: '100%', marginBottom: 10, background: '#fff', color: 'var(--charcoal)', border: '1px solid #ddd', resize: 'vertical' }}
                  />
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
                    <button className="btn-primary" onClick={() => saveEdit(a.id)} disabled={saving} style={{ width: 'auto', padding: '10px 18px' }}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 18, lineHeight: '22px' }}>🏠</span>
                  <button
                    onClick={() => onSelectAddress(a)}
                    style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--charcoal)' }}>{a.label}</span>
                      {isSelected && (
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#0f7a5c', background: '#d6f5e8', borderRadius: 8, padding: '2px 8px' }}>
                          SELECTED
                        </span>
                      )}
                    </span>
                    <span style={{ display: 'block', fontSize: 13, color: '#6b6156' }}>{a.address}</span>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === a.id ? null : a.id); }}
                    aria-label={`Options for ${a.label}`}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '0 4px', color: '#6b6156' }}
                  >
                    ⋮
                  </button>
                  {openMenuId === a.id && (
                    <div
                      style={{
                        position: 'absolute', top: 40, right: 10, background: 'var(--ink)', borderRadius: 10,
                        overflow: 'hidden', boxShadow: '0 8px 20px rgba(0,0,0,0.35)', zIndex: 5, minWidth: 120,
                      }}
                    >
                      <button
                        onClick={() => startEdit(a)}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--paper)', cursor: 'pointer', fontSize: 14 }}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => deleteAddress(a.id)}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--chili)', cursor: 'pointer', fontSize: 14 }}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
