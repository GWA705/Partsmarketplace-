'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { savePricing, type ActionState } from './actions';

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Saving…' : 'Save and recalculate'}
    </button>
  );
}

export default function PricingForm({
  defaultMarkupPct,
  roundToCents,
  pricesVisibleToDealers,
  taxRatePct,
  taxNote,
  pricedParts,
  overriddenParts,
}: {
  defaultMarkupPct: number;
  roundToCents: number;
  pricesVisibleToDealers: boolean;
  taxRatePct: number;
  taxNote: string | null;
  pricedParts: number;
  overriddenParts: number;
}) {
  const [state, action] = useFormState<ActionState, FormData>(savePricing, {});

  return (
    <form action={action} className="card p-4 space-y-4">
      <div>
        <h2 className="font-semibold">Dealer pricing</h2>
        <p className="text-sm text-muted mt-1">
          The catalogue price is vendor cost. What a dealer pays is derived from it —
          set the markup here.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="defaultMarkupPct">Default markup</label>
          <div className="flex items-center gap-2">
            <input
              id="defaultMarkupPct"
              name="defaultMarkupPct"
              type="number"
              min={0}
              max={1000}
              defaultValue={defaultMarkupPct}
              className="input tabular"
            />
            <span className="text-sm text-muted">%</span>
          </div>
          <p className="text-[11px] text-muted mt-1">
            Applies to every part with no rule and no hand-set price.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="roundToCents">Round to</label>
          <div className="flex items-center gap-2">
            <input
              id="roundToCents"
              name="roundToCents"
              type="number"
              min={1}
              max={500}
              defaultValue={roundToCents}
              className="input tabular"
            />
            <span className="text-sm text-muted">cents</span>
          </div>
          <p className="text-[11px] text-muted mt-1">5 rounds to the nickel, 100 to the dollar.</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 border-t border-line pt-4">
        <div>
          <label className="label" htmlFor="taxRatePct">Sales tax on invoices</label>
          <div className="flex items-center gap-2">
            <input
              id="taxRatePct"
              name="taxRatePct"
              type="number"
              min={0}
              max={100}
              defaultValue={taxRatePct}
              className="input tabular"
            />
            <span className="text-sm text-muted">%</span>
          </div>
          <p className="text-[11px] text-muted mt-1">
            0 shows no tax line at all. Ontario HST is 13 — but a resale-exempt dealer is 0,
            which is why nothing is assumed here.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="taxNote">Tax registration line</label>
          <input
            id="taxNote"
            name="taxNote"
            defaultValue={taxNote ?? ''}
            placeholder="HST #12345 6789 RT0001"
            className="input"
          />
          <p className="text-[11px] text-muted mt-1">Printed under the tax line on an invoice.</p>
        </div>
      </div>

      <label className="flex items-start gap-3 border border-line rounded p-3">
        <input
          type="checkbox"
          name="pricesVisibleToDealers"
          defaultChecked={pricesVisibleToDealers}
          className="mt-0.5"
        />
        <span className="text-sm">
          <span className="font-semibold">Show prices to dealers</span>
          <span className="block text-muted mt-0.5">
            While this is off, dealers see &ldquo;call for pricing&rdquo; instead of a derived
            number, and can still order. Leave it off until the markup above is the real one —
            a number nobody has confirmed should not be quoted as though it were.
          </span>
        </span>
      </label>

      <p className="text-xs text-muted">
        {pricedParts.toLocaleString('en-CA')} parts have a cost to mark up.
        {overriddenParts > 0
          ? ` ${overriddenParts.toLocaleString('en-CA')} have a hand-set price and will not be touched.`
          : ''}
      </p>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      {state.message ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{state.message}</p> : null}

      <Submit />
    </form>
  );
}
