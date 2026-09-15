'use client';

import { useTransition } from 'react';
import { reorderAction } from '../cart/actions';

/** A dealer's order history is their real catalogue — most repeat orders
 *  should start here rather than in the search box. */
export default function ReorderButton({ orderId }: { orderId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn py-1 px-2 text-xs"
      disabled={pending}
      onClick={() => start(async () => { await reorderAction(orderId); })}
    >
      {pending ? '…' : 'Reorder'}
    </button>
  );
}
