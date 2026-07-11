import { useState } from 'react';
import { api } from '../api';

// Base-4/base-4/base-9 calorie formula — matches PROJECT-STATUS.md's Phase K design note.
// Kept in one place so the dashboard's live preview and the customer app's display can't drift.
export function calculateCalories(protein, carbs, fat) {
  return Math.round((Number(protein) || 0) * 4 + (Number(carbs) || 0) * 4 + (Number(fat) || 0) * 9);
}

/**
 * Lets a restaurant add or edit an item's nutritional info after the fact — the create
 * form covers it too, but plenty of dishes will get this added later rather than at
 * first entry. Small and flat by design: no groups, no cascade, just five numbers.
 */
export default function NutritionEditor({ menuItem, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const hasData = menuItem.weightGrams != null || menuItem.proteinGrams != null;

  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => setExpanded(!expanded)}>
        {hasData ? '🥗 Nutrition' : '+ Add nutritional info'}
      </button>
      {expanded && <NutritionForm menuItem={menuItem} onSaved={() => { setExpanded(false); onChange(); }} />}
    </div>
  );
}

function NutritionForm({ menuItem, onSaved }) {
  const [weightGrams, setWeightGrams] = useState(menuItem.weightGrams ?? '');
  const [proteinGrams, setProteinGrams] = useState(menuItem.proteinGrams ?? '');
  const [carbsGrams, setCarbsGrams] = useState(menuItem.carbsGrams ?? '');
  const [fatGrams, setFatGrams] = useState(menuItem.fatGrams ?? '');
  const [fibreGrams, setFibreGrams] = useState(menuItem.fibreGrams ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      await api.updateMenuItem(menuItem.id, {
        weightGrams: weightGrams === '' ? null : Number(weightGrams),
        proteinGrams: proteinGrams === '' ? null : Number(proteinGrams),
        carbsGrams: carbsGrams === '' ? null : Number(carbsGrams),
        fatGrams: fatGrams === '' ? null : Number(fatGrams),
        fibreGrams: fibreGrams === '' ? null : Number(fibreGrams),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ background: '#fbf7ef', borderRadius: 8, padding: 10, marginTop: 8, fontSize: 13 }}>
      {error && <div className="error-banner">{error}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <input placeholder="Weight (g)" type="number" min="0" value={weightGrams} onChange={(e) => setWeightGrams(e.target.value)} style={{ width: 100 }} />
        <input placeholder="Protein (g)" type="number" min="0" value={proteinGrams} onChange={(e) => setProteinGrams(e.target.value)} style={{ width: 100 }} />
        <input placeholder="Carbs (g)" type="number" min="0" value={carbsGrams} onChange={(e) => setCarbsGrams(e.target.value)} style={{ width: 100 }} />
        <input placeholder="Fat (g)" type="number" min="0" value={fatGrams} onChange={(e) => setFatGrams(e.target.value)} style={{ width: 100 }} />
        <input placeholder="Fibre (g)" type="number" min="0" value={fibreGrams} onChange={(e) => setFibreGrams(e.target.value)} style={{ width: 100 }} />
      </div>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: 12 }}>
        ≈ {calculateCalories(proteinGrams, carbsGrams, fatGrams)} kcal — calculated automatically
      </p>
      <button className="btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
