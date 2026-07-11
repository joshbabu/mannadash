import { useState } from 'react';
import { api } from '../api';

/**
 * Lets a restaurant define customization groups on a dish — "Size" (required, pick one),
 * "Spice Level" (optional, pick one), "Add-ons" (optional, pick several) — each with its
 * own priced options. Renders inline on the menu item's card in MenuScreen.
 */
export default function VariantGroupEditor({ menuItem, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null); // null | 'new' | group object
  const [error, setError] = useState('');

  const groups = menuItem.variantGroups || [];

  async function handleDelete(group) {
    if (!window.confirm(`Delete the "${group.name}" variant group? This can't be undone.`)) return;
    setError('');
    try {
      await api.deleteVariantGroup(group.id);
      onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid #eee4d4', paddingTop: 10 }}>
      <div className="row">
        <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Hide variants' : `Variants (${groups.length})`}
        </button>
        {expanded && (
          <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => setEditingGroup('new')}>
            + Add variant group
          </button>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {error && <div className="error-banner">{error}</div>}

          {groups.map((group) => (
            <div key={group.id} style={{ background: '#fbf7ef', borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 13 }}>
              <div className="row">
                <div>
                  <strong>{group.name}</strong>{' '}
                  <span className="muted" style={{ fontSize: 12 }}>
                    {group.required ? 'Required' : 'Optional'} · {group.selectionType === 'single' ? 'pick one' : 'pick any'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => setEditingGroup(group)}>
                    Edit
                  </button>
                  <button className="btn-ghost" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => handleDelete(group)}>
                    Delete
                  </button>
                </div>
              </div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {group.options.map((opt) => (
                  <li key={opt.id}>
                    {opt.label} {Number(opt.priceDelta) > 0 ? `+₹${Number(opt.priceDelta).toFixed(0)}` : Number(opt.priceDelta) < 0 ? `-₹${Math.abs(Number(opt.priceDelta)).toFixed(0)}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {groups.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No variants yet — e.g. Size, Spice Level, Add-ons.</p>}

          {editingGroup && (
            <GroupForm
              menuItemId={menuItem.id}
              group={editingGroup === 'new' ? null : editingGroup}
              onCancel={() => setEditingGroup(null)}
              onSaved={() => {
                setEditingGroup(null);
                onChange();
              }}
              onError={setError}
            />
          )}
        </div>
      )}
    </div>
  );
}

function GroupForm({ menuItemId, group, onCancel, onSaved, onError }) {
  const [name, setName] = useState(group?.name || '');
  const [required, setRequired] = useState(group?.required ?? false);
  const [selectionType, setSelectionType] = useState(group?.selectionType || 'single');
  const [options, setOptions] = useState(
    group?.options?.map((o) => ({ id: o.id, label: o.label, priceDelta: String(o.priceDelta) })) || [
      { label: '', priceDelta: '0' },
      { label: '', priceDelta: '0' },
    ],
  );
  const [saving, setSaving] = useState(false);

  function updateOption(index, field, value) {
    setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, [field]: value } : o)));
  }

  function addOptionRow() {
    setOptions((prev) => [...prev, { label: '', priceDelta: '0' }]);
  }

  function removeOptionRow(index) {
    setOptions((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    onError('');
    const cleanOptions = options
      .filter((o) => o.label.trim())
      .map((o) => ({ ...(o.id ? { id: o.id } : {}), label: o.label.trim(), priceDelta: Number(o.priceDelta) || 0 }));

    if (!name.trim()) return onError('Give the group a name, like "Size" or "Add-ons"');
    if (cleanOptions.length === 0) return onError('Add at least one option');

    setSaving(true);
    try {
      const payload = { name: name.trim(), required, selectionType, options: cleanOptions };
      if (group) {
        await api.updateVariantGroup(group.id, payload);
      } else {
        await api.createVariantGroup(menuItemId, payload);
      }
      onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid var(--turmeric, #d9930d)', borderRadius: 8, padding: 12, fontSize: 13 }}>
      <input placeholder="Group name — e.g. Size, Spice Level, Add-ons" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 8 }} />

      <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} style={{ width: 'auto' }} />
          Required
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="muted">Customer can pick</span>
          <select value={selectionType} onChange={(e) => setSelectionType(e.target.value)}>
            <option value="single">one option</option>
            <option value="multiple">any number of options</option>
          </select>
        </label>
      </div>

      <p className="muted" style={{ margin: '0 0 4px', fontSize: 12 }}>Options (extra price, or 0)</p>
      {options.map((opt, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            placeholder={`Option ${i + 1} — e.g. Large`}
            value={opt.label}
            onChange={(e) => updateOption(i, 'label', e.target.value)}
            style={{ flex: 1 }}
          />
          <input
            type="number"
            placeholder="+₹"
            value={opt.priceDelta}
            onChange={(e) => updateOption(i, 'priceDelta', e.target.value)}
            style={{ width: 80 }}
          />
          <button className="btn-ghost" style={{ padding: '4px 8px' }} onClick={() => removeOptionRow(i)} type="button">
            ✕
          </button>
        </div>
      ))}
      <button className="btn-secondary" style={{ fontSize: 12, marginBottom: 10 }} onClick={addOptionRow} type="button">
        + Add option
      </button>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn-secondary" onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </div>
  );
}
