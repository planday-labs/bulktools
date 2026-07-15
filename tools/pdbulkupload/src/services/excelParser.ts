/**
 * Excel Parser Service
 * Handles Excel file processing for employee data import
 * Features:
 * - File validation (.xlsx only - legacy .xls format not supported)
 * - Header detection and normalization
 * - Data extraction with error handling
 * - Progress tracking for large files
 * - Memory-efficient processing
 * - Timezone-safe date parsing using display text
 * 
 * SECURITY UPDATE:
 * Migrated from 'xlsx' library (vulnerable to prototype pollution and ReDoS)
 * to 'exceljs' library for improved security and maintenance.
 * 
 * DATE PARSING APPROACH:
 * This service reads the formatted display text that users actually see
 * in their Excel file and parses it directly. This ensures deterministic results
 * that match user expectations and avoids timezone conversion issues.
 */

import * as ExcelJS from 'exceljs';
import type {
  ParsedExcelData,
  ExcelColumnMapping,
  ValidationError,
  PlandayEmployeeCreateRequest,
  ExcelColumnType,
} from '../types/planday';
import { VALIDATION_CONFIG } from '../constants';
import { AUTO_MAPPING_RULES } from '../constants/autoMappingRules';

export interface ExcelParseOptions {
  maxRows?: number;
  maxFileSize?: number;
  onProgress?: (progress: number) => void;
  customFields?: Array<{ name: string; description: string }>;
  allFields?: Array<{ name: string; displayName: string; isCustom: boolean }>;
  // Date parsing now handled in MappingService
}

export interface ExcelParseResult {
  success: boolean;
  data?: ParsedExcelData;
  error?: string;
  columnMappings?: ExcelColumnMapping[];
}

/**
 * Excel Parser Class
 * Handles all Excel file processing operations using ExcelJS
 */
export class ExcelParser {
  // Date format detection moved to MappingService

  /**
   * Main parsing method that matches the expected interface
   */
  static async parseFile(
    file: File,
    options: ExcelParseOptions = {}
  ): Promise<ExcelParseResult> {
    const {
      maxRows = VALIDATION_CONFIG.MAX_EMPLOYEES,
      maxFileSize = VALIDATION_CONFIG.MAX_FILE_SIZE,
      onProgress,
      customFields,
    } = options;

    try {
      // Validate file before processing
      const validationError = this.validateFile(file, maxFileSize);
      if (validationError) {
        return {
          success: false,
          error: validationError,
        };
      }

      onProgress?.(10); // File validation complete

      // Parse the Excel file with comprehensive analysis
      const data = await this.parseExcelFile(file, maxRows);
      
      onProgress?.(70); // Data extracted and analyzed

      // Generate column mappings with custom fields
      const columnMappings = this.generateColumnMappings(data.headers, customFields, options.allFields);

      onProgress?.(100); // Complete

      return {
        success: true,
        data,
        columnMappings,
      };

    } catch (error) {
      console.error('❌ Excel parsing failed:', error);
      
      return {
        success: false,
        error: error instanceof Error 
          ? `Failed to parse Excel file: ${error.message}`
          : 'An unknown error occurred while parsing the Excel file.',
      };
    }
  }

