import { useState } from 'react';

/**
 * Shown when a customer adds a dish that has variant groups (Size, Spice Level, Add-ons).
 * Required 'single' groups need a radio pick before "Add to cart" is enabled; optional
 * groups can be left blank. 'multiple' groups render as checkboxes with no upper limit.
 */
export default function VariantPicker({ item, onConfirm, onCancel }) {
  const [selected, setSelected] = useState({}); // groupId -> optionId (single) | optionId[] (multiple)

  function pickSingle(groupId, optionId) {
    setSelected((prev) => ({ ...prev, [groupId]: optionId }));
  }

  function toggleMultiple(groupId, optionId) {
    setSelected((prev) => {
      const current = prev[groupId] || [];
      const next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
      return { ...prev, [groupId]: next };
    });
  }

  const allOptionIds = Object.values(selected).flat();
  const missingRequired = (item.variantGroups || []).some((g) => {
    const chosen = selected[g.id];
    return g.required && (!chosen || (Array.isArray(chosen) && chosen.length === 0));
  });

  const total =
    Number(item.price) +
    allOptionIds.reduce((sum, optId) => {
      for (const g of item.variantGroups || []) {
        const opt = g.options.find((o) => o.id === optId);
        if (opt) return sum + Number(opt.priceDelta);
      }
      return sum;
    }, 0);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
        alignItems: 'flex-end', justifyContent: 'center', zIndex: 50,
      }}
      onClick={onCancel}
    >
      <div
        id="variant-picker"
        className="card"
        style={{ width: '100%', maxWidth: 440, maxHeight: '80vh', overflowY: 'auto', margin: 0, borderRadius: '16px 16px 0 0' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: 17, margin: '0 0 4px' }}>{item.name}</h3>
        <p className="muted" style={{ margin: '0 0 14px' }}>₹{Number(item.price).toFixed(0)}</p>

        {(item.variantGroups || []).map((group) => (
          <div key={group.id} style={{ marginBottom: 16 }}>
            <p style={{ fontWeight: 700, margin: '0 0 2px' }}>
              {group.name} {group.required && <span style={{ color: 'var(--chili-dark)', fontSize: 12 }}>· Required</span>}
            </p>
            <p className="muted" style={{ fontSize: 12, margin: '0 0 6px' }}>
              {group.selectionType === 'single' ? 'Choose one' : 'Choose any'}
            </p>
            {group.options.map((opt) => {
              const isSelected =
                group.selectionType === 'single' ? selected[group.id] === opt.id : (selected[group.id] || []).includes(opt.id);
              return (
                <label key={opt.id} className="row" style={{ padding: '8px 0', cursor: 'pointer', borderBottom: '1px solid #f0e9db' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type={group.selectionType === 'single' ? 'radio' : 'checkbox'}
                      name={group.id}
                      checked={isSelected}
                      onChange={() =>
                        group.selectionType === 'single' ? pickSingle(group.id, opt.id) : toggleMultiple(group.id, opt.id)
                      }
                      style={{ width: 'auto' }}
                    />
                    {opt.label}
                  </span>
                  {Number(opt.priceDelta) !== 0 && (
                    <span className="muted">
                      {Number(opt.priceDelta) > 0 ? '+' : '-'}₹{Math.abs(Number(opt.priceDelta)).toFixed(0)}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-secondary" onClick={onCancel} style={{ flex: 1 }}>
            Cancel
          </button>
          <button
            className="btn-primary"
            style={{ flex: 2 }}
            disabled={missingRequired}
            onClick={() => onConfirm(allOptionIds)}
          >
            Add to cart · ₹{total.toFixed(0)}
          </button>
        </div>
      </div>
    </div>
  );
}
