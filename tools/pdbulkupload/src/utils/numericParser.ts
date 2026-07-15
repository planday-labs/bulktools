/**
 * Numeric parser utility for normalizing decimal separators.
 *
 * Handles both European (comma decimal) and US (period decimal) number formats,
 * including thousand separators. Uses a "last separator wins" heuristic when
 * both comma and period are present.
 *
 * Ambiguous case heuristic: A single separator followed by exactly 3 digits
 * (with no other separator) is treated as a thousands separator, not decimal.
 * e.g., "1,234" → 1234, "1.234" → 1234
 *
 * This is documented in field guidance text so users are aware of the behavior.
 */

/**
 * Normalize a numeric string that may use European or US decimal/thousands separators
 * into a proper JavaScript number.
 *
 * @param value - The input value (string or number)
 * @returns The parsed number, or NaN if the input is not a valid number
 *
 * @example
 * normalizeDecimal('15.50')    // 15.5
 * normalizeDecimal('15,50')    // 15.5
 * normalizeDecimal('1.234,50') // 1234.5 (European: period=thousands, comma=decimal)
 * normalizeDecimal('1,234.50') // 1234.5 (US: comma=thousands, period=decimal)
 * normalizeDecimal('1,234')    // 1234   (ambiguous: 3 digits after separator → thousands)
 * normalizeDecimal('1.234')    // 1234   (ambiguous: 3 digits after separator → thousands)
 */
export function normalizeDecimal(value: unknown): number {
  // Pass through native numbers
  if (typeof value === 'number') {
    return value;
  }

  if (value === null || value === undefined) {
    return NaN;
  }

  let str = String(value).trim();

  // Empty string
  if (str === '') {
    return NaN;
  }

  // Handle optional leading sign
  let sign = 1;
  if (str.startsWith('-')) {
    sign = -1;
    str = str.substring(1);
  } else if (str.startsWith('+')) {
    str = str.substring(1);
  }

  // After stripping sign, reject empty
  if (str === '') {
    return NaN;
  }

  // Reject adjacent repeated separators (e.g., "1..2", "1,,2")
  if (/[.,]{2,}/.test(str)) {
    return NaN;
  }

  // Remove space-based thousand separators (e.g., "1 234 567")
  str = str.replace(/\s/g, '');

  // After cleanup, must only contain digits, commas, and periods
  if (!/^[\d.,]+$/.test(str)) {
    return NaN;
  }

  const hasComma = str.includes(',');
  const hasPeriod = str.includes('.');

  if (hasComma && hasPeriod) {
    // Both separators present — "last separator wins" determines which is decimal
    const lastComma = str.lastIndexOf(',');
    const lastPeriod = str.lastIndexOf('.');

    if (lastComma > lastPeriod) {
      // European format: periods are thousands, comma is decimal (e.g., "1.234,50")
      // Validate period-based thousands grouping
      if (!isValidThousandsGrouping(str, '.', ',')) {
        return NaN;
      }
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: commas are thousands, period is decimal (e.g., "1,234.50")
      // Validate comma-based thousands grouping
      if (!isValidThousandsGrouping(str, ',', '.')) {
        return NaN;
      }
      str = str.replace(/,/g, '');
    }
  } else if (hasComma && !hasPeriod) {
    // Only commas — could be decimal or thousands
    const commaCount = (str.match(/,/g) || []).length;

    if (commaCount === 1) {
      // Single comma — check ambiguous case
      const afterComma = str.split(',')[1];
      if (afterComma.length === 3) {
        // Ambiguous: exactly 3 digits after comma → treat as thousands separator
        // Validate proper format: 1-3 digits before comma
        if (/^\d{1,3},\d{3}$/.test(str)) {
          str = str.replace(',', '');
        } else {
          return NaN;
        }
      } else {
        // Not 3 digits after comma → treat as decimal separator
        str = str.replace(',', '.');
      }
    } else {
      // Multiple commas — must be valid thousands grouping (e.g., "1,234,567")
      if (/^\d{1,3}(,\d{3})+$/.test(str)) {
        str = str.replace(/,/g, '');
      } else {
        return NaN;
      }
    }
  } else if (hasPeriod && !hasComma) {
    // Only periods — could be decimal or thousands
    const periodCount = (str.match(/\./g) || []).length;

    if (periodCount === 1) {
      // Single period — check ambiguous case
      const afterPeriod = str.split('.')[1];
      if (afterPeriod.length === 3) {
        // Ambiguous: exactly 3 digits after period → treat as thousands separator
        // Validate proper format: 1-3 digits before period
        if (/^\d{1,3}\.\d{3}$/.test(str)) {
          str = str.replace('.', '');
        } else {
          return NaN;
        }
      }
      // Otherwise it's a decimal — keep as-is (JS default)
    } else {
      // Multiple periods — must be valid thousands grouping (e.g., "1.234.567")
      if (/^\d{1,3}(\.\d{3})+$/.test(str)) {
        str = str.replace(/\./g, '');
      } else {
        return NaN;
      }
    }
  }

  // Final parse
  const result = Number(str);
  if (isNaN(result) || !isFinite(result)) {
    return NaN;
  }

  return sign * result;
}

/**
 * Validates that thousand separator grouping is correct when both separators are present.
 * The thousands separators must follow proper grouping: 1-3 digits, then groups of exactly 3.
 *
 * @param str - The full numeric string
 * @param thousandsSep - The character used as thousands separator
 * @param decimalSep - The character used as decimal separator
 */
function isValidThousandsGrouping(str: string, thousandsSep: string, decimalSep: string): boolean {
  // Split on decimal separator first
  const [integerPart] = str.split(decimalSep);

  // If no thousands separators in integer part, that's fine
  if (!integerPart.includes(thousandsSep)) {
    return true;
  }

  // Build regex for valid thousands grouping
  const escapedSep = thousandsSep === '.' ? '\\.' : thousandsSep;
  const pattern = new RegExp(`^\\d{1,3}(${escapedSep}\\d{3})+$`);
  return pattern.test(integerPart);
}
