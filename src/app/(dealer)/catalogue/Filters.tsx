import Link from 'next/link';

export interface FacetGroup {
  title: string;
  param: string;
  options: { value: string; label: string; count: number }[];
  /** Explains a group whose meaning is not obvious from its name. */
  hint?: string;
}

/** Sidebar filters. Every option carries its count, so nobody clicks into
 *  an empty list to find out it was empty. */
export default function Filters({
  groups,
  active,
  basePath = '/catalogue',
}: {
  groups: FacetGroup[];
  active: Record<string, string | undefined>;
  basePath?: string;
}) {
  const href = (param: string, value: string | null) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(active)) if (v && k !== param) next.set(k, v);
    if (value) next.set(param, value);
    return `${basePath}?${next.toString()}`;
  };

  const anyActive = Object.entries(active).some(([k, v]) => v && k !== 'q' && k !== 'sort');

  return (
    <aside className="w-full lg:w-60 shrink-0 space-y-5">
      {anyActive ? (
        <Link
          href={`${basePath}${active.q ? `?q=${encodeURIComponent(active.q)}` : ''}`}
          className="text-xs underline underline-offset-2 text-muted hover:text-ink"
        >
          Clear filters
        </Link>
      ) : null}

      {groups.map((g) => (
        <div key={g.param}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">
            {g.title}
          </h3>
          {g.hint ? <p className="text-[11px] text-muted mb-1.5">{g.hint}</p> : null}
          <ul className="space-y-0.5 max-h-72 overflow-y-auto pr-1">
            {g.options.map((o) => {
              const on = active[g.param] === o.value;
              return (
                <li key={o.value}>
                  <Link
                    href={href(g.param, on ? null : o.value)}
                    className={`flex items-baseline gap-2 text-sm px-2 py-1 rounded hover:bg-canvas ${
                      on ? 'font-semibold' : ''
                    }`}
                    style={on ? { background: 'var(--canvas)' } : undefined}
                  >
                    <span className="flex-1 truncate" title={o.label}>
                      {on ? '✓ ' : ''}
                      {o.label}
                    </span>
                    <span className="text-xs text-muted tabular">{o.count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </aside>
  );
}
