import { useEffect, useState } from 'react';
import { api } from '../api';
import VariantGroupEditor from '../components/VariantGroupEditor';
import NutritionEditor from '../components/NutritionEditor';

export default function MenuScreen({ restaurant }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [originalPrice, setOriginalPrice] = useState('');
  const [isVeg, setIsVeg] = useState(true);
  const [category, setCategory] = useState('main');
  const [description, setDescription] = useState('');
  const [showNutrition, setShowNutrition] = useState(false);
  const [weightGrams, setWeightGrams] = useState('');
  const [proteinGrams, setProteinGrams] = useState('');
  const [carbsGrams, setCarbsGrams] = useState('');
  const [fatGrams, setFatGrams] = useState('');
  const [fibreGrams, setFibreGrams] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState(null);

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
      await api.createMenuItem({
        restaurantId: restaurant.id,
        name,
        price: Number(price),
        originalPrice: originalPrice ? Number(originalPrice) : undefined,
        isVeg,
        category,
        description: description || undefined,
        weightGrams: weightGrams ? Number(weightGrams) : undefined,
        proteinGrams: proteinGrams ? Number(proteinGrams) : undefined,
        carbsGrams: carbsGrams ? Number(carbsGrams) : undefined,
        fatGrams: fatGrams ? Number(fatGrams) : undefined,
        fibreGrams: fibreGrams ? Number(fibreGrams) : undefined,
      });
      setName('');
      setPrice('');
      setOriginalPrice('');
      setDescription('');
      setWeightGrams('');
      setProteinGrams('');
      setCarbsGrams('');
      setFatGrams('');
      setFibreGrams('');
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

  async function handleImageSelect(item, file) {
    if (!file) return;
    setUploadingId(item.id);
    setError('');
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api.uploadMenuItemImage(item.id, base64);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingId(null);
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
          <input placeholder="Original price (optional — shows a discount)" type="number" min="0" value={originalPrice} onChange={(e) => setOriginalPrice(e.target.value)} />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="breakfast">Breakfast</option>
            <option value="starter">Starter</option>
            <option value="lunch">Lunch</option>
            <option value="dinner">Dinner</option>
            <option value="main">Main</option>
            <option value="dessert">Dessert</option>
            <option value="beverage">Beverage</option>
          </select>
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            style={{ width: '100%' }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
            <input type="checkbox" checked={isVeg} onChange={(e) => setIsVeg(e.target.checked)} style={{ width: 'auto' }} />
            Vegetarian
          </label>

          <div>
            <button type="button" className="btn-secondary" style={{ fontSize: 13 }} onClick={() => setShowNutrition(!showNutrition)}>
              {showNutrition ? 'Hide nutritional info' : '+ Nutritional info (optional)'}
            </button>
            {showNutrition && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                <input placeholder="Weight (g)" type="number" min="0" value={weightGrams} onChange={(e) => setWeightGrams(e.target.value)} style={{ width: 110 }} />
                <input placeholder="Protein (g)" type="number" min="0" value={proteinGrams} onChange={(e) => setProteinGrams(e.target.value)} style={{ width: 110 }} />
                <input placeholder="Carbs (g)" type="number" min="0" value={carbsGrams} onChange={(e) => setCarbsGrams(e.target.value)} style={{ width: 110 }} />
                <input placeholder="Fat (g)" type="number" min="0" value={fatGrams} onChange={(e) => setFatGrams(e.target.value)} style={{ width: 110 }} />
                <input placeholder="Fibre (g)" type="number" min="0" value={fibreGrams} onChange={(e) => setFibreGrams(e.target.value)} style={{ width: 110 }} />
                <p className="muted" style={{ width: '100%', fontSize: 12, margin: 0 }}>
                  Calories are calculated automatically from protein, carbs and fat — no need to enter them.
                </p>
              </div>
            )}
          </div>

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
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: 48, height: 48, borderRadius: 8, background: 'var(--paper-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🍽️</div>
                )}
                <div>
                  <h3 style={{ fontSize: 15 }}>{item.name} {item.isVeg ? '🌱' : ''}</h3>
                  {item.description && <p className="muted" style={{ fontSize: 13, marginTop: 2 }}>{item.description}</p>}
                  <p className="muted">₹{Number(item.price).toFixed(0)}</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label className="btn-secondary" style={{ cursor: 'pointer' }}>
                  {uploadingId === item.id ? 'Uploading…' : item.imageUrl ? 'Change photo' : 'Add photo'}
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    disabled={uploadingId === item.id}
                    onChange={(e) => handleImageSelect(item, e.target.files[0])}
                  />
                </label>
                <button className="btn-secondary" onClick={() => toggleAvailability(item)}>
                  {item.isAvailable ? 'Mark sold out' : 'Mark available'}
                </button>
                <button className="btn-ghost" onClick={() => removeItem(item)}>Remove</button>
              </div>
            </div>
            <VariantGroupEditor menuItem={item} onChange={load} />
            <NutritionEditor menuItem={item} onChange={load} />
          </div>
        ))}
      </div>
    </div>
  );
}
