/**
 * Comprehensive Date Parser for Excel Import
 * Handles all common date formats with smart auto-detection
 * Only operates on fields mapped to date fields
 * Asks user only when truly ambiguous
 */
export class DateParser {
  private static userDateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | null = null;
  
  /**
   * Set user's preferred date format for ambiguous cases
   */
  static setUserDateFormat(format: 'DD/MM/YYYY' | 'MM/DD/YYYY'): void {
    this.userDateFormat = format;
    console.log(`📅 User date format set to: ${format}`);
  }
  
  /**
   * Reset user date format (for new uploads)
   */
  static resetUserDateFormat(): void {
    this.userDateFormat = null;
  }
  
  /**
   * Convert a raw Excel date serial number to an ISO (YYYY-MM-DD) string.
   *
   * Used for "General"/Number-formatted cells that hold a date as a bare serial
   * (e.g. 46113 → 2026-04-01). The month/day order is unambiguous, so these never
   * need the format picker. Returns null for values outside the valid Excel range.
   *
   * The 25569 offset is the Excel serial for 1970-01-01 and already bakes in the
   * Excel 1900 leap-year bug for all serials past 1900-02-28, so it is correct for
   * every real-world employee date. The 1904 system shifts the epoch by 1462 days.
   */
  static excelSerialToISO(serial: number, date1904 = false): string | null {
    const minSerial = date1904 ? 0 : 1;
    if (!Number.isFinite(serial) || serial < minSerial || serial > 2958465) {
      return null;
    }

    // 1900 mode: serial 60 is Excel's fictitious 1900-02-29 (the leap-year bug)
    // and has no real date; serials 1..59 predate it, so shift the epoch back a
    // day. The 25569 offset (1970-01-01) is correct from serial 61 onward.
    if (!date1904 && serial === 60) {
      return null;
    }

    const epochOffset = date1904 ? 24107 : (serial < 60 ? 25568 : 25569);
    const ms = Math.round((serial - epochOffset) * 86400000);
    const date = new Date(ms);

    if (isNaN(date.getTime())) {
      return null;
    }

    // Use UTC getters: the serial maps to a UTC-midnight instant, so UTC parts
    // give the intended calendar date in every timezone.
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Check if a value could be a date in any supported format
   */
  static couldBeDate(value: string): boolean {
    const trimmed = value.trim();
    
    // All supported date patterns
    const patterns = [
      /^\d{4}-\d{1,2}-\d{1,2}$/,          // YYYY-MM-DD, YYYY-M-D
      /^\d{4}\/\d{1,2}\/\d{1,2}$/,        // YYYY/MM/DD, YYYY/M/D
      /^\d{4}\.\d{1,2}\.\d{1,2}$/,        // YYYY.MM.DD, YYYY.M.D
      /^\d{1,2}\/\d{1,2}\/\d{4}$/,        // MM/DD/YYYY, M/D/YYYY, DD/MM/YYYY, D/M/YYYY
      /^\d{1,2}-\d{1,2}-\d{4}$/,          // MM-DD-YYYY, M-D-YYYY, DD-MM-YYYY, D-M-YYYY
      /^\d{1,2}\.\d{1,2}\.\d{4}$/,        // MM.DD.YYYY, M.D.YYYY, DD.MM.YYYY, D.M.YYYY
      /^\d{1,2}\/\d{1,2}\/\d{2}$/,        // MM/DD/YY, M/D/YY, DD/MM/YY, D/M/YY
      /^\d{1,2}-\d{1,2}-\d{2}$/,          // MM-DD-YY, M-D-YY, DD-MM-YY, D-M-YY
      /^\d{1,2}\.\d{1,2}\.\d{2}$/,        // MM.DD.YY, M.D.YY, DD.MM.YY, D.M.YY
      /^\d{8}$/,                          // YYYYMMDD, DDMMYYYY, MMDDYYYY
      /^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}$/i, // 24 Jun 1974
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}$/i, // Jun 24, 1974
    ];
    
