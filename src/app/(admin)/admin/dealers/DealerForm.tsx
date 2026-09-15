'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createDealer, type ActionState } from '../actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Adding…' : 'Add dealer'}
    </button>
  );
}

export default function DealerForm() {
  const [state, action] = useFormState<ActionState, FormData>(createDealer, {});

  return (
    <form action={action} className="card p-4 space-y-3">
      <h2 className="font-semibold">Add a dealer</h2>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="name">Company name</label>
          <input id="name" name="name" required className="input" />
        </div>
        <div>
          <label className="label" htmlFor="code">Short code</label>
          <input id="code" name="code" placeholder="BARRIE-01" className="input tabular" />
        </div>
        <div>
          <label className="label" htmlFor="contactEmail">Contact email</label>
          <input id="contactEmail" name="contactEmail" type="email" className="input" />
        </div>
        <div>
          <label className="label" htmlFor="phone">Phone</label>
          <input id="phone" name="phone" className="input" />
        </div>
      </div>

      <fieldset className="border border-line rounded p-3 space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted px-1">
          Ship to
        </legend>
        <div className="grid sm:grid-cols-2 gap-3">
          <input name="shipAttn" placeholder="Attention" className="input" aria-label="Attention" />
          <input name="shipLine1" placeholder="Street address" className="input" aria-label="Street address" />
          <input name="shipCity" placeholder="City" className="input" aria-label="City" />
          <div className="grid grid-cols-2 gap-3">
            <input name="shipProvince" placeholder="ON" className="input" aria-label="Province" />
            <input name="shipPostal" placeholder="L4M 3A1" className="input tabular" aria-label="Postal code" />
          </div>
        </div>
      </fieldset>

      <fieldset className="border border-line rounded p-3 space-y-3">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted px-1">
          Their login (optional)
        </legend>
        <div className="grid sm:grid-cols-2 gap-3">
          <input name="contactName" placeholder="Person's name" className="input" aria-label="Contact name" />
          <input name="loginEmail" type="email" placeholder="Login email" className="input" aria-label="Login email" />
        </div>
        <input
          name="password"
          type="text"
          placeholder="Starting password (12+ characters)"
          className="input"
          aria-label="Starting password"
        />
        <p className="text-[11px] text-muted">
          Leave blank to add the company now and set up their sign-in later.
        </p>
      </fieldset>

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
