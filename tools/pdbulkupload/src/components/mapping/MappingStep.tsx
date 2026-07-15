/**
 * Enhanced Mapping Step Component
 * Handles column mapping and bulk correction for name-to-ID conversion
 * Features:
 * - Enhanced auto-mapping for department/employee group name columns
 * - Integration with bulk correction system
 * - Live preview of mapping results
 * - Validation of mapped columns
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { FieldSelectionModal } from '../ui/FieldSelectionModal';
import { AUTO_MAPPING_RULES } from '../../constants/autoMappingRules';
import { ValidationService, FieldDefinitionValidator } from '../../services/mappingService';
import { DateParser } from '../../utils/dateParser';
import type { Employee, ColumnMapping, ExcelColumnMapping, ParsedExcelData } from '../../types/planday';

interface MappingStepProps {
  employees: any[][]; // Raw Excel rows data
  headers: string[];
  excelData?: ParsedExcelData; // Full Excel data including discarded columns info
  initialColumnMappings?: ExcelColumnMapping[]; // Auto-mappings from Excel parser
  savedMappings?: ColumnMapping; // Previously saved user mappings (when returning from later steps)
  savedCustomValues?: { [fieldName: string]: string }; // Previously saved custom values (when returning from later steps)
  onComplete: (employees: Employee[], mappings: ColumnMapping, customValues: { [fieldName: string]: string }) => void;
  onBack: () => void;
  className?: string;
}

interface ExcelColumn {
  name: string;
  index: number;
  sampleData: string[];
}

interface PlandayField {
  name: string;
  displayName: string;
  description?: string;
  isRequired: boolean;
  isReadOnly: boolean;
  isUnique: boolean;
  isCustom: boolean;
}

const MappingStep: React.FC<MappingStepProps> = ({
  employees,
  headers,
  excelData,
  initialColumnMappings,
  savedMappings,
  savedCustomValues,
  onComplete,
  onBack: _onBack, // Mark as unused since we removed the back button
  className = ''
}) => {
  const [columnMappings, setColumnMappings] = useState<ColumnMapping>({});
  const [mappingErrors, setMappingErrors] = useState<string[]>([]);
  const [customValues, setCustomValues] = useState<{ [fieldName: string]: string }>({});
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    columnName: string | null;
  }>({ isOpen: false, columnName: null });
  
  const [customValueModalState, setCustomValueModalState] = useState<{
    isOpen: boolean;
    fieldName: string | null;
  }>({ isOpen: false, fieldName: null });

  // Prepare Excel columns with sample data
  const excelColumns = useMemo<ExcelColumn[]>(() => {
    return headers.map((header, index) => ({
      name: header,
      index,
      sampleData: employees.slice(0, 3).map(row => row[index] || '').filter(Boolean)
    }));
  }, [headers, employees]);

  // Prepare Planday fields using flattened field structure (includes complex object sub-fields)
  const plandayFields = useMemo<PlandayField[]>(() => {
    // Get all available fields including flattened complex object sub-fields (departments.Kitchen, employeeGroups.Reception, etc.)
    const allAvailableFields = ValidationService.getAllAvailableFields();

    const fields: PlandayField[] = allAvailableFields.map(field => ({
      name: field.field,
      displayName: field.displayName,
      description: field.description,
      isRequired: field.isRequired,
      isReadOnly: ValidationService.isReadOnly(field.field),
      isUnique: ValidationService.isUnique(field.field),
      isCustom: field.isCustom
    }));

    return fields;
  }, []);

  // Initialize column mappings from saved mappings (if returning from later step) or auto-mapping results
  useEffect(() => {
    if (plandayFields.length > 0) {
      const availableFieldNames = new Set(plandayFields.map(f => f.name));
      
      // Priority 1: Use saved mappings if available (user returning from later step)
      if (savedMappings && Object.keys(savedMappings).length > 0) {
        // Restoring saved user mappings
        
        // Filter out any invalid fields that might have been saved
        const validSavedMappings: ColumnMapping = {};
        Object.entries(savedMappings).forEach(([excelColumn, plandayField]) => {
          if (plandayField && (plandayField === '__IGNORE__' || availableFieldNames.has(plandayField))) {
            validSavedMappings[excelColumn] = plandayField;
          } else {
            console.warn(`Saved field "${plandayField}" no longer available. Removing mapping for "${excelColumn}"`);
          }
        });
        setColumnMappings(validSavedMappings);
        return;
      }
      
      // Priority 2: Use initial auto-mappings (first time on this step)
      if (initialColumnMappings && initialColumnMappings.length > 0) {
        // Using initial auto-mappings from Excel parser
        const initialMappings: ColumnMapping = {};
        const usedFields = new Set<string>();
        
        // Process mappings, but prevent duplicates by tracking used fields
        initialColumnMappings.forEach(mapping => {
          if (mapping.isMapped && mapping.plandayField) {
            const fieldName = mapping.plandayField as string;
            
            // Check if the field exists in our available fields
            if (availableFieldNames.has(fieldName)) {
              // Only map if this field hasn't been used yet
              if (!usedFields.has(fieldName)) {
                initialMappings[mapping.excelColumn] = fieldName;
                usedFields.add(fieldName);
              } else {
                console.warn(`Field "${fieldName}" already mapped to another column. Skipping duplicate mapping for "${mapping.excelColumn}"`);
              }
            } else {
              console.warn(`Field "${fieldName}" not found in available fields. Skipping mapping for "${mapping.excelColumn}"`);
            }
          }
        });
        setColumnMappings(initialMappings);
      }
    }
  }, [initialColumnMappings, savedMappings, plandayFields]);

  // Initialize custom values from saved custom values (if returning from later step)
  useEffect(() => {
    if (savedCustomValues && Object.keys(savedCustomValues).length > 0) {
      // Restore saved custom values when user returns from later step
      // Restoring saved custom values
      setCustomValues(savedCustomValues);
    }
  }, [savedCustomValues]);

  // Get available fields for dropdown (excluding already mapped fields)
  // Now includes flattened complex object sub-fields
  const getAvailableFields = (currentColumnName: string): PlandayField[] => {
    // Get all fields that are mapped to other columns (exclude current column and __IGNORE__)
    const mappedFields = new Set();
    Object.entries(columnMappings).forEach(([columnName, fieldName]) => {
      if (columnName !== currentColumnName && fieldName && fieldName !== '__IGNORE__') {
        mappedFields.add(fieldName);
      }
    });
    
    // Get all fields that have custom values set
    const customMappedFields = new Set(Object.keys(customValues).filter(key => customValues[key].trim()));
    
    // Check if cellPhone is mapped (for conditional requirements)
    const isCellPhoneMapped = mappedFields.has('cellPhone') || customMappedFields.has('cellPhone');
    
    // Get all available fields including flattened complex object sub-fields
    const allAvailableFields = ValidationService.getAllAvailableFields();
    
    return allAvailableFields.filter(field => {
      // Include field if:
      // 1. It's not mapped by another column AND
      // 2. It doesn't have a custom value set
      return !mappedFields.has(field.field) && !customMappedFields.has(field.field);
    }).map(field => {
      // Convert to PlandayField format and apply conditional requirements
      const plandayField: PlandayField = {
        name: field.field,
        displayName: field.displayName,
        description: field.description,
        isRequired: field.isRequired,
        isReadOnly: ValidationService.isReadOnly(field.field),
        isUnique: ValidationService.isUnique(field.field),
        isCustom: field.isCustom
      };
      
      // cellPhoneCountryCode becomes required when cellPhone is mapped
      if (field.field === 'cellPhoneCountryCode' && isCellPhoneMapped) {
        plandayField.isRequired = true;
      }
      
      return plandayField;
    });
  };

  // Get available fields for custom values (excluding already mapped fields)
  // Now includes flattened complex object sub-fields
  const getAvailableFieldsForCustom = (currentFieldName?: string): PlandayField[] => {
    const mappedFields = new Set(Object.values(columnMappings).filter(Boolean));
    const customMappedFields = new Set(Object.keys(customValues));
    
    // Check if cellPhone is mapped (for conditional requirements)
    const isCellPhoneMapped = mappedFields.has('cellPhone') || customMappedFields.has('cellPhone');
    
    // Get all available fields including flattened complex object sub-fields
    const allAvailableFields = ValidationService.getAllAvailableFields();
    
    return allAvailableFields.filter(field => {
      // Include if not mapped in either regular or custom mappings, or if it's the current custom mapping
      return (!mappedFields.has(field.field) && !customMappedFields.has(field.field)) || field.field === currentFieldName;
    }).map(field => {
      // Convert to PlandayField format and apply conditional requirements
      const plandayField: PlandayField = {
        name: field.field,
        displayName: field.displayName,
        description: field.description,
        isRequired: field.isRequired,
        isReadOnly: ValidationService.isReadOnly(field.field),
        isUnique: ValidationService.isUnique(field.field),
        isCustom: field.isCustom
      };
      
      // cellPhoneCountryCode becomes required when cellPhone is mapped
      if (field.field === 'cellPhoneCountryCode' && isCellPhoneMapped) {
        plandayField.isRequired = true;
      }
      
      return plandayField;
    });
  };

  // Get mapping status for visual feedback
  const getMappingStatus = (columnName: string) => {
    const mappedField = columnMappings[columnName];
    if (!mappedField) return 'unmapped';
    if (mappedField === '__IGNORE__') return 'ignored';
    return 'mapped';
  };

  // Get unmapped required fields
  const unmappedRequiredFields = useMemo(() => {
    const requiredFields = ValidationService.getRequiredFields();
    const mappedFields = new Set(Object.values(columnMappings).filter(field => field && field !== '__IGNORE__'));
    const customMappedFields = new Set(Object.keys(customValues).filter(key => customValues[key].trim()));
    return requiredFields.filter(field => !mappedFields.has(field) && !customMappedFields.has(field));
  }, [columnMappings, customValues]);

  // Auto-detect mappings on mount (only if no initial mappings provided)
  useEffect(() => {
    // Only run auto-detection if no initial mappings were provided
    if (!initialColumnMappings || initialColumnMappings.length === 0) {
      const autoDetectedMappings: ColumnMapping = {};
      const usedFields = new Set<string>();
      const usedColumns = new Set<string>();

      // Auto-detect mappings using fuzzy matching, preventing duplicates
      for (const [fieldName, patterns] of Object.entries(AUTO_MAPPING_RULES)) {
        // Skip if this field has already been mapped
        if (usedFields.has(fieldName)) {
          continue;
        }
        
        const bestMatch = findBestColumnMatch(headers, patterns, fieldName);
        if (bestMatch && !usedColumns.has(bestMatch)) {
          autoDetectedMappings[bestMatch] = fieldName;
          usedFields.add(fieldName);
          usedColumns.add(bestMatch);
        }
      }

      setColumnMappings(autoDetectedMappings);
    }
  }, [headers, initialColumnMappings]);

  // Validate mappings when they change
  useEffect(() => {
    validateMappings();
  }, [columnMappings, customValues]);

  /**
   * Find best matching column for a field using priority system:
   * 1. First check for exact field name matches (field-agnostic)
   * 2. Then fall back to pattern-based fuzzy matching
   */
  const findBestColumnMatch = (headers: string[], patterns: readonly string[], fieldName: string): string | null => {
    // PRIORITY 1: Check for exact field name matches (case-insensitive)
    for (const header of headers) {
      const normalizedHeader = header.toLowerCase().trim();
      const normalizedFieldName = fieldName.toLowerCase();
      
      // Exact match with field name gets highest priority
      if (normalizedHeader === normalizedFieldName) {
        return header;
      }
    }

    // PRIORITY 2: Use pattern-based fuzzy matching as fallback
    let bestMatch: string | null = null;
    let bestScore = 0;

    for (const header of headers) {
      const normalizedHeader = header.toLowerCase().trim();
      
      for (const pattern of patterns) {
        const normalizedPattern = pattern.toLowerCase();
        
        // Exact pattern match gets highest score
        if (normalizedHeader === normalizedPattern) {
          return header;
        }
        
        // Partial match scoring
        if (normalizedHeader.includes(normalizedPattern)) {
          const score = normalizedPattern.length / normalizedHeader.length;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = header;
          }
        }
      }
    }

    return bestScore > 0.5 ? bestMatch : null;
  };

  /**
   * Apply column mappings to create Employee objects
   */
  const applyColumnMappings = (rawRows: any[][], mappings: ColumnMapping): Employee[] => {
    // Date fields whose source column held raw serial numbers ("General"-formatted
    // dates) need serial → ISO conversion up front, since they never reach the
    // string-based date parser otherwise. Real date cells already arrive as ISO;
    // text columns are left untouched for the ambiguity flow. (Issue #25)
    const dateFields = new Set(ValidationService.getAllDateFields());
    const columnExcelTypes = excelData?.columnExcelTypes;
    const date1904 = excelData?.date1904 ?? false;

    return rawRows.map((row, index) => {
      const employee: Partial<Employee> = {
        rowIndex: index + 1
      };

      // Convert array row to object using headers
      const rowObject = headers.reduce((obj, header, headerIndex) => {
        obj[header] = row[headerIndex];
        return obj;
      }, {} as any);

      // Map each field from Excel columns (skip ignored columns)
      for (const [columnName, fieldName] of Object.entries(mappings)) {
        if (fieldName && fieldName !== '__IGNORE__' && rowObject[columnName] !== undefined) {
          let value = rowObject[columnName];

          if (dateFields.has(fieldName) && columnExcelTypes?.[columnName] === 'numeric') {
            const serial = Number(String(value).trim());
            // Only treat plausible Excel serials as dates; larger integers (e.g.
            // an 8-digit YYYYMMDD typed as a number) fall through to normal parsing.
            if (Number.isInteger(serial) && serial >= 1 && serial <= 2958465) {
              const iso = DateParser.excelSerialToISO(serial, date1904);
              if (iso) value = iso;
            }
          }

          employee[fieldName as keyof Employee] = value;
        }
      }

      // Apply custom static values with normalization
      for (const [fieldName, staticValue] of Object.entries(customValues)) {
        if (staticValue.trim()) {
          let normalizedValue = staticValue.trim();
          
          // Special handling for cellPhoneCountryCode - normalize "Sweden" -> "SE"
          if (fieldName === 'cellPhoneCountryCode') {
            normalizedValue = normalizeCellPhoneCountryCode(staticValue.trim());
          }
          
          employee[fieldName as keyof Employee] = normalizedValue;
        }
      }

      return employee as Employee;
    });
  };

  /**
   * Normalize cellPhoneCountryCode values from custom values
   * Converts country names like "Sweden" to ISO codes like "SE"
   */
  const normalizeCellPhoneCountryCode = (value: string): string => {
    const basicMappings: Record<string, string> = {
      'Sweden': 'SE',
      'Denmark': 'DK', 
      'Norway': 'NO',
      'Finland': 'FI',
      'Iceland': 'IS',
      'United Kingdom': 'UK',
      'Germany': 'DE',
      'France': 'FR',
      'Italy': 'IT',
      'Spain': 'ES',
      'Netherlands': 'NL',
      'Switzerland': 'CH',
      'Belgium': 'BE',
      'Austria': 'AT',
      'Poland': 'PL'
    };
    
    const upperInput = value.toUpperCase();
    const supportedCountries = ["DK", "UK", "NO", "SE", "DE", "US", "PL", "VN", "FR", "ES", "IT", "NL", "CH", "BE", "AT", "FI", "IS", "AU", "CA", "JP", "KR", "CN", "BR", "MX", "IN", "ZA", "SG"];
    
    // Check if it's already a valid ISO code
    if (supportedCountries.includes(upperInput)) {
      return upperInput;
    }
    
    // Try to map from country name to ISO code
    const mapped = basicMappings[value];
    if (mapped && supportedCountries.includes(mapped)) {
      return mapped;
    }
    
    // If no mapping found, return original value (validation will catch this)
    return value;
  };

  /**
   * Validate current mappings
   */
  const validateMappings = () => {
    const errors: string[] = [];
    const requiredFields = ValidationService.getRequiredFields();
    const mappedFields = new Set(Object.values(columnMappings).filter(field => field && field !== '__IGNORE__'));
    const customMappedFields = new Set(Object.keys(customValues).filter(key => customValues[key].trim()));

    // Check for duplicate mappings (multiple Excel columns mapped to same Planday field)
    const fieldMappingCount = new Map<string, string[]>();
    Object.entries(columnMappings).forEach(([columnName, fieldName]) => {
      if (fieldName && fieldName !== '__IGNORE__') {
        if (!fieldMappingCount.has(fieldName)) {
          fieldMappingCount.set(fieldName, []);
        }
        fieldMappingCount.get(fieldName)!.push(columnName);
      }
    });
    
    fieldMappingCount.forEach((columns, fieldName) => {
      if (columns.length > 1) {
        errors.push(`"${fieldName}" is mapped to multiple columns: ${columns.join(', ')}. Each Planday field can only be mapped to one Excel column.`);
      }
    });

    // Check required fields - they can be satisfied by either Excel mappings OR custom values
    for (const field of requiredFields) {
      if (!mappedFields.has(field) && !customMappedFields.has(field)) {
        errors.push(`${field} is required but not mapped`);
      }
    }

    // Check conditional requirements
    // cellPhoneCountryCode is required when cellPhone is mapped
    const hasCellPhone = mappedFields.has('cellPhone') || customMappedFields.has('cellPhone');
    const hasCellPhoneCountryCode = mappedFields.has('cellPhoneCountryCode') || customMappedFields.has('cellPhoneCountryCode');
    
    if (hasCellPhone && !hasCellPhoneCountryCode) {
      errors.push('cellPhoneCountryCode is required when cellPhone is mapped. Please map a column containing country codes (like "DK", "SE", "Denmark", "Sweden")');
    }

    setMappingErrors(errors);
  };

  /**
   * Handle dropdown change
   */
  const handleMappingChange = (columnName: string, fieldName: string) => {
    const newMappings = { ...columnMappings };
    
    if (fieldName === '') {
      // Clear mapping
      delete newMappings[columnName];
    } else {
      // Set new mapping
      newMappings[columnName] = fieldName;
    }
    
    setColumnMappings(newMappings);
  };

  /**
   * Handle custom value changes
   */
  const handleAddCustomValue = () => {
    // Open field selection modal directly instead of creating temp field
    setCustomValueModalState({ isOpen: true, fieldName: null });
  };

  const handleCustomFieldChange = (oldFieldName: string, newFieldName: string) => {
    // Custom field changed
    if (newFieldName !== oldFieldName) {
      const newCustomValues = { ...customValues };
      const value = newCustomValues[oldFieldName];
      delete newCustomValues[oldFieldName];
      if (newFieldName.trim()) {
        newCustomValues[newFieldName] = value;
        console.log(`✅ Updated custom values:`, newCustomValues);
      }
      setCustomValues(newCustomValues);
    }
  };

  const handleCustomFieldSelect = (fieldName: string) => {
    // For new custom values (when oldFieldName is null), directly create the field
    if (!customValueModalState.fieldName) {
      setCustomValues(prev => ({
        ...prev,
        [fieldName]: ''
      }));
    } else {
      // For existing custom values, rename the field
      handleCustomFieldChange(customValueModalState.fieldName, fieldName);
    }
    setCustomValueModalState({ isOpen: false, fieldName: null });
  };

  const handleCustomValueChange = (fieldName: string, value: string) => {
    setCustomValues(prev => ({
      ...prev,
      [fieldName]: value
    }));
  };

  const handleRemoveCustomValue = (fieldName: string) => {
    const newCustomValues = { ...customValues };
    delete newCustomValues[fieldName];
    setCustomValues(newCustomValues);
  };

  /**
   * Handle modal operations
   */
  const openFieldModal = (columnName: string) => {
    setModalState({ isOpen: true, columnName });
  };

  const closeFieldModal = () => {
    setModalState({ isOpen: false, columnName: null });
  };

  const openCustomValueFieldModal = (fieldName: string) => {
    setCustomValueModalState({ isOpen: true, fieldName });
  };

  const closeCustomValueFieldModal = () => {
    setCustomValueModalState({ isOpen: false, fieldName: null });
  };

  // Function to handle field selection from modal
  const handleFieldSelect = (fieldName: string) => {
    const { columnName } = modalState;
    if (!columnName) return;

    // Update column mappings
    setColumnMappings(prev => ({
      ...prev,
      [columnName]: fieldName
    }));

    // Close modal and clear any errors related to this mapping
    setModalState({ isOpen: false, columnName: null });
    setMappingErrors(prev => prev.filter(error => 
      !error.includes(`Column "${columnName}"`)
    ));

    // Column mapped successfully
  };

  /**
   * Handle ignore button click - properly unmaps field before ignoring
   */
  const handleIgnoreColumn = (columnName: string) => {
    const currentMapping = columnMappings[columnName];
    
    // If currently mapped to a real field, we need to unmap it first to make it available for other columns
    if (currentMapping && currentMapping !== '__IGNORE__') {
      // Unmapping field to make it available for other columns
    }
    
    // Set to ignore (this will free up the previously mapped field for other columns)
    handleMappingChange(columnName, '__IGNORE__');
  };

  /**
   * Handle form submission
   */
  const handleSubmit = () => {
    if (mappingErrors.length === 0) {
      const mappedEmployees = applyColumnMappings(employees, columnMappings);
      onComplete(mappedEmployees, columnMappings, customValues);
    }
  };

  const mappedFieldsCount = Object.values(columnMappings).filter(field => field && field !== '__IGNORE__').length;
  const customValuesCount = Object.entries(customValues).filter(([, value]) => value.trim()).length;

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900">Column Mapping</h2>
        <p className="text-gray-600 mt-2">
          Map your Excel columns to Planday fields using the dropdowns
        </p>
      </div>

      {/* Warning Bar for Unmapped Required Fields */}
      {unmappedRequiredFields.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">
                Required fields not mapped
              </h3>
              <div className="mt-2 text-sm text-red-700">
                <p>The following required Planday fields need to be mapped:</p>
                <ul className="list-disc list-inside mt-1">
                  {unmappedRequiredFields.map(field => (
                    <li key={field}><strong className="font-mono">{field}</strong></li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mapping Errors (includes conditional validation errors) */}
      {mappingErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">
                Mapping validation errors
              </h3>
              <div className="mt-2 text-sm text-red-700">
                <ul className="list-disc list-inside">
                  {mappingErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mapping Interface - Two Column Layout */}
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Map Excel Columns to Planday Fields
          </h3>
          
          {/* Column Headers */}
          <div className="grid grid-cols-12 gap-4 mb-4 pb-3 border-b border-gray-200">
            <div className="col-span-5">
              <h4 className="font-medium text-gray-700 flex items-center">
                📊 Excel Columns ({excelColumns.length})
              </h4>
            </div>
            <div className="col-span-2 text-center">
              <h4 className="font-medium text-gray-500">Mapping</h4>
            </div>
            <div className="col-span-5">
              <h4 className="font-medium text-gray-700 flex items-center">
                🎯 Planday Fields
              </h4>
            </div>
          </div>
          
          {/* Mapping Rows */}
          <div className="divide-y divide-gray-100">
            {excelColumns.map((column, index) => {
              const mappedField = columnMappings[column.name];
              // const availableFields = getAvailableFields(column.name); // Available for future use
              const status = getMappingStatus(column.name);
              
              return (
                <div 
                  key={column.name}
                  className={`grid grid-cols-12 gap-4 items-center p-4 transition-colors hover:bg-gray-50 group ${
                    index === 0 ? '' : 'pt-4'
                  }`}
                >
                  {/* Excel Column (Left) */}
                  <div className="col-span-5">
                    <div className={`p-3 rounded-lg border-2 ${
                      status === 'mapped' 
                        ? 'bg-green-50 border-green-200' 
                        : status === 'ignored'
                        ? 'bg-orange-50 border-orange-200'
                        : 'bg-gray-50 border-gray-200'
                    }`}>
                      <div className={`font-medium flex items-center ${
                        status === 'ignored' ? 'text-gray-500 line-through' : 'text-gray-900'
                      }`}>
                        {column.name}
                        {status === 'mapped' && (
                          <span className="ml-2 text-green-600">✓</span>
                        )}
                        {status === 'ignored' && (
                          <span className="ml-2 text-orange-600">🚫</span>
                        )}
                      </div>
                      {column.sampleData.length > 0 && (
                        <div className="text-sm text-gray-500 mt-1">
                          Sample: {column.sampleData.slice(0, 2).join(', ')}
                          {column.sampleData.length > 2 && '...'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Arrow (Center) */}
                  <div className="col-span-2 flex justify-center">
                    <div className={`text-2xl font-bold ${
                      status === 'mapped' 
                        ? 'text-green-500' 
                        : status === 'ignored'
                        ? 'text-orange-500'
                        : 'text-gray-300'
                    }`}>
                      {status === 'ignored' ? '🚫' : '→'}
                    </div>
                  </div>

                  {/* Planday Field Buttons (Right) */}
                  <div className="col-span-5">
                    <div className="flex items-center w-full relative">
                      {status === 'mapped' && mappedField !== '__IGNORE__' ? (
                        <>
                          {/* Green "Selected Field" button */}
                          <Button
                            onClick={() => openFieldModal(column.name)}
                            className="bg-green-100 border-green-300 text-green-800 hover:bg-green-200 hover:border-green-400 justify-start transition-all duration-200 flex-1 group-hover:mr-12"
                            variant="outline"
                          >
                            <div className="flex items-center">
                              <span className="text-green-600 mr-2">✓</span>
                              <span className="font-mono">
                                {(() => {
                                  const field = plandayFields.find(f => f.name === mappedField);
                                  if (!field) return mappedField;
                                  return field.isCustom ? (field.description || field.displayName || field.name) : (field.displayName || field.name);
                                })()}
                              </span>
                            </div>
                          </Button>
                          {/* Ignore button - slides in from right */}
                          <Button
                            onClick={() => handleIgnoreColumn(column.name)}
                            className="text-orange-600 border-gray-300 hover:bg-orange-50 hover:border-orange-300 transition-all duration-200 opacity-0 absolute right-0 w-10 px-0 group-hover:opacity-100"
                            variant="outline"
                            title="Ignore this column"
                          >
                            🚫
                          </Button>
                        </>
                      ) : status === 'ignored' ? (
                        <>
                          {/* Ignored text */}
                          <div className="flex items-center text-orange-600 font-medium transition-all duration-200 flex-1 group-hover:mr-12">
                            <span>Column will be ignored during import</span>
                          </div>
                          {/* Clear ignore button - slides in from right */}
                          <Button
                            onClick={() => handleMappingChange(column.name, '')}
                            className="text-gray-600 border-gray-300 hover:bg-gray-50 transition-all duration-200 opacity-0 absolute right-0 w-10 px-0 group-hover:opacity-100"
                            variant="outline"
                            title="Clear ignore status"
                          >
                            ✕
                          </Button>
                        </>
                      ) : (
                        <>
                          {/* Default "Map to Planday field" button */}
                          <Button
                            onClick={() => openFieldModal(column.name)}
                            className="justify-start text-gray-700 transition-all duration-200 flex-1 group-hover:mr-12"
                            variant="outline"
                          >
                            Map to Planday field
                          </Button>
                          {/* Ignore button - slides in from right */}
                          <Button
                            onClick={() => handleIgnoreColumn(column.name)}
                            className="text-orange-600 border-gray-300 hover:bg-orange-50 hover:border-orange-300 transition-all duration-200 opacity-0 absolute right-0 w-10 px-0 group-hover:opacity-100"
                            variant="outline"
                            title="Ignore this column"
                          >
                            🚫
                          </Button>
                        </>
                      )}
                    </div>
                    
                    {/* Field description */}
                    {mappedField && mappedField !== '__IGNORE__' && (
                      <div className="text-xs text-gray-500 mt-1 space-y-1">
                        {/* Field badges */}
                        {(() => {
                          const field = plandayFields.find(f => f.name === mappedField);
                          const badges = [];
                          if (field?.isRequired) badges.push('Required');
                          if (field?.isUnique) badges.push('Must be unique');
                          // Note: Read-only badge removed - for bulk import (new employees), these fields CAN be set initially
                          if (field?.isCustom) badges.push('Custom field');
                          return badges.length > 0 ? (
                            <div>{badges.join(' • ')}</div>
                          ) : null;
                        })()}
                        
                        {/* Enum options hint */}
                        {(() => {
                          try {
                            const enumOptions = FieldDefinitionValidator.getFieldOptions(mappedField);
                            if (enumOptions.length > 0) {
                              const optionsText = enumOptions.slice(0, 4).map(opt => opt.name).join(', ');
                              return (
                                <div className="flex items-start gap-1">
                                  <span className="text-blue-500">📋</span>
                                  <span>
                                    <span className="font-medium">Options: </span>
                                    {optionsText}
                                    {enumOptions.length > 4 && ` (+${enumOptions.length - 4} more)`}
                                  </span>
                                </div>
                              );
                            }
                          } catch {
                            // No enum options available
                          }
                          return null;
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Custom Values Section */}
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Custom Values
              </h3>
              <p className="text-sm text-gray-600">
                Set the same value for ALL employees in a specific field (e.g., all employees get "Male" for gender)
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleAddCustomValue}
              className="text-blue-600 border-blue-300 hover:bg-blue-50"
            >
              + Add Custom Value
            </Button>
          </div>

          {Object.keys(customValues).length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No custom values added yet.</p>
              <p className="text-sm">Click "Add Custom Value" to set static values for missing fields.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(customValues).map(([fieldName, value]) => {
                const selectedField = plandayFields.find(f => f.name === fieldName);
                const isFieldSelected = !!selectedField;
                
                return (
                  <div 
                    key={fieldName}
                    className="grid grid-cols-12 gap-4 items-center p-3 rounded-lg transition-colors hover:bg-gray-50"
                  >
                    {/* Custom Field Name & Value (Left) */}
                    <div className="col-span-5">
                      <div className={`p-3 rounded-lg border-2 ${
                        value.trim() && isFieldSelected
                          ? 'bg-green-50 border-green-200' 
                          : 'bg-gray-50 border-gray-200'
                      }`}>
                        <div className="space-y-2">
                          <input
                            type="text"
                            value={value}
                            onChange={(e) => handleCustomValueChange(fieldName, e.target.value)}
                            placeholder="Static value (e.g., Male, Kitchen, Manager)"
                            className="w-full text-lg font-medium bg-transparent border-none outline-none placeholder-gray-400"
                          />
                          <div className="text-xs text-gray-500">
                            This value will be applied to ALL employees
                          </div>
                        </div>
                        {value.trim() && isFieldSelected && (
                          <div className="text-xs text-green-600 mt-2 flex items-center">
                            <span className="mr-1">🔧</span>
                            All employees will get: "<strong>{value}</strong>"
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Arrow (Center) */}
                    <div className="col-span-2 flex justify-center">
                      <div className={`text-2xl font-bold ${
                        value.trim() && isFieldSelected
                          ? 'text-green-500' 
                          : 'text-gray-300'
                      }`}>
                        →
                      </div>
                    </div>

                    {/* Planday Field Button (Right) */}
                    <div className="col-span-4">
                      {isFieldSelected ? (
                        <Button
                          onClick={() => openCustomValueFieldModal(fieldName)}
                          className="bg-green-100 border-green-300 text-green-800 hover:bg-green-200 hover:border-green-400 justify-start transition-all duration-200 w-full"
                          variant="outline"
                        >
                          <div className="flex items-center">
                            <span className="text-green-600 mr-2">✓</span>
                            <span className="font-mono">
                              {selectedField.isCustom ? (selectedField.description || selectedField.displayName || selectedField.name) : (selectedField.displayName || selectedField.name)}
                            </span>
                          </div>
                        </Button>
                      ) : (
                        <Button
                          onClick={() => openCustomValueFieldModal(fieldName)}
                          className="text-gray-600 border-gray-300 hover:bg-gray-50 hover:border-gray-400 justify-start w-full"
                          variant="outline"
                        >
                          <span className="text-gray-400 mr-2">📋</span>
                          Select Planday field...
                        </Button>
                      )}
                      
                      {/* Field description */}
                      {isFieldSelected && (
                        <div className="text-xs text-gray-500 mt-1 space-y-1">
                          {/* Field badges */}
                          {(() => {
                            const badges = [];
                            if (selectedField.isRequired) badges.push('Required');
                            if (selectedField.isUnique) badges.push('Must be unique');
                            // Note: Read-only badge removed - for bulk import (new employees), these fields CAN be set initially
                            if (selectedField.isCustom) badges.push('Custom field');
                            return badges.length > 0 ? (
                              <div>{badges.join(' • ')}</div>
                            ) : null;
                          })()}
                          
                          {/* Enum options hint */}
                          {(() => {
                            try {
                              const enumOptions = FieldDefinitionValidator.getFieldOptions(selectedField.name);
                              if (enumOptions.length > 0) {
                                const optionsText = enumOptions.slice(0, 4).map(opt => opt.name).join(', ');
                                return (
                                  <div className="flex items-start gap-1">
                                    <span className="text-blue-500">📋</span>
                                    <span>
                                      <span className="font-medium">Options: </span>
                                      {optionsText}
                                      {enumOptions.length > 4 && ` (+${enumOptions.length - 4} more)`}
                                    </span>
                                  </div>
                                );
                              }
                            } catch {
                              // No enum options available
                            }
                            return null;
                          })()}
                        </div>
                      )}
                    </div>

                    {/* Remove Button */}
                    <div className="col-span-1 flex justify-center">
                      <button
                        onClick={() => handleRemoveCustomValue(fieldName)}
                        className="text-gray-400 hover:text-red-500 transition-colors p-1"
                        title="Remove custom value"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Actions */}
      <Card className="p-4">
        <div className="flex justify-end items-center">
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-500">
              {unmappedRequiredFields.length === 0 && mappingErrors.length === 0 ? 
                `${mappedFieldsCount} Excel columns + ${customValuesCount} custom values mapped` :
                `${unmappedRequiredFields.length + mappingErrors.length} mapping issues`
              }
            </div>
            
            <Button
              onClick={handleSubmit}
              disabled={unmappedRequiredFields.length > 0 || mappingErrors.length > 0}
              className="bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed disabled:opacity-60 transition-all duration-200"
            >
              Continue to Validation →
            </Button>
          </div>
        </div>
      </Card>

      {/* Field Selection Modal */}
      <FieldSelectionModal
        isOpen={modalState.isOpen}
        onClose={closeFieldModal}
        onSelectField={handleFieldSelect}
        availableFields={modalState.columnName ? getAvailableFields(modalState.columnName) : []}
        currentMapping={modalState.columnName ? columnMappings[modalState.columnName] : undefined}
        columnName={modalState.columnName || ''}
      />

      {/* Custom Values Field Selection Modal */}
      <FieldSelectionModal
        isOpen={customValueModalState.isOpen}
        onClose={closeCustomValueFieldModal}
        onSelectField={handleCustomFieldSelect}
        availableFields={getAvailableFieldsForCustom(customValueModalState.fieldName || undefined)}
        currentMapping={customValueModalState.fieldName || undefined}
        columnName={customValueModalState.fieldName || 'Select Field for Custom Value'}
      />
    </div>
  );
};

export default MappingStep; 