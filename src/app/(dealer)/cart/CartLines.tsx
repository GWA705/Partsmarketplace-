'use client';

import { useTransition } from 'react';
import { setCartQuantity, clearCart } from '../catalogue/actions';
import { formatCents } from '@/lib/money';

export interface CartRow {
  partId: string;
  code: string | null;
  name: string;
  vendor: string | null;
  unit: string | null;
  quantity: number;
  priceCents: number | null;
  fulfilledBy: 'HEAD_OFFICE' | 'SUPPLIER';
}

export default function CartLines({ rows }: { rows: CartRow[] }) {
  const [pending, start] = useTransition();

  const setQty = (partId: string, qty: number) => {
    start(async () => {
      await setCartQuantity(partId, qty);
    });
  };

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted border-b border-line">
            <tr>
              <th className="text-left font-medium px-3 py-2 w-36">Code</th>
              <th className="text-left font-medium px-3 py-2">Description</th>
              <th className="text-right font-medium px-3 py-2 w-28">Price</th>
              <th className="text-center font-medium px-3 py-2 w-28">Qty</th>
              <th className="text-right font-medium px-3 py-2 w-28">Line</th>
              <th className="px-2 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.partId} className="border-b border-line last:border-0">
                <td className="px-3 py-2 align-top tabular font-semibold">{r.code ?? '—'}</td>
                <td className="px-3 py-2 align-top">
                  <div>{r.name}</div>
                  <div className="text-[11px] text-muted">
                    {r.vendor}
                    {r.fulfilledBy === 'SUPPLIER' ? ' · ships direct' : ''}
                  </div>
                </td>
                <td className="px-3 py-2 align-top text-right tabular">
                  {r.priceCents === null ? (
                    <span className="text-xs text-muted">—</span>
                  ) : (
                    formatCents(r.priceCents)
                  )}
                  {r.unit ? <div className="text-[11px] text-muted">{r.unit}</div> : null}
                </td>
                <td className="px-3 py-2 align-top text-center">
                  <input
                    type="number"
                    min={0}
                    max={9999}
                    defaultValue={r.quantity}
                    disabled={pending}
                    aria-label={`Quantity for ${r.code ?? r.name}`}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (n !== r.quantity) setQty(r.partId, n);
                    }}
                    className="input w-20 text-center px-1 py-1 tabular"
                  />
                </td>
                <td className="px-3 py-2 align-top text-right tabular font-semibold">
                  {r.priceCents === null ? '—' : formatCents(r.priceCents * r.quantity)}
                </td>
                <td className="px-2 py-2 align-top text-right">
                  <button
                    type="button"
                    onClick={() => setQty(r.partId, 0)}
                    disabled={pending}
                    aria-label={`Remove ${r.code ?? r.name}`}
                    className="text-muted hover:text-red-600 px-1"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-3 py-2 border-t border-line flex justify-end">
        <button
          type="button"
          onClick={() => start(async () => { await clearCart(); })}
          disabled={pending}
          className="text-xs text-muted hover:text-ink underline underline-offset-2"
        >
          Empty the cart
        </button>
      </div>
    </div>
  );
}
