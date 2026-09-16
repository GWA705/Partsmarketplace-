'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useTransition } from 'react';
import { savePart, uploadPartImage, removePartImage, type ActionState } from '../../actions';
import { PART_TAGS } from '@/lib/constants';
import { formatCents } from '@/lib/money';
import PartThumb from '@/components/PartThumb';

function Save({ label = 'Save' }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary" disabled={pending}>
      {pending ? 'Saving…' : label}
    </button>
  );
}

export interface EditablePart {
  id: string;
  code: string | null;
  name: string;
  vendor: string | null;
  costCents: number | null;
  dealerCents: number | null;
  priceOverridden: boolean;
  categoryId: string | null;
  fulfilledBy: 'HEAD_OFFICE' | 'SUPPLIER';
  active: boolean;
  tags: string[];
  fitsSkus: string[];
  hasImage: boolean;
  derivedPrice: number | null;
}

export default function PartEditor({
  part,
  categories,
}: {
  part: EditablePart;
  categories: { id: string; name: string }[];
}) {
  const [saveState, saveAction] = useFormState<ActionState, FormData>(savePart, {});
  const [photoState, photoAction] = useFormState<ActionState, FormData>(uploadPartImage, {});
  const [pending, start] = useTransition();

  return (
    <div className="grid lg:grid-cols-[260px_1fr] gap-5 items-start">
      {/* ── Photo ── */}
      <div className="card p-4 space-y-3">
        <h2 className="font-semibold text-sm">Photo</h2>
        <div className="flex justify-center py-2">
          <PartThumb partId={part.id} hasImage={part.hasImage} size={180} alt={part.name} />
        </div>

        <form action={photoAction} className="space-y-2">
          <input type="hidden" name="partId" value={part.id} />
          <input
            id="photo"
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="input text-xs py-1.5"
            aria-label="Choose a photo"
          />
          <Save label={part.hasImage ? 'Replace photo' : 'Add photo'} />
        </form>

        {part.hasImage ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => start(async () => { await removePartImage(part.id); })}
            className="text-xs text-muted hover:text-red-600 underline underline-offset-2"
          >
            Remove photo
          </button>
        ) : null}

        {photoState.error ? (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">{photoState.error}</p>
        ) : null}
        {photoState.message ? (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">{photoState.message}</p>
        ) : null}

        <p className="text-[11px] text-muted">
          Straight off a phone is fine — it is resized and re-encoded on the way in.
        </p>
      </div>

      {/* ── Everything else ── */}
      <form action={saveAction} className="card p-4 space-y-5">
        <input type="hidden" name="partId" value={part.id} />

        {/* What we pay and who we pay: internal, and this is where it lives. */}
        <section className="rounded border border-line bg-canvas p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
            Internal — never shown to dealers
          </h2>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Supplier</dt>
              <dd className="font-medium text-right">{part.vendor ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Our cost</dt>
              <dd className="font-medium tabular">{formatCents(part.costCents)}</dd>
            </div>
          </dl>
        </section>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="dealerPrice">Dealer price</label>
            <input
              id="dealerPrice"
              name="dealerPrice"
              defaultValue={
                part.priceOverridden && part.dealerCents !== null
                  ? (part.dealerCents / 100).toFixed(2)
                  : ''
              }
              placeholder={
                part.derivedPrice !== null
                  ? `${(part.derivedPrice / 100).toFixed(2)} (from markup)`
                  : 'Call for pricing'
              }
              className="input tabular"
            />
            <p className="text-[11px] text-muted mt-1">
              Leave blank to follow the markup. A number typed here survives every
              recalculation.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="categoryId">Category</label>
            <select id="categoryId" name="categoryId" defaultValue={part.categoryId ?? ''} className="input">
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="fulfilledBy">Who fills it</label>
            <select id="fulfilledBy" name="fulfilledBy" defaultValue={part.fulfilledBy} className="input">
              <option value="HEAD_OFFICE">Head office — our stock</option>
              <option value="SUPPLIER">Supplier — drop-shipped</option>
            </select>
            <p className="text-[11px] text-muted mt-1">
              Dealers see only &ldquo;ships direct&rdquo;, never who from.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="fitsSkus">Fits equipment (portal SKUs)</label>
            <input
              id="fitsSkus"
              name="fitsSkus"
              defaultValue={part.fitsSkus.join(', ')}
              placeholder="WHCCF, UV12"
              className="input tabular"
            />
            <p className="text-[11px] text-muted mt-1">
              What the portal shows a tech on a service job.
            </p>
          </div>
        </div>

        <fieldset>
          <legend className="label">Badges</legend>
          <div className="flex flex-wrap gap-3">
            {PART_TAGS.map((t) => (
              <label key={t.key} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" name={`tag_${t.key}`} defaultChecked={part.tags.includes(t.key)} />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={part.active} />
          Dealers can order this
        </label>

        {saveState.error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">{saveState.error}</p>
        ) : null}
        {saveState.ok ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</p>
        ) : null}

        <Save />
      </form>
    </div>
  );
}