    return patterns.some(pattern => pattern.test(trimmed));
  }
  
  /**
   * Detect if a date format can be auto-determined by scanning for unambiguous dates
   * Returns detected format or null if ambiguous
   */
  static detectDateFormat(dateValues: string[]): 'DD/MM/YYYY' | 'MM/DD/YYYY' | null {
    for (const dateStr of dateValues) {
      const trimmed = dateStr.trim();
      
      // Check slash-separated dates for auto-detection
      const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (slashMatch) {
        const [, first, second] = slashMatch;
        const firstNum = parseInt(first, 10);
        const secondNum = parseInt(second, 10);
        
        // If first number > 12, must be DD/MM format
        if (firstNum > 12) {
          return 'DD/MM/YYYY';
        }
        // If second number > 12, must be MM/DD format
        else if (secondNum > 12) {
          return 'MM/DD/YYYY';
        }
      }
      
      // Check dash-separated dates for auto-detection
      const dashMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
      if (dashMatch) {
        const [, first, second] = dashMatch;
        const firstNum = parseInt(first, 10);
        const secondNum = parseInt(second, 10);
        
        if (firstNum > 12) {
          return 'DD/MM/YYYY';
        } else if (secondNum > 12) {
          return 'MM/DD/YYYY';
        }
      }
      
      // Check dot-separated dates for auto-detection
      const dotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
      if (dotMatch) {
        const [, first, second] = dotMatch;
        const firstNum = parseInt(first, 10);
        const secondNum = parseInt(second, 10);
        
        if (firstNum > 12) {
          return 'DD/MM/YYYY';
        } else if (secondNum > 12) {
          return 'MM/DD/YYYY';
        }
      }
    }
    
    return null; // Could not auto-detect
  }
  
  /**
   * Find ambiguous dates that need user clarification
   * Returns array of sample ambiguous date values
   */
  static findAmbiguousDates(dateValues: string[]): string[] {
    const ambiguous = new Set<string>();
    
    for (const dateStr of dateValues) {
      const trimmed = dateStr.trim();
      
      // Check 8-digit dates for ambiguity
      if (/^\d{8}$/.test(trimmed)) {
        const validFormats = this.getValid8DigitFormats(trimmed);
        if (validFormats.length > 1) {
          // Check if the different interpretations actually give different dates
          const dates = validFormats.map(f => `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`);
          const uniqueDates = new Set(dates);
          if (uniqueDates.size > 1) {
            ambiguous.add(trimmed);
          }
        }
      }
      
      // Check slash/dash/dot separated dates where both numbers <= 12
      const separatorMatch = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
      if (separatorMatch) {
        const [, first, second] = separatorMatch;
        const firstNum = parseInt(first, 10);
        const secondNum = parseInt(second, 10);
        
        // Only ambiguous if both are <= 12 and different
        if (firstNum <= 12 && secondNum <= 12 && firstNum !== secondNum) {
          ambiguous.add(trimmed);
        }
      }
      
      // Check YYYY-first dates for MM/DD vs DD/MM ambiguity
      const yyyyFirstMatch = trimmed.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
      if (yyyyFirstMatch) {
        const [, , first, second] = yyyyFirstMatch;
        const firstNum = parseInt(first, 10);
        const secondNum = parseInt(second, 10);
        
        // Only ambiguous if both are <= 12 and different
        if (firstNum <= 12 && secondNum <= 12 && firstNum !== secondNum) {
          ambiguous.add(trimmed);
        }
      }
    }
    
    return Array.from(ambiguous).slice(0, 5); // Max 5 samples
  }
  
  /**
   * Parse a date string to ISO format (YYYY-MM-DD)
   * Uses smart detection and user preferences
   */
  static parseToISO(dateStr: string): string | null {
    const trimmed = dateStr.trim();
    
    if (!trimmed) return null;
    
    // Already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    
    // Handle YYYY-M-D format (pad to YYYY-MM-DD)
    const yyyyMdMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (yyyyMdMatch) {
      const [, year, month, day] = yyyyMdMatch;
      const paddedMonth = month.padStart(2, '0');
      const paddedDay = day.padStart(2, '0');
      
      if (this.isValidDateParts(parseInt(year), parseInt(month), parseInt(day))) {
        return `${year}-${paddedMonth}-${paddedDay}`;
      }
    }
    
    // Handle 8-digit formats
    if (/^\d{8}$/.test(trimmed)) {
      return this.parse8DigitDate(trimmed);
    }
    
    // Handle YYYY/MM/DD and YYYY.MM.DD formats (unambiguous)
    const yyyyFirstMatch = trimmed.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
    if (yyyyFirstMatch) {
      const [, year, month, day] = yyyyFirstMatch;
      const paddedMonth = month.padStart(2, '0');
      const paddedDay = day.padStart(2, '0');
      
      if (this.isValidDateParts(parseInt(year), parseInt(month), parseInt(day))) {
        return `${year}-${paddedMonth}-${paddedDay}`;
      }
    }
    
    // Handle separator-based dates (DD/MM/YYYY, MM/DD/YYYY, etc.)
    const separatorMatch = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
    if (separatorMatch) {
      return this.parseSeparatorDate(separatorMatch);
    }
    
    // Handle named month formats via Date constructor
    try {
      const date = new Date(trimmed + ' UTC');
      if (!isNaN(date.getTime())) {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    } catch {
      // Fallback failed
    }

    return null;
  }


  /**
   * Parse separator-based dates with smart detection
   */
  private static parseSeparatorDate(match: RegExpMatchArray): string | null {
    const [, first, second, year] = match;
    const firstNum = parseInt(first, 10);
    const secondNum = parseInt(second, 10);
    
    // Convert 2-digit years to 4-digit
    let fullYear = year;
    if (year.length === 2) {
      const yearNum = parseInt(year, 10);
      // Assume 00-30 means 2000-2030, 31-99 means 1931-1999
      fullYear = (yearNum <= 30 ? 2000 + yearNum : 1900 + yearNum).toString();
    }
    
    let day: string, month: string;
    
    // Auto-detection logic
    if (firstNum > 12) {
      // Must be DD/MM format
      day = first;
      month = second;
    } else if (secondNum > 12) {
      // Must be MM/DD format
      month = first;
      day = second;
    } else {
      // Ambiguous - use user preference or default
      if (this.userDateFormat === 'MM/DD/YYYY') {
        month = first;
        day = second;
      } else {
        // Default to DD/MM (European convention)
        day = first;
        month = second;
      }
    }
    
    const paddedDay = day.padStart(2, '0');
    const paddedMonth = month.padStart(2, '0');
    
    if (this.isValidDateParts(parseInt(fullYear), parseInt(month), parseInt(day))) {
      return `${fullYear}-${paddedMonth}-${paddedDay}`;
    }
    
    return null;
  }
  
  /**
   * Parse 8-digit date with intelligent format detection
   */
  private static parse8DigitDate(dateStr: string): string | null {
    const validFormats = this.getValid8DigitFormats(dateStr);
    
    if (validFormats.length === 0) {
      return null;
    }
    
    // If only one valid format, use it
    if (validFormats.length === 1) {
      const { year, month, day, format } = validFormats[0];
      const paddedMonth = String(month).padStart(2, '0');
      const paddedDay = String(day).padStart(2, '0');
      console.log(`📅 Detected 8-digit date format ${format}: "${dateStr}" → "${year}-${paddedMonth}-${paddedDay}"`);
      return `${year}-${paddedMonth}-${paddedDay}`;
    }
    
    // Multiple valid formats - use user preference or priority order
    if (this.userDateFormat === 'DD/MM/YYYY') {
      // Prefer DDMMYYYY format
      const ddmmyyyy = validFormats.find(f => f.format === 'DDMMYYYY');
      if (ddmmyyyy) {
        const { year, month, day } = ddmmyyyy;
        const paddedMonth = String(month).padStart(2, '0');
        const paddedDay = String(day).padStart(2, '0');
        console.log(`📅 User prefers DD/MM, using DDMMYYYY: "${dateStr}" → "${year}-${paddedMonth}-${paddedDay}"`);
        return `${year}-${paddedMonth}-${paddedDay}`;
      }
    }
    
    // Default priority: YYYYMMDD > DDMMYYYY > MMDDYYYY > YYYYDDMM
    const formatPriority = ['YYYYMMDD', 'DDMMYYYY', 'MMDDYYYY', 'YYYYDDMM'];
    
    for (const priorityFormat of formatPriority) {
      const match = validFormats.find(f => f.format === priorityFormat);
      if (match) {
        const { year, month, day, format } = match;
        const paddedMonth = String(month).padStart(2, '0');
        const paddedDay = String(day).padStart(2, '0');
        console.log(`📅 Multiple valid formats for "${dateStr}", chose ${format}: → "${year}-${paddedMonth}-${paddedDay}"`);
        return `${year}-${paddedMonth}-${paddedDay}`;
      }
    }
    
    return null;
  }
  
  /**
   * Get all valid 8-digit date format interpretations
   */
  private static getValid8DigitFormats(dateStr: string): Array<{ year: number; month: number; day: number; format: string }> {
    const validFormats: Array<{ year: number; month: number; day: number; format: string }> = [];
    
    // Try YYYYMMDD
    const year1 = parseInt(dateStr.substring(0, 4), 10);
    const month1 = parseInt(dateStr.substring(4, 6), 10);
    const day1 = parseInt(dateStr.substring(6, 8), 10);
    if (this.isValidDateParts(year1, month1, day1)) {
      validFormats.push({ year: year1, month: month1, day: day1, format: 'YYYYMMDD' });
    }
    
    // Try DDMMYYYY
    const day2 = parseInt(dateStr.substring(0, 2), 10);
    const month2 = parseInt(dateStr.substring(2, 4), 10);
    const year2 = parseInt(dateStr.substring(4, 8), 10);
    if (this.isValidDateParts(year2, month2, day2)) {
      validFormats.push({ year: year2, month: month2, day: day2, format: 'DDMMYYYY' });
    }
    
    // Try MMDDYYYY
    const month3 = parseInt(dateStr.substring(0, 2), 10);
    const day3 = parseInt(dateStr.substring(2, 4), 10);
    const year3 = parseInt(dateStr.substring(4, 8), 10);
    if (this.isValidDateParts(year3, month3, day3)) {
      validFormats.push({ year: year3, month: month3, day: day3, format: 'MMDDYYYY' });
    }
    
    // Try YYYYDDMM
    const year4 = parseInt(dateStr.substring(0, 4), 10);
    const day4 = parseInt(dateStr.substring(4, 6), 10);
    const month4 = parseInt(dateStr.substring(6, 8), 10);
    if (this.isValidDateParts(year4, month4, day4)) {
      validFormats.push({ year: year4, month: month4, day: day4, format: 'YYYYDDMM' });
    }
    
    return validFormats;
  }
  
  /**
   * Validate date parts are reasonable
   */
  private static isValidDateParts(year: number, month: number, day: number): boolean {
    return year >= 1900 && year <= 2100 && 
           month >= 1 && month <= 12 && 
           day >= 1 && day <= 31;
  }
} 