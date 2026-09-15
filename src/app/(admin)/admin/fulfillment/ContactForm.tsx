'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { setFulfillmentContact, type ActionState } from '../actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Saving…' : 'Save contact'}
    </button>
  );
}

export default function ContactForm({ parties }: { parties: string[] }) {
  const [state, action] = useFormState<ActionState, FormData>(setFulfillmentContact, {});

  return (
    <form action={action} className="card p-4 space-y-3">
      <h2 className="font-semibold">Set a contact</h2>
      <p className="text-sm text-muted">
        Where the pick list goes when an order includes parts this party fills.
      </p>

      <div>
        <label className="label" htmlFor="party">Filled by</label>
        <select id="party" name="party" required className="input" defaultValue="">
          <option value="" disabled>Choose…</option>
          {parties.map((p) => (
            <option key={p} value={p}>{p === 'HEAD_OFFICE' ? 'Head office' : p}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required className="input" />
      </div>

      <div>
        <label className="label" htmlFor="ccEmail">CC (optional)</label>
        <input id="ccEmail" name="ccEmail" type="email" className="input" />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      {state.message ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">{state.message}</p>
      ) : null}

      <Submit />
    </form>
  );
}
