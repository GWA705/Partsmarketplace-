'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { checkout, type CheckoutState } from './actions';
import { SHIPPING_METHODS } from '@/lib/constants';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending ? 'Submitting…' : label}
    </button>
  );
}

export default function CheckoutForm({
  isDealer,
  splitNote,
}: {
  isDealer: boolean;
  splitNote: string | null;
}) {
  const [state, action] = useFormState<CheckoutState, FormData>(checkout, {});

  return (
    <form action={action} className="card p-4 space-y-4">
      {isDealer ? (
        <div>
          <label className="label" htmlFor="shippingMethod">How should we ship this?</label>
          <select id="shippingMethod" name="shippingMethod" required className="input" defaultValue="">
            <option value="" disabled>Choose…</option>
            {SHIPPING_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      ) : (
        <div>
          <label className="label" htmlFor="jobRef">Service job (optional)</label>
          <input id="jobRef" name="jobRef" placeholder="J-1234" className="input tabular" />
          <p className="text-[11px] text-muted mt-1">
            The job number from the portal, so the parts land against the right work order.
          </p>
        </div>
      )}

      <div>
        <label className="label" htmlFor="note">Note for whoever fills this</label>
        <textarea id="note" name="note" rows={3} className="input resize-y" />
      </div>

      {splitNote ? (
        <p className="text-xs text-muted border-t border-line pt-3">{splitNote}</p>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}

      <Submit label="Submit order" />
      <p className="text-[11px] text-muted text-center">
        No payment is taken here — your order is invoiced on your usual terms.
      </p>
    </form>
  );
}
