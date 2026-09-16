import { describe, it, expect } from 'vitest';
import { PDFParse } from 'pdf-parse';
import { buildInvoice, buildPickList, buildPackingSlip, type DocOrder } from '@/lib/documents';

/**
 * The three documents one order produces.
 *
 * Each is read by a different person doing a different job, and what must NOT
 * be on each one matters as much as what is: a supplier must not see the
 * dealer's price, a dealer must not see the supplier, and a carton going to a
 * dealer's own customer must not carry money at all.
 */

/** Read a generated PDF back as text, so assertions are about what prints. */
async function read(buf: Buffer): Promise<{ text: string; pages: number }> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const res = await parser.getText();
    return { text: res.text.replace(/\s+/g, ' '), pages: res.pages?.length ?? 1 };
  } finally {
    await parser.destroy();
  }
}

const text = async (buf: Buffer) => (await read(buf)).text;

const order: DocOrder = {
  orderNumber: 'PO-1042',
  submittedAt: new Date('2026-09-16T14:00:00Z'),
  rush: false,
  customerName: 'Demo Dealer Co.',
  customerCode: 'DEMO-01',
  placedBy: 'Sean Dealer',
  shippingMethod: 'Standard ground',
  note: 'Needed for a Thursday install in Orillia.',
  shipTo: {
    name: 'Parts Desk',
    lines: ['12 Bayfield St', 'Barrie ON L4M 3A1', 'Canada'],
    phone: '705-555-0100',
  },
  billTo: {
    name: 'Accounts Payable',
    lines: ['PO Box 41', 'Orillia ON L3V 6J3', 'Canada'],
    email: 'ap@demo-dealer.test',
  },
  fulfilledByLabel: 'Head office',
  lines: [
    { code: '0208W.IN', altCode: '0208W.H2O', name: 'JG 1/4 Union Tee', unit: 'each (ea)', quantity: 6, unitCents: 643, location: 'Install Parts' },
    { code: '6001.HD', name: 'HD APRONS', unit: 'each (ea)', quantity: 2, unitCents: 2700, location: 'Home Depot' },
    { code: '012.H2O', name: 'TDS Meters', unit: null, quantity: 1, unitCents: 2700, location: 'Water Treatment' },
  ],
  taxLines: [{ label: 'HST 13%', amountCents: 9065 }],
  taxNumbers: ['GST/HST 12345 6789 RT0001'],
};

describe('invoice', () => {
  it('carries both addresses, the customer and the shipping method', async () => {
    const t = await text(await buildInvoice(order, { priced: true }));
    expect(t).toContain('BILL TO');
    expect(t).toContain('Accounts Payable');
    expect(t).toContain('PO Box 41');
    expect(t).toContain('SHIP TO');
    expect(t).toContain('12 Bayfield St');
    expect(t).toContain('Demo Dealer Co.');
    expect(t).toContain('DEMO-01');
    expect(t).toContain('Standard ground');
    expect(t).toContain('PO-1042');
  });

  it('totals the lines and applies the tax rate', async () => {
    const t = await text(await buildInvoice(order, { priced: true }));
    // 6 x 6.43 + 2 x 27.00 + 1 x 27.00 = 119.58; +13% = 135.13
    expect(t).toContain('$119.58');
    expect(t).toContain('HST 13%');
    expect(t).toContain('$90.65');
    expect(t).toContain('$210.23');
    expect(t).toContain('GST/HST 12345 6789 RT0001');
  });

  it('shows no tax line at all when nothing is charged', async () => {
    const t = await text(await buildInvoice({ ...order, taxLines: [] }, { priced: true }));
    expect(t).not.toContain('HST');
    expect(t).toContain('$119.58');
  });

  it('prints GST and PST as separate lines where they are separate taxes', async () => {
    const bc = {
      ...order,
      taxLines: [
        { label: 'GST 5%', amountCents: 598 },
        { label: 'PST 7%', amountCents: 837 },
      ],
    };
    const t = await text(await buildInvoice(bc, { priced: true }));
    expect(t).toContain('GST 5%');
    expect(t).toContain('PST 7%');
    expect(t).toContain('$5.98');
    expect(t).toContain('$8.37');
    // 119.58 + 5.98 + 8.37
    expect(t).toContain('$133.93');
  });

  it('prints as an unpriced confirmation when pricing is not settled', async () => {
    const t = await text(await buildInvoice(order, { priced: false }));
    expect(t).toContain('ORDER CONFIRMATION');
    expect(t).toContain('0208W.IN');
    expect(t).not.toContain('$119.58');
    expect(t).not.toContain('AMOUNT');
  });

  it('says how many lines are unpriced rather than totalling them as free', async () => {
    const mixed = {
      ...order,
      lines: [order.lines[0], { ...order.lines[1], unitCents: null }],
    };
    const t = await text(await buildInvoice(mixed, { priced: true }));
    expect(t).toMatch(/1 line\(s\) not yet priced/);
  });

  it('shouts when the order is a rush', async () => {
    const t = await text(await buildInvoice({ ...order, rush: true }, { priced: true }));
    expect(t).toContain('RUSH ORDER');
  });
});

