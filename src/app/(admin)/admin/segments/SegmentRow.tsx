'use client';

import { useState, useTransition } from 'react';
import { nameSegment } from '../actions';
import type { CodeSegmentKind } from '@prisma/client';

/**
 * Naming one code segment.
 *
 * This screen is how 999 uncategorized parts become navigable: the suffix on a
 * part number is either a department or a warehouse, and once each one has a
 * name the dealer's filter list reads in English instead of in codes.
 */
export default function SegmentRow({
  code,
  kind,
  label,
  confirmed,
  count,
}: {
  code: string;
  kind: CodeSegmentKind;
  label: string | null;
  confirmed: boolean;
  count: number;
}) {
  const [k, setK] = useState<CodeSegmentKind>(kind);
  const [l, setL] = useState(label ?? '');
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      await nameSegment(code, k, l);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });

  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-3 py-2 tabular font-semibold w-24">{code}</td>
      <td className="px-3 py-2 w-24 text-right tabular text-muted">{count}</td>
      <td className="px-3 py-2 w-40">
        <select
          value={k}
          onChange={(e) => setK(e.target.value as CodeSegmentKind)}
          className="input py-1 text-xs"
          aria-label={`What kind of code ${code} is`}
        >
          <option value="UNKNOWN">Not sure yet</option>
          <option value="DEPARTMENT">Department</option>
          <option value="WAREHOUSE">Warehouse</option>
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          value={l}
          onChange={(e) => setL(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder="What dealers should see, e.g. Softeners, or London"
          className="input py-1 text-sm"
          aria-label={`Name for ${code}`}
        />
      </td>
      <td className="px-3 py-2 w-28 text-right">
        <button type="button" onClick={save} disabled={pending} className="btn py-1 px-2 text-xs">
          {saved ? 'Saved' : pending ? '…' : 'Save'}
        </button>
      </td>
      <td className="px-2 py-2 w-8 text-center">
        {confirmed ? <span title="Named" className="text-emerald-600">●</span> : null}
      </td>
    </tr>
  );
}
