'use client';

import { useState, useTransition } from 'react';
import { addToCart } from './actions';

/**
 * Quantity plus add, on every row.
 *
 * A dealer ordering a dozen different parts should never leave the results
 * list — going into a detail page and back twelve times is how a tool stops
 * getting used. So the whole interaction is one row: type a number, press add,
 * see it confirm in place.
 */
export default function AddToCart({ partId, unit }: { partId: string; unit: string | null }) {
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await addToCart(partId, qty);
      if (res.ok) {
        setAdded(true);
        setQty(1);
        setTimeout(() => setAdded(false), 1600);
      } else {
        setError(res.error ?? 'Could not add that.');
      }
    });
  };

  return (
    <div className="flex items-center gap-1.5 justify-end">
      <input
        type="number"
        min={1}
        max={9999}
        value={qty}
        onChange={(e) => setQty(Number(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        aria-label={`Quantity${unit ? ` in ${unit}` : ''}`}
        className="input w-16 text-center px-1 py-1 tabular"
      />
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className={`btn px-2 py-1 text-xs ${added ? '' : 'btn-primary'}`}
        title={error ?? undefined}
      >
        {added ? 'Added' : pending ? '…' : 'Add'}
      </button>
    </div>
  );
}