  /**
   * Parse Excel file with comprehensive analysis and auto-mapping
   */
  static async parseExcelFile(file: File, maxRows = 0): Promise<ParsedExcelData> {
    try {
      console.log(`📊 Parsing Excel file: ${file.name} (${this.formatFileSize(file.size)})`);
      
      const workbook = new ExcelJS.Workbook();
      const arrayBuffer = await file.arrayBuffer();
      await workbook.xlsx.load(arrayBuffer);
      
      const worksheet = workbook.getWorksheet(1);
      if (!worksheet) {
        throw new Error('No worksheet found in the Excel file');
      }

      // Get worksheet dimensions
      const rowCount = worksheet.rowCount;
      const columnCount = worksheet.columnCount;
      
      console.log(`📋 Worksheet dimensions: ${rowCount} rows x ${columnCount} columns`);

      // Extract all data as a 2D array
      const rawData: any[][] = [];

      // Track the source Excel value type per column so date handling can later
      // branch on real date cells vs. raw serial numbers vs. free text, rather
      // than re-guessing from a value that has been flattened to a string.
      const columnTypeFlags: Array<{ hasDate: boolean; hasNumber: boolean; hasText: boolean }> =
        Array.from({ length: columnCount }, () => ({ hasDate: false, hasNumber: false, hasText: false }));

      // Read all rows
      for (let rowNum = 1; rowNum <= rowCount; rowNum++) {
        const row = worksheet.getRow(rowNum);
        const rowData: any[] = [];

        // Read all columns in this row
        for (let colNum = 1; colNum <= columnCount; colNum++) {
          const cell = row.getCell(colNum);
          const cellValue = this.extractCellValue(cell);
          rowData.push(cellValue);

          // Classify the source cell type (data rows only, skip the header row)
          if (rowNum > 1) {
            this.recordCellType(cell, columnTypeFlags[colNum - 1]);
          }
        }

        rawData.push(rowData);
      }

      // Whether the workbook uses the 1904 date system (affects serial → date).
      const date1904 = Boolean(
        (worksheet as any)?.properties?.date1904 ??
        (workbook as any)?.properties?.date1904 ??
        false
      );

      // Check for empty file
      if (rawData.length === 0) {
        throw new Error('The Excel file appears to be empty.');
      }

      // Extract headers from first row
      const originalHeaders = rawData[0].map(header => header?.toString().trim() || '');
      
      // Validate headers
      if (originalHeaders.length === 0 || originalHeaders.every(h => !h)) {
        throw new Error('No valid column headers found in the first row.');
      }

      // Check for duplicate column names (ignore empty/blank headers)
      const headerCounts = new Map<string, number[]>();
      originalHeaders.forEach((header, index) => {
        // Skip empty or blank headers - these are allowed as duplicates
        if (header && header.trim() !== '') {
          if (!headerCounts.has(header)) {
            headerCounts.set(header, []);
          }
          headerCounts.get(header)!.push(index + 1); // Use 1-based column numbers for user display
        }
      });

      // Find duplicates (only among non-empty headers)
      const duplicates = Array.from(headerCounts.entries())
        .filter(([_, positions]) => positions.length > 1)
        .map(([header, positions]) => ({
          name: header,
          positions: positions,
          columns: positions.map(pos => this.getExcelColumnLetter(pos - 1)).join(', ')
        }));

      if (duplicates.length > 0) {
        const duplicateMessages = duplicates.map(dup => 
          `"${dup.name}" (appears in columns ${dup.columns})`
        ).join(', ');
        
        throw new Error(
          `Duplicate column names found: ${duplicateMessages}. ` +
          `Please rename your columns to have unique names and re-upload your file.`
        );
      }

      // Extract data rows (skip header row)
      const dataRows = rawData.slice(1);

      // Limit rows if necessary
      const limitedRows = maxRows > 0 ? dataRows.slice(0, maxRows) : dataRows;

      // Clean and normalize data
      const cleanedRows = limitedRows.map((row) => {
        return originalHeaders.map((_, colIndex) => {
          const cellValue = row[colIndex];
          return this.normalizeCellValue(cellValue);
        });
      });

      // Filter out completely empty rows
      const nonEmptyRows = cleanedRows.filter(row => 
        row.some(cell => cell !== null && cell !== undefined && cell.toString().trim() !== '')
      );

      // Analyze column data density to identify empty columns
      const columnAnalysis = originalHeaders.map((header, colIndex) => {
        const columnData = nonEmptyRows.map(row => row[colIndex]);
        const nonEmptyValues = columnData.filter(cell => 
          cell !== null && cell !== undefined && cell.toString().trim() !== ''
        );
        
        return {
          index: colIndex,
          header,
          totalValues: columnData.length,
          nonEmptyValues: nonEmptyValues.length,
          dataPercentage: columnData.length > 0 ? (nonEmptyValues.length / columnData.length) * 100 : 0,
          isEmpty: nonEmptyValues.length === 0,
          sampleData: nonEmptyValues.slice(0, 3)
        };
      });

      // Filter out completely empty columns
      const columnsWithData = columnAnalysis.filter(col => !col.isEmpty);
      const emptyColumns = columnAnalysis.filter(col => col.isEmpty);
      
      // Only log if there are empty columns to discard
      if (emptyColumns.length > 0) {
        console.log(`🗑️ Discarded ${emptyColumns.length} empty columns: ${emptyColumns.map(col => col.header).join(', ')}`);
      }

      // Keep only headers and data for columns that have actual data
      const headers = columnsWithData.map(col => col.header);
      const filteredRows = nonEmptyRows.map(row =>
        columnsWithData.map(col => row[col.index])
      );

      // Map the captured source types onto the surviving (non-empty) columns
      const columnExcelTypes: Record<string, ExcelColumnType> = {};
      columnsWithData.forEach(col => {
        columnExcelTypes[col.header] = this.classifyColumnType(columnTypeFlags[col.index]);
      });

      const result: ParsedExcelData = {
        headers,
        rows: filteredRows,
        totalRows: filteredRows.length,
        fileName: file.name,
        fileSize: file.size,
        columnAnalysis, // Include analysis for debugging/info
        discardedColumns: emptyColumns.map(col => col.header),
        columnExcelTypes,
        date1904
      };

      console.log(`✅ Excel parsing complete: ${result.totalRows} rows, ${result.headers.length} columns with data`);

      return result;
    } catch (error) {
      console.error('❌ Excel parsing failed:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to parse Excel file. Please ensure it is a valid .xlsx file.');
    }
  }

