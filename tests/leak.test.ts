import { describe, it, expect } from 'vitest';
import { dealerPartSelect, staffPartSelect, fillerLabel, forDealer } from '@/lib/partSelect';

/**
 * The two columns that stay on our side of the counter.
 *
 * `costCents` is our margin; `vendor` is our supplier list. A dealer who can
 * read either one off a row has something they can act on, so neither may be
 * expressible in a dealer query. These tests are cheap insurance against
 * somebody adding a field back to the select in a hurry.
 */
describe('dealerPartSelect', () => {
  it('cannot select our cost', () => {
    expect('costCents' in dealerPartSelect).toBe(false);
  });

  it('cannot select the supplier', () => {
    expect('vendor' in dealerPartSelect).toBe(false);
  });

  it('still carries everything a dealer orders from', () => {
    // Item number, description, photo, price — plus the alternate code,
    // because the price list and the catalogue disagree on 137 parts.
    for (const field of [
      'code',
      'catalogueCode',
      'name',
      'catalogueName',
      'imageStorageKey',
      'dealerCents',
      'unit',
    ]) {
      expect(dealerPartSelect).toHaveProperty(field, true);
    }
  });
});

describe('staffPartSelect', () => {
  it('is where cost and supplier live', () => {
    expect(staffPartSelect).toHaveProperty('costCents', true);
    expect(staffPartSelect).toHaveProperty('vendor', true);
  });
});

describe('fillerLabel', () => {
  it('never names the supplier to a dealer', () => {
    expect(fillerLabel('SUPPLIER', 'Watergroup', 'DEALER')).toBe('Ships direct');
    expect(fillerLabel('SUPPLIER', 'RespirAide Tech Inc.', 'DEALER')).toBe('Ships direct');
  });

  it('names it to staff, who need it to chase the order', () => {
    expect(fillerLabel('SUPPLIER', 'Watergroup', 'STAFF')).toBe('Watergroup');
  });

  it('calls our own stock head office for both', () => {
    expect(fillerLabel('HEAD_OFFICE', null, 'DEALER')).toBe('Head office');
    expect(fillerLabel('HEAD_OFFICE', null, 'STAFF')).toBe('Head office');
  });

  it('does not fall back to a blank when a supplier has no name on file', () => {
    expect(fillerLabel('SUPPLIER', null, 'STAFF')).toBe('Supplier');
    expect(fillerLabel('SUPPLIER', '', 'DEALER')).toBe('Ships direct');
  });
});

describe('forDealer', () => {
  it('strips both internal columns from a hand-built payload', () => {
    const row = { id: 'p1', code: '0208W.IN', costCents: 476, vendor: 'Watergroup' };
    const out = forDealer(row);
    expect(out).toEqual({ id: 'p1', code: '0208W.IN' });
    expect(JSON.stringify(out)).not.toMatch(/Watergroup|476/);
  });
});
