'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { saveTaxRegistration, type ActionState } from '../actions';

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

export default function RegistrationForm({
  chargeTax,
  gstNumber,
  qstNumber,
}: {
  chargeTax: boolean;
  gstNumber: string | null;
  qstNumber: string | null;
}) {
  const [state, action] = useFormState<ActionState, FormData>(saveTaxRegistration, {});

  return (
    <form action={action} className="card p-4 space-y-4">
      <div>
        <h2 className="font-semibold">Your registration</h2>
        <p className="text-sm text-muted mt-1">
          Rates come from the ship-to province. This is who you are to the CRA, and it prints
          on every invoice that charges tax.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="gstNumber">GST/HST number</label>
        <input
          id="gstNumber"
          name="gstNumber"
          defaultValue={gstNumber ?? ''}
          placeholder="12345 6789 RT0001"
          className="input tabular"
        />
      </div>

      <div>
        <label className="label" htmlFor="qstNumber">QST number (only if registered in Quebec)</label>
        <input
          id="qstNumber"
          name="qstNumber"
          defaultValue={qstNumber ?? ''}
          placeholder="1234567890 TQ0001"
          className="input tabular"
        />
      </div>

      <label className="flex items-start gap-3 border border-line rounded p-3">
        <input type="checkbox" name="chargeTax" defaultChecked={chargeTax} className="mt-0.5" />
        <span className="text-sm">
          <span className="font-semibold">Charge tax on dealer orders</span>
          <span className="block text-muted mt-0.5">
            Worked out per order from the ship-to province. Off until your GST/HST number is
            in — an invoice charging tax without one is not a valid invoice.
          </span>
        </span>
      </label>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      {state.message ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">{state.message}</p>
      ) : null}

      <Save />
    </form>
  );
}
