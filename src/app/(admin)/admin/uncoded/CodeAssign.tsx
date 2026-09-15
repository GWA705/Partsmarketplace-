'use client';

import { useState, useTransition } from 'react';
import { updatePart } from '../actions';

export default function CodeAssign({ partId }: { partId: string }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  const save = () => {
    if (!code.trim()) return;
    setError(null);
    start(async () => {
      const res = await updatePart(partId, { code: code.trim() });
      if (res.error) setError(res.error);
      else setDone(true);
    });
  };

  if (done) {
    return <span className="text-xs text-emerald-700 dark:text-emerald-400">Coded — now orderable</span>;
  }

  return (
    <div>
      <div className="flex gap-1.5">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
          placeholder="Item code"
          aria-label="Item code"
          className="input py-1 text-xs tabular"
        />
        <button type="button" onClick={save} disabled={pending} className="btn py-1 px-2 text-xs">
          {pending ? '…' : 'Save'}
        </button>
      </div>
      {error ? <p className="text-[11px] text-red-600 mt-0.5">{error}</p> : null}
    </div>
  );
}
