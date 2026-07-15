/**
 * Comprehensive Date Pattern Analyzer for Excel Import
 * Performs dataset-level pattern analysis for optionalDate fields
 * Determines whether to show date format picker or auto-detect patterns
 * 
 * Key principle: Analyze entire dataset as a pattern, not individual dates
 * 
 * Supported patterns:
 * - Year-FIRST: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, YYYYMMDD vs DD variations
 * - Year-LAST: MM/DD/YYYY, MM-DD-YYYY, MM.DD.YYYY, MMDDYYYY vs DD variations  
 * - All separator types: slash (/), dash (-), dot (.), no separators
 * - 2-digit and 4-digit years
 */

export interface PatternAnalysisResult {
  shouldShowPicker: boolean;
  autoDetectedFormat?: 'DD/MM/YYYY' | 'MM/DD/YYYY';
  reason: 'AUTO_DETECTED' | 'INSUFFICIENT_EVIDENCE' | 'CONTRADICTORY_EVIDENCE' | 'NO_AMBIGUOUS_PATTERNS';
  ambiguousSamples: string[];
  detectedPatterns: DetectedPattern[];
}

export interface DetectedPattern {
  type: 'YEAR_FIRST' | 'YEAR_LAST' | 'NAMED_MONTH' | 'EIGHT_DIGIT';
  separator?: '/' | '-' | '.' | 'NONE';
  yearLength?: 2 | 4;
  samples: string[];
  hasMonthEvidence: boolean;  // Found values > 12 in month position
  hasDayEvidence: boolean;    // Found values > 12 in day position
}

interface PatternEvidence {
  foundMmDdEvidence: boolean;  // Found XX > 12 in month position (MM/DD or YYYY-MM-DD)
  foundDdMmEvidence: boolean;  // Found XX > 12 in day position (DD/MM or YYYY-DD-MM)
  hasAmbiguousValues: boolean; // Has values where both positions ≤ 12
}

export class DatePatternAnalyzer {
  
  /**
   * Main entry point: Analyze dataset and determine if date picker should be shown
   * Returns comprehensive analysis of all detected patterns
   */
  static analyzeDatasetPattern(dateValues: string[]): PatternAnalysisResult {
    console.log('🔍 DatePatternAnalyzer: Starting analysis of', dateValues.length, 'date values');
    
    // Filter out empty/invalid values and get unique samples
    const validDates = this.getValidDateValues(dateValues);
    
    if (validDates.length === 0) {
      return {
        shouldShowPicker: false,
        reason: 'NO_AMBIGUOUS_PATTERNS',
        ambiguousSamples: [],
        detectedPatterns: []
      };
    }
    
    // Categorize all dates by pattern type
    const patterns = this.categorizeByPattern(validDates);
    console.log('🔍 Categorized patterns:', patterns);
    
    // Analyze each pattern type for evidence
    const analysisResults = this.analyzePatternEvidence(patterns);
    console.log('🔍 Pattern evidence analysis:', analysisResults);
    
    // Determine overall confidence and action needed
    return this.determinePatternConfidence(analysisResults);
  }
  
  /**
   * Simplified interface: Should we show the date format picker?
   */
  static shouldShowDateFormatPicker(dateValues: string[]): boolean {
    const analysis = this.analyzeDatasetPattern(dateValues);
    return analysis.shouldShowPicker;
  }
  
  /**
   * Get sample ambiguous dates for UI display
   */
  static getAmbiguousDateSamples(dateValues: string[]): string[] {
    const analysis = this.analyzeDatasetPattern(dateValues);
    return analysis.ambiguousSamples;
  }
  
  /**
   * Filter and deduplicate valid date values
   */
  private static getValidDateValues(dateValues: string[]): string[] {
    const uniqueValues = new Set<string>();
    
    for (const value of dateValues) {
      if (value && typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed && this.couldBeAmbiguousDate(trimmed)) {
          uniqueValues.add(trimmed);
        }
      }
    }
    
