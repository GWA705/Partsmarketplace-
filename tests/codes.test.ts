import { describe, it, expect } from 'vitest';
import {
  segmentOf,
  alsoUsedForCodes,
  normalizeCode,
  parseSupersession,
} from '@/lib/codes';

describe('segmentOf', () => {
  it('reads the department or warehouse off the end of a code', () => {
    expect(segmentOf('0208W.IN')).toBe('IN');
    expect(segmentOf('10010006.SC')).toBe('SC');
    expect(segmentOf('36002018.LNDN')).toBe('LNDN');
  });

  it('returns null when a code carries no segment', () => {
    expect(segmentOf('050822W')).toBeNull();
    expect(segmentOf(null)).toBeNull();
    expect(segmentOf('')).toBeNull();
  });

  it('folds the H20 typo into H2O so it is not a separate department', () => {
    // Three seed rows spell it with a zero. Left alone they would show up in
    // the filter list as a department of their own.
    expect(segmentOf('1234.H20')).toBe('H2O');
    expect(segmentOf('1234.h2o')).toBe('H2O');
  });
});

describe('parseSupersession', () => {
  it('splits "old (USE new)" into the number on the part and the replacement', () => {
    expect(parseSupersession('36002018 (USE 400547)')).toEqual({
      code: '36002018',
      supersededBy: '400547',
    });
  });

  it('leaves an ordinary code alone', () => {
    expect(parseSupersession('0208W.IN')).toEqual({
      code: '0208W.IN',
      supersededBy: null,
    });
  });

  it('handles blanks', () => {
    expect(parseSupersession(null)).toEqual({ code: null, supersededBy: null });
  });
});

describe('alsoUsedForCodes', () => {
  it('pulls the referenced part code out of a catalogue note', () => {
    expect(alsoUsedForCodes('Also used for: WHF Replacement Parts - 150295.IN')).toEqual([
      '150295.IN',
    ]);
  });

  it('handles several references in one note', () => {
    expect(
      alsoUsedForCodes('Also used for: A - 111.SC; Also used for: B - 222.IN'),
    ).toEqual(['111.SC', '222.IN']);
  });

  it('returns nothing for a note with no reference', () => {
    expect(alsoUsedForCodes('Discontinued')).toEqual([]);
    expect(alsoUsedForCodes(null)).toEqual([]);
  });
});

describe('normalizeCode', () => {
  it('trims and upper-cases', () => {
    expect(normalizeCode('  0208w.in ')).toBe('0208W.IN');
    expect(normalizeCode('')).toBeNull();
  });
});