  /**
   * Validate Excel file before processing
   */
  private static validateFile(file: File, maxFileSize: number): string | null {
    // Check file size
    if (file.size > maxFileSize) {
      const maxSizeMB = Math.round(maxFileSize / (1024 * 1024));
      const fileSizeMB = Math.round(file.size / (1024 * 1024));
      return `File size (${fileSizeMB}MB) exceeds the maximum allowed size of ${maxSizeMB}MB.`;
    }

    // Check file extension
    const fileName = file.name.toLowerCase();
    const supportedExtensions = VALIDATION_CONFIG.SUPPORTED_FILE_TYPES;
    const hasValidExtension = supportedExtensions.some(ext => fileName.endsWith(ext));
    
    if (!hasValidExtension) {
      return `Invalid file type. Please upload an Excel file in .xlsx format. Legacy .xls files are not supported - please convert to .xlsx first.`;
    }

    return null;
  }

  /**
   * Convert column index to Excel column letter (A, B, C, ... Z, AA, AB, ...)
   */
  private static getExcelColumnLetter(columnIndex: number): string {
    let letter = '';
    let index = columnIndex;
    
    while (index >= 0) {
      letter = String.fromCharCode(65 + (index % 26)) + letter;
      index = Math.floor(index / 26) - 1;
    }
    
    return letter;
  }

  /**
   * Normalize header names for better matching
   * Preserves international characters (ä, ö, å, ü, etc.)
   */
  private static normalizeHeader(header: string): string {
    return header
      .toString()
      .trim()
      .toLowerCase()
      // Remove extra spaces
      .replace(/\s+/g, ' ')
      // Remove special characters but keep spaces, letters (including international), and digits
      // This preserves characters like ä, ö, å, ü, ñ, etc.
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .trim();
  }