describe('pick list', () => {
  it('groups the walk by location', async () => {
    const t = await text(await buildPickList(order));
    expect(t).toContain('HOME DEPOT');
    expect(t).toContain('INSTALL PARTS');
    expect(t).toContain('WATER TREATMENT');
  });

  it('carries the quantity with its unit, so six cases are not picked as six pieces', async () => {
    const t = await text(await buildPickList(order));
    expect(t).toMatch(/6 each \(ea\)/);
  });

  it('shows the other number that might be on the box', async () => {
    const t = await text(await buildPickList(order));
    expect(t).toContain('0208W.IN');
    expect(t).toContain('0208W.H2O');
  });

  it('has somewhere to sign it off', async () => {
    const t = await text(await buildPickList(order));
    expect(t).toContain('PICKED BY');
    expect(t).toContain('CHECKED BY');
    expect(t).toContain('SHORT / SUB');
  });

  it('carries no money — the picker does not need it and a supplier must not see it', async () => {
    const t = await text(await buildPickList({ ...order, lines: order.lines.map((l) => ({ ...l, unitCents: null })) }));
    expect(t).not.toMatch(/\$\d/);
  });

  it('carries the order note through to the floor', async () => {
    const t = await text(await buildPickList(order));
    expect(t).toContain('Thursday install in Orillia');
  });

  it('shouts when the order is a rush', async () => {
    const t = await text(await buildPickList({ ...order, rush: true }));
    expect(t).toContain('RUSH ORDER');
  });
});

describe('packing slip', () => {
  it('says what is in the box and where it is going, with no money', async () => {
    const t = await text(await buildPackingSlip({ ...order, lines: order.lines.map((l) => ({ ...l, unitCents: null })) }));
    expect(t).toContain('SHIP TO');
    expect(t).toContain('0208W.IN');
    expect(t).toContain('Total pieces: 9');
    expect(t).not.toMatch(/\$\d/);
  });
});

describe('long orders', () => {
  const many: DocOrder = {
    ...order,
    lines: Array.from({ length: 140 }, (_, i) => ({
      code: `CODE-${i}`,
      name: `A part with a reasonably long description ${i}`,
      unit: 'each (ea)',
      quantity: i + 1,
      unitCents: 1234,
      location: ['Softeners', 'Air Systems', 'Retail'][i % 3],
    })),
  };

  it('pages the invoice rather than running off the sheet', async () => {
    const parsed = await read(await buildInvoice(many, { priced: true }));
    expect(parsed.pages).toBeGreaterThan(2);
    expect(parsed.text).toContain('CODE-139');
  });

  it('pages the pick list and keeps every line', async () => {
    const parsed = await read(await buildPickList(many));
    expect(parsed.pages).toBeGreaterThan(2);
    expect(parsed.text).toContain('CODE-0');
    expect(parsed.text).toContain('CODE-139');
  });
});
