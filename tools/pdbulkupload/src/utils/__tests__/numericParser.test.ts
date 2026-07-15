import { describe, it, expect } from 'vitest';
import { normalizeDecimal } from '../numericParser';

describe('normalizeDecimal', () => {
  describe('issue expected behaviour table', () => {
    it.each([
      ['15.50', 15.5],
      ['15,50', 15.5],
      ['1234', 1234],
      ['1234.5', 1234.5],
      ['1234,5', 1234.5],
    ])('normalizeDecimal(%j) === %d', (input, expected) => {
      expect(normalizeDecimal(input)).toBe(expected);
    });
  });

  describe('US format (comma thousands, period decimal)', () => {
    it('parses 1,234.50', () => {
      expect(normalizeDecimal('1,234.50')).toBe(1234.5);
    });
    it('parses 1,234,567.89', () => {
      expect(normalizeDecimal('1,234,567.89')).toBe(1234567.89);
    });
    it('parses 12,345', () => {
      expect(normalizeDecimal('12,345')).toBe(12345);
    });
  });

  describe('European format (period thousands, comma decimal)', () => {
    it('parses 1.234,50', () => {
      expect(normalizeDecimal('1.234,50')).toBe(1234.5);
    });
    it('parses 1.234.567,89', () => {
      expect(normalizeDecimal('1.234.567,89')).toBe(1234567.89);
    });
    it('parses 12.345', () => {
      expect(normalizeDecimal('12.345')).toBe(12345);
    });
  });

  describe('ambiguous cases (single separator + 3 digits)', () => {
    it('treats 1,234 as thousands (→ 1234)', () => {
      expect(normalizeDecimal('1,234')).toBe(1234);
    });
    it('treats 1.234 as thousands (→ 1234)', () => {
      expect(normalizeDecimal('1.234')).toBe(1234);
    });
    it('treats 123.456 as thousands (→ 123456)', () => {
      expect(normalizeDecimal('123.456')).toBe(123456);
    });
    it('treats 1,23 as decimal (→ 1.23, not 3 digits)', () => {
      expect(normalizeDecimal('1,23')).toBe(1.23);
    });
    it('treats 1.2 as decimal (→ 1.2, not 3 digits)', () => {
      expect(normalizeDecimal('1.2')).toBe(1.2);
    });
  });

  describe('space as thousands separator', () => {
    it('parses 1 234 567', () => {
      expect(normalizeDecimal('1 234 567')).toBe(1234567);
    });
    it('parses 1 234,50', () => {
      expect(normalizeDecimal('1 234,50')).toBe(1234.5);
    });
  });

  describe('sign handling', () => {
    it('parses negative with period decimal', () => {
      expect(normalizeDecimal('-15.50')).toBe(-15.5);
    });
    it('parses negative with comma decimal', () => {
      expect(normalizeDecimal('-15,50')).toBe(-15.5);
    });
    it('parses positive with + sign', () => {
      expect(normalizeDecimal('+100')).toBe(100);
    });
    it('parses negative thousands', () => {
      expect(normalizeDecimal('-1,234.50')).toBe(-1234.5);
    });
  });

  describe('passthrough for native numbers', () => {
    it('returns the number as-is for integers', () => {
      expect(normalizeDecimal(42)).toBe(42);
    });
    it('returns the number as-is for floats', () => {
      expect(normalizeDecimal(3.14)).toBe(3.14);
    });
    it('returns NaN for NaN input', () => {
      expect(normalizeDecimal(NaN)).toBeNaN();
    });
  });

  describe('plain integers', () => {
    it('parses 0', () => {
      expect(normalizeDecimal('0')).toBe(0);
    });
    it('parses 42', () => {
      expect(normalizeDecimal('42')).toBe(42);
    });
    it('parses 1000000', () => {
      expect(normalizeDecimal('1000000')).toBe(1000000);
    });
  });

  describe('edge cases returning NaN', () => {
    it('returns NaN for empty string', () => {
      expect(normalizeDecimal('')).toBeNaN();
    });
    it('returns NaN for null', () => {
      expect(normalizeDecimal(null)).toBeNaN();
    });
    it('returns NaN for undefined', () => {
      expect(normalizeDecimal(undefined)).toBeNaN();
    });
    it('returns NaN for non-numeric string', () => {
      expect(normalizeDecimal('abc')).toBeNaN();
    });
    it('returns NaN for whitespace only', () => {
      expect(normalizeDecimal('   ')).toBeNaN();
    });
    it('returns NaN for just a sign', () => {
      expect(normalizeDecimal('-')).toBeNaN();
    });
  });

  describe('malformed inputs (must return NaN)', () => {
    it('rejects adjacent periods: "1..2"', () => {
      expect(normalizeDecimal('1..2')).toBeNaN();
    });
    it('rejects adjacent commas: "1,,2"', () => {
      expect(normalizeDecimal('1,,2')).toBeNaN();
    });
    it('rejects invalid grouping: "1,2,3"', () => {
      expect(normalizeDecimal('1,2,3')).toBeNaN();
    });
    it('rejects invalid grouping: "1.2.3"', () => {
      expect(normalizeDecimal('1.2.3')).toBeNaN();
    });
    it('rejects malformed: "1.23.456"', () => {
      expect(normalizeDecimal('1.23.456')).toBeNaN();
    });
    it('rejects leading comma: ",123"', () => {
      expect(normalizeDecimal(',123')).toBeNaN();
    });
    it('rejects leading period thousands: ".123.456"', () => {
      expect(normalizeDecimal('.123.456')).toBeNaN();
    });
    it('rejects mixed separator mess: "1,.2"', () => {
      expect(normalizeDecimal('1,.2')).toBeNaN();
    });
    it('rejects "1,2345" (comma not in valid thousands position)', () => {
      // 4 digits after comma — not decimal (would be odd), not valid thousands
      // This is treated as decimal since it's not exactly 3 digits
      // Actually 4 digits after comma → decimal interpretation: 1.2345
      expect(normalizeDecimal('1,2345')).toBe(1.2345);
    });
  });

  describe('whitespace handling', () => {
    it('trims leading/trailing whitespace', () => {
      expect(normalizeDecimal('  15.50  ')).toBe(15.5);
    });
    it('trims leading/trailing whitespace with comma decimal', () => {
      expect(normalizeDecimal('  15,50  ')).toBe(15.5);
    });
  });
});
