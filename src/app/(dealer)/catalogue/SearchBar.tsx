'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * The search box.
 *
 * Debounced rather than submit-driven: a dealer types a part number, and the
 * list should be narrowing while they type. 250ms is long enough not to fire on
 * every keystroke and short enough to feel immediate.
 */
export default function SearchBar({ total }: { total: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set('q', value);
      else next.delete('q');
      next.delete('page'); // a new query starts at page one
      router.replace(`/catalogue?${next.toString()}`);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search a part number or description — 0208, union connector, UV lamp…"
        aria-label="Search parts"
        autoFocus
        className="input py-2.5 pr-28"
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted tabular">
        {total.toLocaleString('en-CA')} parts
      </span>
    </div>
  );
}