  /**
   * Normalize cell values for consistent processing
   */
  private static normalizeCellValue(value: any): any {
    // Handle null, undefined, or empty values
    if (value === null || value === undefined) {
      return '';
    }

    // Convert to string for processing
    let strValue = value.toString().trim();
    
    // Handle empty strings
    if (strValue === '') {
      return '';
    }

    // Handle boolean values
    if (typeof value === 'boolean') {
      return value.toString();
    }

    // Handle numeric values that might be phone numbers
    if (typeof value === 'number') {
      // Very large numbers that might be phone numbers
      if (value > 1000000000000) {
        return value.toString();
      }
      
      // Check for scientific notation in string representation
      if (strValue.includes('e+') || strValue.includes('E+')) {
        // This is likely a phone number that got converted to scientific notation
        // Convert back to full number string
        return value.toFixed(0);
      }
      
      return strValue;
    }

    // Handle string values that might contain unwanted characters
    // Remove common Excel artifacts
    strValue = strValue
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F]/g, '') // Remove control characters
      .replace(/\u00A0/g, ' ') // Replace non-breaking spaces with regular spaces
      .trim();

    // Handle phone numbers that might have been formatted
    // Look for patterns like scientific notation in strings
    if (/^\d+\.?\d*[eE][+-]?\d+$/.test(strValue)) {
      try {
        const num = parseFloat(strValue);
        if (!isNaN(num) && num > 1000000000) {
          return num.toFixed(0);
        }
      } catch {
        // If parsing fails, return the original string
      }
    }

    return strValue;
  }

  /**
   * Generate automatic column mappings with sophisticated pattern matching
   * PRIORITY ORDER:
   * 1. Exact field name matching against ALL API fields (name-agnostic)
   * 2. Pattern-based fuzzy matching against AUTO_MAPPING_RULES  
   * 3. Custom field description matching
   */
  private static generateColumnMappings(
    headers: string[], 
    customFields?: Array<{ name: string; description: string }>,
    allFields?: Array<{ name: string; displayName: string; isCustom: boolean }>
  ): ExcelColumnMapping[] {
    const mappings: ExcelColumnMapping[] = [];
    const usedFields = new Set<string>();

    console.log(`🔍 Starting name-agnostic auto-mapping for ${headers.length} columns`);
    if (allFields) {
      console.log(`📋 Available API fields: ${allFields.length} (${allFields.filter(f => f.isCustom).length} custom, ${allFields.filter(f => !f.isCustom).length} standard)`);
    }

    headers.forEach((header) => {
      const normalizedHeader = this.normalizeHeader(header);
      const originalHeader = header.toLowerCase().trim();
      let bestMatch: { field: string; displayName: string; confidence: number } | null = null;
      let isRequired = false;

      // 🎯 PRIORITY 1: Exact field name matching against ALL API fields (name-agnostic)
      if (allFields) {
        for (const apiField of allFields) {
          const apiFieldName = apiField.name.toLowerCase().trim();
          const apiFieldDisplayName = apiField.displayName.toLowerCase().trim();
          
          // Try exact match with original header (preserves international characters)
          if (originalHeader === apiFieldName && !usedFields.has(apiField.name)) {
            bestMatch = { 
              field: apiField.name, 
              displayName: apiField.displayName, 
              confidence: 1.0 
            };
            console.log(`🎯 EXACT MATCH: "${header}" → "${apiField.name}" (${apiField.isCustom ? 'custom' : 'standard'} field)`);
            break;
          }
          
          // Try exact match with display name (for template-generated columns)
          if (originalHeader === apiFieldDisplayName && !usedFields.has(apiField.name)) {
            bestMatch = { 
              field: apiField.name, 
              displayName: apiField.displayName, 
              confidence: 1.0 
            };
            console.log(`🎯 DISPLAY NAME MATCH: "${header}" → "${apiField.name}" (template-generated)`);
            break;
          }
        }
      }

      // 🏢 PRIORITY 2: Department and Employee Group pattern matching (template-generated columns)
      if (!bestMatch && allFields) {
        // Check for department patterns: "Department: Kitchen", "Departments - Kitchen", etc.
        const departmentMatch = originalHeader.match(/^(?:department|departments)[\s\-:]+(.+)$/i);
        if (departmentMatch) {
          const departmentName = departmentMatch[1].trim();
          const targetField = `departments.${departmentName}`;
          
          const matchingField = allFields.find(field => field.name.toLowerCase() === targetField.toLowerCase());
          if (matchingField && !usedFields.has(matchingField.name)) {
            bestMatch = { 
              field: matchingField.name, 
              displayName: matchingField.displayName, 
              confidence: 1.0 
            };
            console.log(`🏢 DEPARTMENT PATTERN: "${header}" → "${matchingField.name}" (template-generated)`);
          }
        }
        
        // Check for employee group patterns: "Employee Group: Reception", "Employee Groups - Reception", etc.
        if (!bestMatch) {
          const employeeGroupMatch = originalHeader.match(/^(?:employee\s*group|employee\s*groups)[\s\-:]+(.+)$/i);
          if (employeeGroupMatch) {
            const groupName = employeeGroupMatch[1].trim();
            const targetField = `employeeGroups.${groupName}`;
            
            const matchingField = allFields.find(field => field.name.toLowerCase() === targetField.toLowerCase());
            if (matchingField && !usedFields.has(matchingField.name)) {
              bestMatch = { 
                field: matchingField.name, 
                displayName: matchingField.displayName, 
                confidence: 1.0 
              };
              console.log(`👥 EMPLOYEE GROUP PATTERN: "${header}" → "${matchingField.name}" (template-generated)`);
            }
          }
        }
      }

      // 🔗 PRIORITY 2.5: Direct suffix matching for departments, employee groups, and skills
      // Handles cases where Excel header is just "Kitchen staff" and API field is "employeeGroups.Kitchen staff"
      if (!bestMatch && allFields) {
        const groupPrefixes = ['departments.', 'employeegroups.', 'skills.'];

        for (const apiField of allFields) {
          if (usedFields.has(apiField.name)) continue;

          const apiFieldNameLower = apiField.name.toLowerCase().trim();

          for (const prefix of groupPrefixes) {
            if (apiFieldNameLower.startsWith(prefix)) {
              const suffix = apiFieldNameLower.slice(prefix.length);

              // Match if the Excel header equals the suffix (the group/department/skill name)
              if (suffix === originalHeader) {
                bestMatch = {
                  field: apiField.name,
                  displayName: apiField.displayName,
                  confidence: 0.95
                };
                console.log(`🔗 SUFFIX MATCH: "${header}" → "${apiField.name}" (direct group/department/skill name)`);
                break;
              }
            }
          }
          if (bestMatch) break;
        }
      }

      // 🔍 PRIORITY 3: Exact field name matching against AUTO_MAPPING_RULES (for backwards compatibility)
      if (!bestMatch) {
        for (const [field] of Object.entries(AUTO_MAPPING_RULES)) {
          const normalizedFieldName = field.toLowerCase();
          
          if (normalizedHeader === normalizedFieldName && !usedFields.has(field)) {
            bestMatch = { field, displayName: field, confidence: 1.0 };
            console.log(`🎯 RULES EXACT: "${header}" → "${field}" (pattern rules)`);
            break;
          }
        }
      }

      // 📝 PRIORITY 4: Pattern-based fuzzy matching with confidence scoring
      if (!bestMatch) {
        for (const [field, patterns] of Object.entries(AUTO_MAPPING_RULES)) {
          if (usedFields.has(field)) continue;

          const confidence = this.calculateMappingConfidence(normalizedHeader, patterns);
          
          if (confidence > 0.7) { // High confidence threshold
            if (!bestMatch || confidence > bestMatch.confidence) {
              bestMatch = { field, displayName: field, confidence };
            }
          }
        }
        
        if (bestMatch) {
          console.log(`🔍 PATTERN MATCH: "${header}" → "${bestMatch.field}" (confidence: ${bestMatch.confidence.toFixed(2)})`);
        }
      }

      // 🏷️ PRIORITY 5: Custom field description matching (legacy compatibility)
      if (!bestMatch && customFields) {
        for (const customField of customFields) {
          const customFieldName = customField.name.toLowerCase();
          const customFieldDesc = (customField.description || '').toLowerCase();
          
          // Try exact match on custom field name or description
          if (originalHeader === customFieldName || 
              normalizedHeader === customFieldDesc) {
            bestMatch = { 
              field: customField.name, 
              displayName: customField.description || customField.name, 
              confidence: 0.9 
            };
            console.log(`🏷️ CUSTOM DESC: "${header}" → "${customField.name}" (description match)`);
            break;
          }
          
          // Try partial matching on custom field description
          if (customFieldDesc.includes(normalizedHeader) || 
              normalizedHeader.includes(customFieldDesc)) {
            const confidence = Math.max(
              customFieldDesc.length > 0 ? normalizedHeader.length / customFieldDesc.length : 0,
              normalizedHeader.length > 0 ? customFieldDesc.length / normalizedHeader.length : 0
            ) * 0.8; // Scale down for partial matches
            
            if (confidence > 0.5 && (!bestMatch || confidence > bestMatch.confidence)) {
              bestMatch = { 
                field: customField.name, 
                displayName: customField.description || customField.name, 
                confidence 
              };
            }
          }
        }
      }

      // Determine if field is required
      if (bestMatch) {
        isRequired = ['firstName', 'lastName', 'email'].includes(bestMatch.field);
        usedFields.add(bestMatch.field);
      } else {
        console.log(`❌ NO MATCH: "${header}" - no matching API field found`);
      }

      // Create mapping entry
      mappings.push({
        excelColumn: header,
        plandayField: (bestMatch?.field as keyof PlandayEmployeeCreateRequest) || ('' as any),
        plandayFieldDisplayName: bestMatch?.displayName,
        isRequired,
        isMapped: !!bestMatch,
      });
    });

    const mappedCount = mappings.filter(m => m.isMapped).length;
    console.log(`🎯 Name-agnostic auto-mapping complete: ${mappedCount}/${headers.length} columns mapped`);

    return mappings;
  }

  /**
   * Calculate mapping confidence between header and patterns using sophisticated matching
   */
  private static calculateMappingConfidence(normalizedHeader: string, patterns: readonly string[]): number {
    let maxConfidence = 0;

    for (const pattern of patterns) {
      const normalizedPattern = pattern.toLowerCase();
      
      // Exact match
      if (normalizedHeader === normalizedPattern) {
        return 1.0;
      }
      
      // Contains pattern (high confidence)
      if (normalizedHeader.includes(normalizedPattern)) {
        const confidence = 0.9 * (normalizedPattern.length / normalizedHeader.length);
        maxConfidence = Math.max(maxConfidence, confidence);
      }
      
      // Pattern contains header (medium confidence)
      if (normalizedPattern.includes(normalizedHeader)) {
        const confidence = 0.8 * (normalizedHeader.length / normalizedPattern.length);
        maxConfidence = Math.max(maxConfidence, confidence);
      }
      
      // Fuzzy matching for similar words
      const similarity = this.calculateStringSimilarity(normalizedHeader, normalizedPattern);
      if (similarity > 0.7) {
        const confidence = 0.7 * similarity;
        maxConfidence = Math.max(maxConfidence, confidence);
      }
      
      // Word-based matching (e.g., "first name" matches "name first")
      const headerWords = normalizedHeader.split(/\s+/);
      const patternWords = normalizedPattern.split(/\s+/);
      
      if (headerWords.length > 1 && patternWords.length > 1) {
        const commonWords = headerWords.filter(word => patternWords.includes(word));
        if (commonWords.length > 0) {
          const confidence = 0.6 * (commonWords.length / Math.max(headerWords.length, patternWords.length));
          maxConfidence = Math.max(maxConfidence, confidence);
        }
      }
    }

    return maxConfidence;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  private static calculateStringSimilarity(str1: string, str2: string): number {
    const matrix: number[][] = [];
    const len1 = str1.length;
    const len2 = str2.length;

    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;

    // Initialize matrix
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    const maxLen = Math.max(len1, len2);
    return (maxLen - matrix[len1][len2]) / maxLen;
  }

  /**
   * Validate parsed Excel data
   */
  static validateParsedData(data: ParsedExcelData): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check if data is empty
    if (!data.rows || data.rows.length === 0) {
      errors.push({
        field: 'data',
        message: 'No data rows found in the Excel file',
        rowIndex: -1,
        value: '',
        severity: 'error',
      });
      return errors;
    }

    // Check if headers are present
    if (!data.headers || data.headers.length === 0) {
      errors.push({
        field: 'headers',
        message: 'No headers found in the Excel file',
        rowIndex: -1,
        value: '',
        severity: 'error',
      });
      return errors;
    }

    // Check for duplicate headers
    const headerCounts = new Map<string, number>();
    data.headers.forEach((header, index) => {
      const normalized = header.toLowerCase().trim();
      const count = headerCounts.get(normalized) || 0;
      headerCounts.set(normalized, count + 1);
      
      if (count > 0) {
        errors.push({
          field: `header_${index}`,
          message: `Duplicate header found: "${header}"`,
          rowIndex: -1,
          value: header,
          severity: 'warning',
        });
      }
    });

    // Check for completely empty rows
    data.rows.forEach((row, index) => {
      const hasData = row.some(cell => cell !== null && cell !== undefined && cell !== '');
      if (!hasData) {
        errors.push({
          field: 'row',
          message: 'Empty row found',
          rowIndex: index,
          value: '',
          severity: 'warning',
        });
      }
    });

    // Check for rows with mismatched column count
    data.rows.forEach((row, index) => {
      if (row.length !== data.headers.length) {
        errors.push({
          field: 'row',
          message: `Row has ${row.length} columns but expected ${data.headers.length}`,
          rowIndex: index,
          value: '',
          severity: 'warning',
        });
      }
    });

    return errors;
  }

  /**
   * Get sample data for preview
   */
  static getSampleData(data: ParsedExcelData, maxRows: number = 5): any[][] {
    const sampleRows = data.rows.slice(0, maxRows);
    return [data.headers, ...sampleRows];
  }

  /**
   * Export data back to Excel format using ExcelJS
   */
  static exportToExcel(data: ParsedExcelData, filename?: string): void {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Sheet1');

    // Add headers
    worksheet.addRow(data.headers);

    // Add data rows
    data.rows.forEach(row => {
      worksheet.addRow(row);
    });

    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Auto-fit columns
    worksheet.columns.forEach((column) => {
      if (column.values) {
        const lengths = column.values.map(v => v ? v.toString().length : 10);
        const maxLength = Math.max(...lengths.filter(v => typeof v === 'number'));
        column.width = Math.min(maxLength + 2, 50);
      }
    });

    // Download the file
    const finalFilename = filename || `${data.fileName.replace(/\.[^/.]+$/, '')}_processed.xlsx`;

    workbook.xlsx.writeBuffer().then(buffer => {
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = finalFilename;
      a.click();
      window.URL.revokeObjectURL(url);
    });
  }

  /**
   * Export excluded/failed employees to Excel
   * Only includes columns that have data (no empty columns)
   * Includes an "Errors" column with validation error reasons
   */
  static exportFailedEmployees(
    excludedEmployees: Array<{ employee: any; errors: Array<{ field: string; message: string; severity?: string }> }>,
    filename: string = 'excluded_employees.xlsx'
  ): void {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Excluded Employees');

    // Internal fields to exclude from export
    const internalFields = new Set([
      'rowIndex', 'originalData', '__internal_id', '_id', '_bulkCorrected',
      '__employeeGroupPayrates', '__departmentsIds', '__employeeGroupsIds',
      '_skipUpload', 'skillIds'
    ]);

    // Collect all non-empty fields from excluded employees
    const fieldsWithData = new Set<string>();
    excludedEmployees.forEach(exc => {
      Object.entries(exc.employee).forEach(([key, value]) => {
        // Skip internal fields and empty values
        if (!internalFields.has(key) &&
            !key.startsWith('__') &&
            !key.startsWith('_') &&
            !key.startsWith('departments.') &&
            !key.startsWith('employeeGroups.') &&
            !key.startsWith('skills.') &&
            value != null &&
            value !== '') {
          fieldsWithData.add(key);
        }
      });
    });

    // Build headers - always include core fields first, then others, then Errors
    const coreFields = ['firstName', 'lastName', 'email', 'departments', 'employeeGroups'];
    const orderedFields: string[] = [];

    // Add core fields that have data
    coreFields.forEach(field => {
      if (fieldsWithData.has(field)) {
        orderedFields.push(field);
        fieldsWithData.delete(field);
      }
    });

    // Add remaining fields
    Array.from(fieldsWithData).sort().forEach(field => {
      orderedFields.push(field);
    });

    // Add Errors column at the end
    const headers = [...orderedFields, 'Errors'];

    // Add headers row
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFDC2626' } // Red for error file
    };

    // Add data rows
    excludedEmployees.forEach(exc => {
      const rowData = headers.map(header => {
        if (header === 'Errors') {
          // Format errors as "field: message" separated by "; "
          return exc.errors
            .filter(e => e.severity === 'error' || !e.severity)
            .map(e => `${e.field}: ${e.message}`)
            .join('; ');
        }
        const value = exc.employee[header];
        // Handle arrays (like departments) - join with comma
        if (Array.isArray(value)) {
          return value.join(', ');
        }
        return value ?? '';
      });
      worksheet.addRow(rowData);
    });

    // Auto-fit columns
    worksheet.columns.forEach((column, index) => {
      const header = headers[index];
      const headerLength = header ? header.length : 10;
      const dataLengths = excludedEmployees.map(exc => {
        if (header === 'Errors') {
          return exc.errors
            .filter(e => e.severity === 'error' || !e.severity)
            .map(e => `${e.field}: ${e.message}`)
            .join('; ').length;
        }
        const val = exc.employee[header];
        if (Array.isArray(val)) {
          return val.join(', ').length;
        }
        return val ? String(val).length : 0;
      });
      const maxLength = Math.max(headerLength, ...dataLengths);
      column.width = Math.min(maxLength + 2, 60);
    });

    // Download the file
    workbook.xlsx.writeBuffer().then(buffer => {
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
    });
  }

  /**
   * Download a template Excel file using ExcelJS
   */
  static downloadTemplate(templateData: {
    headers: string[];
    examples: string[][];
    instructions: Record<string, string>;
    fieldOrder: Array<{ field: string; displayName: string; isRequired: boolean; isCustom: boolean; description?: string }>;
    fieldDescriptions?: Record<string, {
      description: string;
      required: boolean;
      fieldType: string;
      options: string;
      guidance: string;
    }>;
  }): void {
    const workbook = new ExcelJS.Workbook();

    // Main data sheet
    const dataSheet = workbook.addWorksheet('Employee Data');

    // Add headers
    const headerRow = dataSheet.addRow(templateData.headers);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4A90E2' }
    };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add example rows
    templateData.examples.forEach(exampleRow => {
      dataSheet.addRow(exampleRow);
    });

    // Auto-fit columns
    dataSheet.columns.forEach((column, index) => {
      const header = templateData.headers[index];
      const headerLength = header ? header.length : 10;
      const exampleLengths = templateData.examples.map(row =>
        row[index] ? row[index].toString().length : 0
      );
      const maxLength = Math.max(headerLength, ...exampleLengths);
      column.width = Math.min(maxLength + 2, 50);
    });

    // Instructions sheet (5-column layout)
    const descSheet = workbook.addWorksheet('Instructions');

    // Set column widths
    descSheet.columns = [
      { width: 25 },  // A: Field Name
      { width: 45 },  // B: Description
      { width: 12 },  // C: Required
      { width: 35 },  // D: Field Type
      { width: 50 },  // E: Guidance
    ];

    // Header row
    const descHeaderRow = descSheet.addRow(['Field Name', 'Description', 'Required', 'Field Type', 'Guidance']);
    descHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    descHeaderRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4A90E2' }
    };

    // Add field rows
    templateData.fieldOrder.forEach(field => {
      const desc = templateData.fieldDescriptions?.[field.field];
      if (desc) {
        const row = descSheet.addRow([
          field.displayName,
          desc.description,
          desc.required ? 'REQUIRED' : '',
          desc.fieldType,
          desc.guidance
        ]);

        // Bold the "REQUIRED" text in column C
        if (desc.required) {
          row.getCell(3).font = { bold: true };
        }
      } else {
        // Fallback: use old instructions if fieldDescriptions not available
        const instruction = templateData.instructions[field.field];
        descSheet.addRow([
          field.displayName,
          instruction || '',
          field.isRequired ? 'REQUIRED' : '',
          '',
          ''
        ]);
        if (field.isRequired) {
          const lastRow = descSheet.lastRow;
          if (lastRow) {
            lastRow.getCell(3).font = { bold: true };
          }
        }
      }
    });

    // Enable text wrap on columns B, D, E for readability
    descSheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        [2, 4, 5].forEach(col => {
          row.getCell(col).alignment = { wrapText: true, vertical: 'top' };
        });
      }
    });

    // Download the template
    workbook.xlsx.writeBuffer().then(buffer => {
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'employee_bulk_upload_template.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    });
  }

  /**
   * Extract cell value from ExcelJS cell with proper type handling
   */
  private static extractCellValue(cell: ExcelJS.Cell): any {
    if (!cell || cell.value === null || cell.value === undefined) {
      return null;
    }

    const value = cell.value;

    // Handle different cell value types
    if (typeof value === 'string') {
      return value.trim();
    }

    if (typeof value === 'number') {
      return value;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    // Handle Date objects (convert to string to avoid timezone issues)
    if (value instanceof Date) {
      const year = value.getUTCFullYear();
      const month = String(value.getUTCMonth() + 1).padStart(2, '0');
      const day = String(value.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    // Handle ExcelJS formula results
    if (typeof value === 'object' && value !== null) {
      // For formula cells, use the result value
      if ('result' in value) {
        return this.extractCellValue({ value: (value as any).result } as ExcelJS.Cell);
      }
      
      // For rich text, extract text content
      if ('richText' in value) {
        const richText = value as any;
        if (Array.isArray(richText.richText)) {
          return richText.richText.map((rt: any) => rt.text || '').join('');
        }
      }
      
      // For hyperlinks, use the text
      if ('text' in value) {
        return (value as any).text;
      }
    }

    // Fallback to string conversion
    return String(value);
  }

  /**
   * Record the source Excel value type for a cell into a per-column tally.
   * ExcelJS reports real date cells as ValueType.Date and "General"-formatted
   * date serials as ValueType.Number, which lets us distinguish them later.
   */
  private static recordCellType(
    cell: ExcelJS.Cell,
    flags: { hasDate: boolean; hasNumber: boolean; hasText: boolean }
  ): void {
    if (!cell || cell.value === null || cell.value === undefined) {
      return;
    }

    let type = cell.type;
    // Unwrap formula cells to the type of their computed result.
    if (type === ExcelJS.ValueType.Formula) {
      const result = (cell.value as any)?.result;
      if (result instanceof Date) type = ExcelJS.ValueType.Date;
      else if (typeof result === 'number') type = ExcelJS.ValueType.Number;
      else if (typeof result === 'string' && result.trim()) type = ExcelJS.ValueType.String;
      else return;
    }

    switch (type) {
      case ExcelJS.ValueType.Date:
        flags.hasDate = true;
        break;
      case ExcelJS.ValueType.Number:
        flags.hasNumber = true;
        break;
      case ExcelJS.ValueType.String:
      case ExcelJS.ValueType.SharedString:
      case ExcelJS.ValueType.RichText:
      case ExcelJS.ValueType.Hyperlink:
        if (cell.text && cell.text.trim()) flags.hasText = true;
        break;
      default:
        break;
    }
  }

  /**
   * Reduce a column's per-cell type tally to a single source classification.
   * Real date cells win over numbers (serials), which win over free text.
   */
  private static classifyColumnType(
    flags: { hasDate: boolean; hasNumber: boolean; hasText: boolean }
  ): ExcelColumnType {
    if (flags.hasDate) return 'date';
    // Any number present marks the column 'numeric' so serials still convert in
    // partially dirty columns (e.g. 46113 mixed with text); the per-value guard
    // in MappingStep leaves non-numeric cells untouched for the ambiguity flow.
    if (flags.hasNumber) return 'numeric';
    if (flags.hasText) return 'text';
    return 'empty';
  }

  /**
   * Format file size for display
   */
  private static formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

/**
 * Excel Parser Service Instance
 * Provides instance methods for backwards compatibility
 */
export class ExcelParserService {
  /**
   * Parse Excel file (instance method)
   */
  async parseFile(
    file: File,
    options?: ExcelParseOptions
  ): Promise<ExcelParseResult> {
    return ExcelParser.parseFile(file, options);
  }

  /**
   * Validate parsed data (instance method)
   */
  validateData(data: ParsedExcelData): ValidationError[] {
    return ExcelParser.validateParsedData(data);
  }

  /**
   * Get sample data (instance method)
   */
  getSample(data: ParsedExcelData, maxRows?: number): any[][] {
    return ExcelParser.getSampleData(data, maxRows);
  }

  /**
   * Export to Excel (instance method)
   */
  exportToExcel(data: ParsedExcelData, filename?: string): void {
    ExcelParser.exportToExcel(data, filename);
  }

  /**
   * Check if file is valid Excel file
   */
  isValidExcelFile(file: File): boolean {
    const fileName = file.name.toLowerCase();
    return VALIDATION_CONFIG.SUPPORTED_FILE_TYPES.some(ext => fileName.endsWith(ext));
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Download template (instance method)
   */
  downloadTemplate(templateData: {
    headers: string[];
    examples: string[][];
    instructions: Record<string, string>;
    fieldOrder: Array<{ field: string; displayName: string; isRequired: boolean; isCustom: boolean; description?: string }>;
    fieldDescriptions?: Record<string, {
      description: string;
      required: boolean;
      fieldType: string;
      options: string;
      guidance: string;
    }>;
  }): void {
    ExcelParser.downloadTemplate(templateData);
  }
}

// Export as ExcelUtils for backwards compatibility
export const ExcelUtils = new ExcelParserService();

// Export default instance for backwards compatibility
export default new ExcelParserService(); 