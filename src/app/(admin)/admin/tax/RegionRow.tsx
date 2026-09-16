'use client';

import { useState, useTransition } from 'react';
import { saveTaxRegion } from '../actions';
import { ratePct } from '@/lib/tax';

/**
 * One province.
 *
 * Rates are entered as percentages and stored in thousandths of a percent, so
 * Quebec's 9.975 survives the round trip exactly.
 */
export default function RegionRow({
  code,
  label,
  hstThou,
  gstThou,
  provincialThou,
  provincialLabel,
  collectProvincial,
  note,
}: {
  code: string;
  label: string;
  hstThou: number | null;
  gstThou: number | null;
  provincialThou: number | null;
  provincialLabel: string | null;
  collectProvincial: boolean;
  note: string | null;
}) {
  const asPct = (thou: number | null) => (thou === null ? '' : String(thou / 1000));
  const [hst, setHst] = useState(asPct(hstThou));
  const [gst, setGst] = useState(asPct(gstThou));
  const [prov, setProv] = useState(asPct(provincialThou));
  const [collect, setCollect] = useState(collectProvincial);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const toThou = (v: string) => (v.trim() === '' ? null : Math.round(Number(v) * 1000));

  const save = (nextCollect = collect) =>
    start(async () => {
      await saveTaxRegion(code, {
        hstThou: toThou(hst),
        gstThou: toThou(gst),
        provincialThou: toThou(prov),
        collectProvincial: nextCollect,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });

  const harmonised = hstThou !== null;
  const total =
    (toThou(hst) ?? 0) + (toThou(gst) ?? 0) + (collect ? (toThou(prov) ?? 0) : 0);

  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-3 py-2">
        <div className="font-medium">{label}</div>
        <div className="tabular text-[11px] text-muted">{code}</div>
      </td>

      <td className="px-2 py-2 w-24">
        {harmonised ? (
          <input
            value={hst}
            onChange={(e) => setHst(e.target.value)}
            onBlur={() => save()}
            aria-label={`HST rate for ${label}`}
            className="input py-1 text-xs tabular text-right"
          />
        ) : (
          <span className="text-muted text-xs">—</span>
        )}
      </td>

      <td className="px-2 py-2 w-24">
        {harmonised ? (
          <span className="text-muted text-xs">—</span>
        ) : (
          <input
            value={gst}
            onChange={(e) => setGst(e.target.value)}
            onBlur={() => save()}
            aria-label={`GST rate for ${label}`}
            className="input py-1 text-xs tabular text-right"
          />
        )}
      </td>

      <td className="px-2 py-2 w-28">
        {provincialThou === null ? (
          <span className="text-muted text-xs">—</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              value={prov}
              onChange={(e) => setProv(e.target.value)}
              onBlur={() => save()}
              aria-label={`${provincialLabel} rate for ${label}`}
              className="input py-1 text-xs tabular text-right w-16"
            />
            <span className="text-[11px] text-muted">{provincialLabel}</span>
          </div>
        )}
      </td>

      <td className="px-2 py-2 w-32 text-center">
        {provincialThou === null ? (
          <span className="text-muted text-xs">n/a</span>
        ) : (
          <label className="inline-flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={collect}
              disabled={pending}
              onChange={(e) => {
                setCollect(e.target.checked);
                save(e.target.checked);
              }}
            />
            registered
          </label>
        )}
      </td>

      <td className="px-3 py-2 w-24 text-right">
        <span className="tabular font-semibold text-sm">{ratePct(total)}</span>
        {saved ? <span className="block text-[10px] text-emerald-600">saved</span> : null}
        {note ? <span className="block text-[10px] text-muted">{note}</span> : null}
      </td>
    </tr>
  );
}
