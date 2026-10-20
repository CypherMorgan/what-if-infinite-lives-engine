import type { Store } from '../state/store';

const SHORTCUTS = [
  {
    category: 'File',
    items: [
      ['Ctrl+N', 'New universe'],
      ['Ctrl+O', 'Import'],
      ['Ctrl+S', 'Export'],
    ],
  },
  {
    category: 'Edit',
    items: [
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Shift+Z', 'Redo'],
      ['Ctrl+F', 'Find node'],
    ],
  },
  {
    category: 'Universe',
    items: [
      ['E', 'Expand selected node'],
      ['Ctrl+R', 'Reroll'],
      ['F', 'Fit to view'],
      ['+/-', 'Zoom in/out'],
    ],
  },
  {
    category: 'Navigation',
    items: [
      ['↑↓←→', 'Navigate path'],
      ['Esc', 'Clear selection/close modal'],
      ['Double-click', 'Expand node'],
    ],
  },
  {
    category: 'View',
    items: [
      ['Ctrl+,', 'Settings'],
      ['Ctrl+/', 'Keyboard shortcuts'],
    ],
  },
];

export function ShortcutsModal({ store: _store, close }: { store: Store; close: () => void }) {
  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal" style={{ width: 'min(720px, 92vw)' }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <span className="modal-title">Keyboard Shortcuts</span>
          <button className="btn btn-ghost btn-sm" onClick={close}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 16,
            }}
          >
            {SHORTCUTS.map((cat) => (
              <div key={cat.category}>
                <h3 className="section-title">{cat.category}</h3>
                <table style={{ width: '100%', fontSize: 12 }}>
                  <tbody>
                    {cat.items.map(([key, desc]) => (
                      <tr key={key}>
                        <td style={{ padding: '4px 0', fontFamily: 'var(--font-mono)' }}>{key}</td>
                        <td style={{ color: 'var(--text-dim)' }}>{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-primary" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
