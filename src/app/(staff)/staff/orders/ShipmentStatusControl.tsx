'use client';

import { useTransition } from 'react';
import { setShipmentStatus } from './actions';
import type { ShipmentStatus } from '@prisma/client';

const OPTIONS: ShipmentStatus[] = ['SUBMITTED', 'ACKNOWLEDGED', 'FULFILLED', 'CANCELLED'];

export default function ShipmentStatusControl({
  shipmentId,
  status,
}: {
  shipmentId: string;
  status: ShipmentStatus;
}) {
  const [pending, start] = useTransition();
  return (
    <select
      className="input py-1 px-2 text-xs w-36"
      defaultValue={status}
      disabled={pending}
      aria-label="Shipment status"
      onChange={(e) =>
        start(async () => {
          await setShipmentStatus(shipmentId, e.target.value as ShipmentStatus);
        })
      }
    >
      {OPTIONS.map((o) => (
        <option key={o} value={o}>
          {o.toLowerCase()}
        </option>
      ))}
    </select>
  );
}
