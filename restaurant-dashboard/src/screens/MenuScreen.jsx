import { useEffect, useState } from 'react';
import { api } from '../api';

export default function MenuScreen({ restaurant }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [isVeg, setIsVeg] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  function load() {
    setLoading(true);
    api
      .getMenuItems(restaurant.id)
      .then(setItems)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  async function addItem(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.createMenuItem({ restaurantId: restaurant.id, name, price: Number(price), isVeg });
      setName('');
      setPrice('');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleAvailability(item) {
    try {
      await api.setMenuItemAvailability(item.id, !item.isAvailable);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeItem(item) {
    if (!confirm(`Remove ${item.name} from your menu?`)) return;
    try {
      await api.deleteMenuItem(item.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20 }}>Your menu</h2>
        <button className="btn-primary" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : '+ Add item'}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {showForm && (
        <form onSubmit={addItem} className="card stack">
          <input placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} required />
          <input placeholder="Price (₹)" type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} required />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={isVeg} onChange={(e) => setIsVeg(e.target.checked)} style={{ width: 'auto' }} />
            Vegetarian
          </label>
          <button className="btn-primary" type="submit" disabled={saving}>
            {saving ? 'Adding…' : 'Add to menu'}
          </button>
        </form>
      )}

      {loading && <p className="muted">Loading menu…</p>}
      {!loading && items.length === 0 && <p className="muted">No items yet — add your first one above.</p>}

      <div className="stack">
        {items.map((item) => (
          <div key={item.id} className="card">
            <div className="row">
              <div>
                <h3 style={{ fontSize: 15 }}>{item.name} {item.isVeg ? '🌱' : ''}</h3>
                <p className="muted">₹{Number(item.price).toFixed(0)}</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={() => toggleAvailability(item)}>
                  {item.isAvailable ? 'Mark sold out' : 'Mark available'}
                </button>
                <button className="btn-ghost" onClick={() => removeItem(item)}>Remove</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
