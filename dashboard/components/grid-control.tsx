'use client';

export type GridLayout = '1' | '2' | 'auto';

export const GRID_CLASSES: Record<GridLayout, string> = {
  '1': 'grid-cols-1',
  '2': 'grid-cols-1 lg:grid-cols-2',
  auto: 'grid-cols-1 md:grid-cols-2 2xl:grid-cols-3',
};

const OPTIONS: { value: GridLayout; label: string; icon: JSX.Element }[] = [
  {
    value: '1',
    label: 'Single column',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="2" y="1" width="10" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    value: '2',
    label: 'Two columns',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="1" y="1" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" />
        <rect x="8" y="1" width="5" height="12" rx="1" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    value: 'auto',
    label: 'Auto-fit',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect x="0.5" y="1" width="3.5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="5.25" y="1" width="3.5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="10" y="1" width="3.5" height="12" rx="1" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
];

export function GridControl({
  value,
  onChange,
}: {
  value: GridLayout;
  onChange: (layout: GridLayout) => void;
}) {
  const handleChange = (layout: GridLayout) => {
    onChange(layout);
    localStorage.setItem('agentobox-grid', layout);
  };

  return (
    <div className="flex items-center gap-0.5 p-0.5 bg-surface-inset/50 rounded-sm">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => handleChange(opt.value)}
          title={opt.label}
          className={`w-7 h-6 flex items-center justify-center rounded-sm transition-colors ${
            value === opt.value
              ? 'bg-accent/20 text-accent'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