    return Array.from(uniqueValues);
  }
  
  /**
   * Check if a value could be an ambiguous date pattern
   * Excludes obviously unambiguous formats like named months
   */
  private static couldBeAmbiguousDate(value: string): boolean {
    // Named month formats are unambiguous - exclude them
    if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(value)) {
      return false;
    }
    
    // Year-FIRST dates (YYYY-MM-DD and friends) are treated as canonical ISO and
    // are NOT ambiguous: this is the form every real Excel date cell is converted
    // to, and YYYY-DD-MM is not a real-world format. Excluding it here stops the
    // picker from appearing for date-typed columns (issue #25). Only genuinely
    // ambiguous year-last and 8-digit text patterns reach the picker.
    const ambiguousPatterns = [
      /^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/,   // MM/DD/YYYY vs DD/MM/YYYY
      /^\d{8}$/                                     // 8-digit patterns
    ];
    
    return ambiguousPatterns.some(pattern => pattern.test(value));
  }
  
  /**
   * Categorize all date values by their pattern type
   */
  private static categorizeByPattern(dateValues: string[]): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    
    // Year-FIRST patterns (YYYY-XX-XX)
    const yearFirstDash = dateValues.filter(d => /^\d{4}-\d{1,2}-\d{1,2}$/.test(d));
    if (yearFirstDash.length > 0) {
      patterns.push({
        type: 'YEAR_FIRST',
        separator: '-',
        yearLength: 4,
        samples: yearFirstDash,
        hasMonthEvidence: false,
        hasDayEvidence: false
      });
    }
    
    const yearFirstSlash = dateValues.filter(d => /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(d));
    if (yearFirstSlash.length > 0) {
      patterns.push({
        type: 'YEAR_FIRST',
        separator: '/',
        yearLength: 4,
        samples: yearFirstSlash,
        hasMonthEvidence: false,
        hasDayEvidence: false
      });
    }
    
    const yearFirstDot = dateValues.filter(d => /^\d{4}\.\d{1,2}\.\d{1,2}$/.test(d));
    if (yearFirstDot.length > 0) {
      patterns.push({
        type: 'YEAR_FIRST',
        separator: '.',
        yearLength: 4,
        samples: yearFirstDot,
        hasMonthEvidence: false,
        hasDayEvidence: false
      });
    }
    
    // Year-LAST patterns (XX/XX/YYYY and XX/XX/YY)
    const yearLast4Slash = dateValues.filter(d => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(d));
    if (yearLast4Slash.length > 0) {
      patterns.push({
        type: 'YEAR_LAST',
        separator: '/',
        yearLength: 4,
        samples: yearLast4Slash,
        hasMonthEvidence: false,
        hasDayEvidence: false
      });
    }
    
    const yearLast2Slash = dateValues.filter(d => /^\d{1,2}\/\d{1,2}\/\d{2}$/.test(d));
    if (yearLast2Slash.length > 0) {
      patterns.push({
        type: 'YEAR_LAST',
        separator: '/',
        yearLength: 2,
        samples: yearLast2Slash,
        hasMonthEvidence: false,
        hasDayEvidence: false
      });
    }
    
    const yearLast4Dash = dateValues.filter(d => /^\d{1,2}-\d{1,2}-\d{4}$/.test(d));
    if (yearLast4Dash.length > 0) {
      patterns.push({
        type: 'YEAR_LAST',
        separator: '-',
        yearLength: 4,
        samples: yearLast4Dash,
        hasMonthEvidence: false,
        hasDayEvidence: false
      });
    }
    
    const yearLast2Dash = dateValues.filter(d => /^\d{1,2}-\d{1,2}-\d{2}$/.test(d));
    if (yearLast2Dash.length > 0) {
      patterns.push({
        type: 'YEAR_LAST',
        separator: '-',
        yearLength: 2,
        samples: yearLast2Dash,
        hasMonthEvidence: false,
        hasDayEvidence: false
      });
    }
    
    const yearLast4Dot = dateValues.filter(d => /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(d));
    if (yearLast4Dot.length > 0) {
      patterns.push({
        type: 'YEAR_LAST',
        separator: '.',
        yearLength: 4,
        samples: yearLast4Dot,
        hasMonthEvidence: false,
        hasDayEvidence: false
      });
    }
    
    const yearLast2Dot = dateValues.filter(d => /^\d{1,2}\.\d{1,2}\.\d{2}$/.test(d));
    if (yearLast2Dot.length > 0) {
      patterns.push({
        type: 'YEAR_LAST',
        separator: '.',
        yearLength: 2,
        samples: yearLast2Dot,
        hasMonthEvidence: false,
        hasDayEvidence: false
      });
    }
    
    // 8-digit patterns
    const eightDigit = dateValues.filter(d => /^\d{8}$/.test(d));
    if (eightDigit.length > 0) {
      patterns.push({
        type: 'EIGHT_DIGIT',
        separator: 'NONE',
        samples: eightDigit,
        hasMonthEvidence: false,
        hasDayEvidence: false
      });
    }
    
    return patterns;
  }
  
  /**
   * Analyze each pattern type for definitive evidence (values > 12)
   */
  private static analyzePatternEvidence(patterns: DetectedPattern[]): DetectedPattern[] {
    return patterns.map(pattern => {
      const evidence = this.getPatternEvidence(pattern);
      return {
        ...pattern,
        hasMonthEvidence: evidence.foundMmDdEvidence,
        hasDayEvidence: evidence.foundDdMmEvidence
      };
    });
  }
  
  /**
   * Extract evidence from a specific pattern type
   */
  private static getPatternEvidence(pattern: DetectedPattern): PatternEvidence {
    let foundMmDdEvidence = false;
    let foundDdMmEvidence = false;
    let hasAmbiguousValues = false;
    
    for (const dateStr of pattern.samples) {
      const positions = this.extractPositions(dateStr, pattern);
      
      if (positions) {
        const { firstPos, secondPos } = positions;
        
        // Check for definitive evidence (> 12)
        if (firstPos > 12) {
          if (pattern.type === 'YEAR_FIRST') {
            foundDdMmEvidence = true; // YYYY-DD-MM format
          } else {
            foundDdMmEvidence = true; // DD/MM format
          }
        }
        
        if (secondPos > 12) {
          if (pattern.type === 'YEAR_FIRST') {
            foundMmDdEvidence = true; // YYYY-MM-DD format
          } else {
            foundMmDdEvidence = true; // MM/DD format
          }
        }
        
        // Check for ambiguous values (both ≤ 12)
        if (firstPos <= 12 && secondPos <= 12) {
          hasAmbiguousValues = true;
        }
      }
    }
    
    return { foundMmDdEvidence, foundDdMmEvidence, hasAmbiguousValues };
  }
  
  /**
   * Extract the first and second numeric positions from a date string
   */
  private static extractPositions(dateStr: string, pattern: DetectedPattern): { firstPos: number; secondPos: number } | null {
    let match: RegExpMatchArray | null = null;
    
    if (pattern.type === 'YEAR_FIRST') {
      // For YYYY-XX-XX, extract the XX positions
      match = dateStr.match(/^\d{4}[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
    } else if (pattern.type === 'YEAR_LAST') {
      // For XX/XX/YYYY, extract the XX positions
      match = dateStr.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.]\d{2,4}$/);
    } else if (pattern.type === 'EIGHT_DIGIT') {
      // Handle multiple 8-digit interpretations
      return this.extractEightDigitPositions(dateStr);
    }
    
    if (match) {
      return {
        firstPos: parseInt(match[1], 10),
        secondPos: parseInt(match[2], 10)
      };
    }
    
    return null;
  }
  
  /**
   * Extract positions from 8-digit dates (multiple possible interpretations)
   */
  private static extractEightDigitPositions(dateStr: string): { firstPos: number; secondPos: number } | null {
    // For 8-digit dates, we need to consider multiple interpretations
    // We'll check the most common ones: YYYYMMDD, DDMMYYYY, MMDDYYYY
    
    // Try YYYYMMDD vs YYYYDDMM (positions 4-5 and 6-7)
    if (dateStr.substring(0, 2) === '19' || dateStr.substring(0, 2) === '20') {
      const pos1 = parseInt(dateStr.substring(4, 6), 10);
      const pos2 = parseInt(dateStr.substring(6, 8), 10);
      return { firstPos: pos1, secondPos: pos2 };
    }
    
    // Try DDMMYYYY vs MMDDYYYY (positions 0-1 and 2-3)
    const pos1 = parseInt(dateStr.substring(0, 2), 10);
    const pos2 = parseInt(dateStr.substring(2, 4), 10);
    return { firstPos: pos1, secondPos: pos2 };
  }
  
  /**
   * Determine overall pattern confidence and whether to show picker
   */
  private static determinePatternConfidence(patterns: DetectedPattern[]): PatternAnalysisResult {
    // Aggregate evidence across all pattern types
    let overallMmDdEvidence = false;
    let overallDdMmEvidence = false;
    let hasAnyAmbiguousPatterns = false;
    
    for (const pattern of patterns) {
      if (pattern.hasMonthEvidence) overallMmDdEvidence = true;
      if (pattern.hasDayEvidence) overallDdMmEvidence = true;
      
      // Pattern is ambiguous if it has samples but no definitive evidence
      if (pattern.samples.length > 0 && !pattern.hasMonthEvidence && !pattern.hasDayEvidence) {
        hasAnyAmbiguousPatterns = true;
      }
    }
    
    console.log('🔍 Overall evidence - MM/DD:', overallMmDdEvidence, 'DD/MM:', overallDdMmEvidence, 'Ambiguous:', hasAnyAmbiguousPatterns);
    
    // Decision logic
    if (overallMmDdEvidence && !overallDdMmEvidence) {
      // Clear MM/DD evidence across dataset
      return {
        shouldShowPicker: false,
        autoDetectedFormat: 'MM/DD/YYYY',
        reason: 'AUTO_DETECTED',
        ambiguousSamples: [],
        detectedPatterns: patterns
      };
    }
    
    if (overallDdMmEvidence && !overallMmDdEvidence) {
      // Clear DD/MM evidence across dataset
      return {
        shouldShowPicker: false,
        autoDetectedFormat: 'DD/MM/YYYY',
        reason: 'AUTO_DETECTED',
        ambiguousSamples: [],
        detectedPatterns: patterns
      };
    }
    
    if (overallMmDdEvidence && overallDdMmEvidence) {
      // Contradictory evidence - user must choose
      return {
        shouldShowPicker: true,
        reason: 'CONTRADICTORY_EVIDENCE',
        ambiguousSamples: this.getRepresentativeSamples(patterns),
        detectedPatterns: patterns
      };
    }
    
    if (hasAnyAmbiguousPatterns) {
      // No definitive evidence but has ambiguous patterns - user must choose
      return {
        shouldShowPicker: true,
        reason: 'INSUFFICIENT_EVIDENCE',
        ambiguousSamples: this.getRepresentativeSamples(patterns),
        detectedPatterns: patterns
      };
    }
    
    // No ambiguous patterns found
    return {
      shouldShowPicker: false,
      reason: 'NO_AMBIGUOUS_PATTERNS',
      ambiguousSamples: [],
      detectedPatterns: patterns
    };
  }
  
  /**
   * Get representative samples for UI display (max 5)
   */
  private static getRepresentativeSamples(patterns: DetectedPattern[]): string[] {
    const samples: string[] = [];
    
    for (const pattern of patterns) {
      // Take up to 2 samples from each pattern type
      samples.push(...pattern.samples.slice(0, 2));
      if (samples.length >= 5) break;
    }
    
    return samples.slice(0, 5);
  }
} 