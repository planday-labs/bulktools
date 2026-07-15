/**
 * Combined Validation & Correction Step Component
 * Handles both bulk corrections for invalid names and individual data corrections
 * This is the unified step that replaces separate validation and correction steps
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Card, Button } from '../ui';
import { MappingUtils, DateParser, ValidationService, type ErrorPattern, type BulkCorrectionSummary } from '../../services/mappingService';
import { DatePatternAnalyzer } from '../../utils/datePatternAnalyzer';
import { DataCorrectionStep } from './DataCorrectionStep';
import { DateFormatSelectionStep } from './DateFormatSelectionStep';
import type { UsePlandayApiReturn } from '../../hooks/usePlandayApi';
import type { ExcludedEmployee } from '../../types/planday';

interface ValidationAndCorrectionStepProps {
  employees: any[];
  departments: any[];
  employeeGroups: any[];
  employeeTypes: any[];
  resolvedPatterns?: Map<string, string>;
  onPatternsResolved?: (patterns: Map<string, string>) => void;
  onComplete: (correctedEmployees: any[], excludedEmployees?: ExcludedEmployee[]) => void;
  onBack: () => void;
  plandayApi: UsePlandayApiReturn;
  resyncNonce?: number;
  className?: string;
}

// Wrapper component that preprocesses data through validateAndConvert to create display fields
const DataCorrectionStepWithPreprocessing: React.FC<{
  employees: any[];
  departments: any[];
  employeeGroups: any[];
  employeeTypes: any[];
  plandayApi: UsePlandayApiReturn;
  resyncNonce?: number;
  onComplete: (correctedEmployees: any[], excludedEmployees?: ExcludedEmployee[]) => void;
  onBack: () => void;
  className?: string;
}> = ({ employees, departments, employeeGroups, employeeTypes, plandayApi, resyncNonce, onComplete, onBack, className }) => {
  const [preprocessedEmployees, setPreprocessedEmployees] = useState<any[]>([]);
  const [isPreprocessing, setIsPreprocessing] = useState(true);

  useEffect(() => {
    const preprocessData = async () => {
      try {
        setIsPreprocessing(true);
        
        // Initialize mapping service with portal data
        MappingUtils.initialize(departments, employeeGroups, employeeTypes);
        
        // Process each employee through validateAndConvert to create display fields
        const processedEmployees = await Promise.all(
          employees.map(async (employee) => {
            try {
              const result = await MappingUtils.validateEmployee(employee);
              // Use the converted data which includes display fields
              const mergedEmployee = { ...employee, ...result.converted };
              
              // Merge original and converted data
              
              return mergedEmployee;
            } catch (error) {
              console.warn('⚠️ Error preprocessing employee:', error);
              // Return original employee if preprocessing fails
              return employee;
            }
          })
        );
        

        
        setPreprocessedEmployees(processedEmployees);
      } catch (error) {
        console.error('❌ Error preprocessing data:', error);
        // Fallback to original data
        setPreprocessedEmployees(employees);
      } finally {
        setIsPreprocessing(false);
      }
    };

    if (employees.length > 0 && departments.length > 0) {
      preprocessData();
    } else {
      setPreprocessedEmployees(employees);
      setIsPreprocessing(false);
    }
    // Intentionally depends only on `employees`. A portal-data resync changes the
    // departments/groups/types references, but re-preprocessing here would unmount
    // DataCorrectionStep and rebuild it from the pre-edit baseline, discarding the
    // user's in-progress cell edits. Resync re-validation is handled inside
    // DataCorrectionStep via resyncNonce instead, which preserves entered values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees]);

  if (isPreprocessing) {
    return (
      <div className={`validation-correction-step ${className}`}>
        <Card className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-4"></div>
            <span className="text-gray-600">Processing data for individual corrections...</span>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <DataCorrectionStep
      employees={preprocessedEmployees}
      departments={departments}
      employeeGroups={employeeGroups}
      employeeTypes={employeeTypes}
      plandayApi={plandayApi}
      resyncNonce={resyncNonce}
      onComplete={onComplete}
      onBack={onBack}
      className={className}
    />
  );
};

interface CorrectionCardProps {
  pattern: ErrorPattern;
  validOptions: Array<{id: number, name: string}>;
  isResolved: boolean;
  pendingCorrection?: string; // New prop for pending corrections
  onPendingCorrection: (pattern: ErrorPattern, newValue: string) => void; // New prop for handling pending selections
}

const CorrectionCard: React.FC<CorrectionCardProps> = ({ 
  pattern, 
  validOptions, 
  isResolved, 
  pendingCorrection,
  onPendingCorrection 
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedOption, setSelectedOption] = useState<string>(pendingCorrection || '');

  const confidencePercent = Math.round(pattern.confidence * 100);

  const handleSuggestedCorrection = () => {
    if (pattern.suggestion) {
      onPendingCorrection(pattern, pattern.suggestion);
    }
  };

  const handleDropdownSelection = (value: string) => {
    // Select change event triggered
    // Set pending selection - don't apply immediately
    if (value) {
      // Pending selection set
      onPendingCorrection(pattern, value);
      setSelectedOption(value);
    }
  };

  const handleEditSelection = () => {
    // Clear the pending selection to allow re-selection
    onPendingCorrection(pattern, '');
    setSelectedOption('');
  };

  if (isResolved) {
    return (
      <Card className="mb-4 border-l-4 border-l-green-400 bg-green-50">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center">
                <span className="text-white text-sm">✓</span>
              </div>
              <div className="flex-1">
                <div className="text-sm text-green-800 font-medium">
                  "{pattern.invalidName}" has been mapped successfully
                </div>
                <div className="text-xs text-green-600">
                  {pattern.count} rows corrected
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPendingCorrection(pattern, '')} // Clear the resolved state to allow modification
              className="text-green-700 hover:text-green-800 border-green-300 hover:bg-green-100"
            >
              Modify
            </Button>
          </div>
        </div>
      </Card>
    );
  }



  // If we have a pending correction, show green confirmation
  if (pendingCorrection) {
    return (
      <Card className="mb-4 border-l-4 border-l-green-400 bg-green-50">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center">
                <span className="text-white text-sm">✓</span>
              </div>
              <div className="flex-1">
                <div className="text-sm text-green-800 font-medium">
                  Pending: "{pattern.invalidName}" → "{pendingCorrection}"
                </div>
                <div className="text-xs text-green-600">
                  Will correct {pattern.count} rows when you continue
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleEditSelection}
              className="text-green-700 hover:text-green-800 border-green-300 hover:bg-green-100"
            >
              Edit
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-4 border-l-4 border-l-red-400">
      <div className="p-4">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-gray-600 capitalize">
                {pattern.field === 'employeeGroups' ? 'Employee Groups' :
                 pattern.field === 'employeeTypes' ? 'Employee Types' :
                 pattern.field === 'supervisors' ? 'Supervisors' : 'Departments'}
              </span>
              <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                Must be corrected
              </span>
            </div>

            <div className="text-lg mb-2">
              <span className="text-red-600 font-bold">❌ "{pattern.invalidName}"</span>
              <span className="text-gray-600 mx-2">
                {pattern.errorMessage?.includes('Multiple')
                  ? 'matches multiple people in Planday'
                  : "doesn't exist in Planday"}
              </span>
            </div>
            
            <div className="text-sm text-gray-600 mb-3">
              Found in <span className="font-semibold">{pattern.count} rows</span> - must be mapped to a valid option
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs"
          >
            {isExpanded ? 'Hide Rows' : `Show ${pattern.count} Rows`}
          </Button>
        </div>

        <div className="space-y-3">
          {/* Special handling for ambiguous supervisor names */}
          {pattern.field === 'supervisors' && pattern.errorMessage?.includes('Multiple') ? (
            <div className="space-y-3">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="text-amber-600 text-xl">⚠️</span>
                  <div className="flex-1">
                    <h4 className="font-medium text-amber-800 mb-2">Ambiguous Supervisor Name</h4>
                    <p className="text-sm text-amber-700 mb-3">
                      {pattern.errorMessage}
                    </p>
                    <p className="text-sm text-amber-700">
                      Select one of the matching supervisors below, or go back to your Excel file and use a specific ID.
                    </p>
                  </div>
                </div>
              </div>
              {/* Allow selecting from the matching supervisors */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select the correct supervisor:
                </label>
                <select
                  value={selectedOption}
                  onChange={(e) => handleDropdownSelection(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Select the correct supervisor...</option>
                  {validOptions
                    .filter(opt => opt.name.toLowerCase() === pattern.invalidName.toLowerCase())
                    .map(option => (
                      <option key={option.id} value={option.id.toString()}>
                        {option.name} (ID: {option.id})
                      </option>
                    ))}
                </select>
              </div>
            </div>
          ) : (
            <>
              {pattern.suggestion && (
                <div>
                  <Button
                    onClick={handleSuggestedCorrection}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-2"
                  >
                    <span className="text-lg">✨</span>
                    Map to "{pattern.suggestion}" (suggested match - {confidencePercent}% confidence)
                  </Button>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {pattern.suggestion ? 'Or choose a different' : 'Choose a'} {
                    pattern.field === 'employeeGroups' ? 'employee group' :
                    pattern.field === 'employeeTypes' ? 'employee type' :
                    pattern.field === 'supervisors' ? 'supervisor' : 'department'
                  }:
                </label>
                {/* Debug info for empty dropdown */}
                {validOptions.length === 0 && (
                  <div className="mb-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                    ⚠️ No valid {
                      pattern.field === 'employeeGroups' ? 'employee groups' :
                      pattern.field === 'employeeTypes' ? 'employee types' :
                      pattern.field === 'supervisors' ? 'supervisors' : 'departments'
                    } available.
                    Check console for debugging info.
                  </div>
                )}
                <select
                  value={selectedOption}
                  onChange={(e) => handleDropdownSelection(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Select valid option...</option>
                  {validOptions.length === 0 ? (
                    <option value="" disabled>No options available</option>
                  ) : (
                    validOptions
                      .filter(option => option.name !== pattern.suggestion)
                      .map(option => (
                        <option key={option.id} value={pattern.field === 'supervisors' ? option.id.toString() : option.name}>
                          {pattern.field === 'supervisors' ? `${option.name} (ID: ${option.id})` : option.name}
                        </option>
                      ))
                  )}
                </select>
              </div>
            </>
          )}
        </div>

        {isExpanded && (
          <div className="mt-4 p-3 bg-gray-50 rounded-lg">
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              Affected Rows ({pattern.rows.length}):
            </h4>
            <div className="text-sm text-gray-600">
              {pattern.rows.length <= 15 
                ? pattern.rows.join(', ')
                : `${pattern.rows.slice(0, 15).join(', ')} and ${pattern.rows.length - 15} more...`
              }
            </div>
            <div className="mt-2 text-xs text-gray-500">
              All instances of "{pattern.invalidName}" in these rows will be updated
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

const ValidationAndCorrectionStep: React.FC<ValidationAndCorrectionStepProps> = ({
  employees,
  departments,
  employeeGroups,
  employeeTypes,
  resolvedPatterns: initialResolvedPatterns,
  onPatternsResolved,
  onComplete,
  onBack,
  plandayApi,
  resyncNonce,
  className = ''
}) => {
  const [currentPhase, setCurrentPhase] = useState<'bulk-correction' | 'date-format-selection' | 'individual-correction' | 'complete'>('bulk-correction');
  const [correctionSummary, setCorrectionSummary] = useState<BulkCorrectionSummary | null>(null);
  const [originalCorrectionSummary, setOriginalCorrectionSummary] = useState<BulkCorrectionSummary | null>(null); // Preserve original summary
  const [resolvedPatterns, setResolvedPatterns] = useState<Map<string, string>>(initialResolvedPatterns || new Map());
  const [currentEmployees, setCurrentEmployees] = useState(employees);

  const [pendingCorrections, setPendingCorrections] = useState<Map<string, string>>(new Map());
  const [hasNavigatedToIndividualCorrection, setHasNavigatedToIndividualCorrection] = useState(false); // Track navigation
  const [helperCompletionState, setHelperCompletionState] = useState({
    bulkCorrectionsCompleted: false,
    dateFormatCompleted: false
  }); // Track which helpers have been completed in this forward journey
  
  // Date format selection state (replacing modal)
  const [ambiguousDateSamples, setAmbiguousDateSamples] = useState<string[]>([]);


  // Update currentEmployees when employees prop changes
  useEffect(() => {
    setCurrentEmployees(employees);
  }, [employees]);

  // Only reset helper completion state when truly starting fresh (not on every re-render)
  useEffect(() => {
    // Setting initial phase and helper state
    setHelperCompletionState({
      bulkCorrectionsCompleted: false,
      dateFormatCompleted: false
    });
    setHasNavigatedToIndividualCorrection(false);
    setCurrentPhase('bulk-correction'); // Always start with bulk correction phase when coming forward
    
    // Component initialized
  }, []); // Only run on mount, not on every prop change

  // Initialize and detect bulk correction patterns
  useEffect(() => {
    // ValidationAndCorrectionStep: Initializing with provided data
    // (removed excessive debug logging for cleaner console output)
    
    // Reset DateParser for new validation session
    DateParser.resetUserDateFormat();
    
    // Additional debugging: test getAvailableOptions directly
    MappingUtils.initialize(departments, employeeGroups, employeeTypes);
    
    // Fresh detection from current data - always re-evaluate
    const summary = MappingUtils.detectCommonErrors(employees);
    
    // Store original summary if this is the first time
    if (!originalCorrectionSummary) {
      setOriginalCorrectionSummary(summary);
    }
    
    setCorrectionSummary(summary);
    
    // Surgical fix: If no bulk corrections needed, skip directly to next step
    if (summary.patterns.length === 0) {
      // No bulk corrections needed - proceed directly using the normal workflow
      // This triggers the same logic as clicking "Continue" on an empty bulk corrections step
      setTimeout(() => {
        handleProceedToIndividualCorrections();
      }, 0);
    }
  }, [employees, departments, employeeGroups, employeeTypes]); // Removed conflicting dependencies

  // Separate useEffect for state initialization - runs when initialResolvedPatterns changes
  useEffect(() => {
    
    if (initialResolvedPatterns && initialResolvedPatterns.size > 0) {
      // Convert resolved patterns back to pending corrections for editing
      const newPendingCorrections = new Map<string, string>();
      for (const [patternKey, correctionValue] of initialResolvedPatterns.entries()) {
        newPendingCorrections.set(patternKey, correctionValue);
      }
      setPendingCorrections(newPendingCorrections);
      
      // Clear resolved patterns so they show as editable pending corrections
      setResolvedPatterns(new Map());
    } else {
      // Clear both pending and resolved patterns for fresh start
      setPendingCorrections(new Map());
      setResolvedPatterns(new Map());
    }
  }, [initialResolvedPatterns]); // Run whenever initialResolvedPatterns changes

  // Handle pending correction selection
  const handlePendingCorrection = (pattern: ErrorPattern, newValue: string) => {
    const patternKey = `${pattern.field}:${pattern.invalidName}`;
    
    if (newValue) {
      // Setting pending correction
      setPendingCorrections(prev => new Map(prev.set(patternKey, newValue)));
    } else {
      // Clearing pending correction OR unresolving a resolved pattern
      setPendingCorrections(prev => {
        const newMap = new Map(prev);
        newMap.delete(patternKey);
        return newMap;
      });
      
      // If this pattern was resolved, unresolve it so user can modify the correction
      if (resolvedPatterns.has(patternKey)) {
        const newResolvedPatterns = new Map(resolvedPatterns);
        newResolvedPatterns.delete(patternKey);
        setResolvedPatterns(newResolvedPatterns);
        onPatternsResolved?.(newResolvedPatterns);
      }
    }
  };



  // Check if all bulk corrections are complete (all patterns have pending corrections)
  const allBulkCorrectionsComplete = useMemo(() => {
    const patternsToCheck = correctionSummary?.patterns || [];
      
    return patternsToCheck.every(pattern => {
      const patternKey = `${pattern.field}:${pattern.invalidName}`;
      return pendingCorrections.has(patternKey);
    });
  }, [correctionSummary, pendingCorrections]);



  /**
   * Check for ambiguous dates across ALL optionalDate fields in the entire dataset
   * Uses NEW comprehensive pattern analyzer - performs dataset-level analysis
   */
  const checkForAmbiguousDatesInMappedFields = (employees: any[]): string[] => {
    // Get ALL fields that are of type optionalDate (both standard and custom)
    const allDateFields = ValidationService.getAllDateFields();
    
    // Collect ALL date values from ALL optionalDate fields across the entire dataset
    const allDateValues: string[] = [];
    
    employees.forEach(employee => {
      allDateFields.forEach(field => {
        const value = employee[field];
        if (value && typeof value === 'string' && value.trim()) {
          const trimmed = value.trim();
          // Only consider values that could be dates
          if (DateParser.couldBeDate(trimmed)) {
            allDateValues.push(trimmed);
          }
        }
      });
    });
    
    // NEW: Use comprehensive pattern analyzer
    const analysis = DatePatternAnalyzer.analyzeDatasetPattern(allDateValues);
    
    if (analysis.autoDetectedFormat) {
      // Auto-detection successful - set the format and return no ambiguous dates

      DateParser.setUserDateFormat(analysis.autoDetectedFormat);
      return [];
    }
    
    if (analysis.shouldShowPicker) {
      // Pattern analysis indicates user clarification needed

      return analysis.ambiguousSamples;
    }
    
    // No ambiguous patterns detected
    return [];
  };

  /**
   * Re-convert all dates after user selects format
   * Uses dynamic detection of all optionalDate fields
   */
  const reConvertDatesWithUserFormat = async (employees: any[]): Promise<any[]> => {
    
    // Get ALL fields that are of type optionalDate (both standard and custom)
    const allDateFields = ValidationService.getAllDateFields();
    
    const convertedEmployees = [];
    
    for (const employee of employees) {
      // Create a copy and re-run date conversion with user's format choice
      const employeeCopy = { ...employee };
      
      // Re-process all optionalDate fields
      for (const field of allDateFields) {
        if (employeeCopy[field] && typeof employeeCopy[field] === 'string' && employeeCopy[field].trim()) {
          const dateStr = employeeCopy[field].toString().trim();
          
          if (DateParser.couldBeDate(dateStr)) {
            const convertedDate = DateParser.parseToISO(dateStr);
            if (convertedDate) {
              employeeCopy[field] = convertedDate;
            }
          }
        }
      }
      
      convertedEmployees.push(employeeCopy);
    }
    
    return convertedEmployees;
  };

  /**
   * Handle date format selection from page step
   */
  const handleDateFormatSelection = async (format?: 'DD/MM/YYYY' | 'MM/DD/YYYY') => {
    if (format) {
      DateParser.setUserDateFormat(format);
      
      // Re-convert all dates with the selected format
      const reConvertedEmployees = await reConvertDatesWithUserFormat(currentEmployees);
      setCurrentEmployees(reConvertedEmployees);
      
      // Mark date format as completed
      setHelperCompletionState(prev => ({ ...prev, dateFormatCompleted: true }));
      
      setAmbiguousDateSamples([]);
      
      // Continue to individual corrections after date format is resolved
      setHasNavigatedToIndividualCorrection(true); // Mark that we've navigated to individual corrections
      setCurrentPhase('individual-correction');
    } else {
      // User cancelled - go back to bulk correction
      setAmbiguousDateSamples([]);
      setCurrentPhase('bulk-correction');
    }
  };

  // Handle proceeding to individual corrections
  const handleProceedToIndividualCorrections = async () => {
    // If there are pending corrections, apply them and immediately proceed (first-time completion)
    let employeesToUse = currentEmployees;
    const newResolvedPatterns = new Map(resolvedPatterns);
    const hadPendingCorrections = pendingCorrections.size > 0;
    
    if (pendingCorrections.size > 0) {
      
      try {
        // Apply each pending correction
        for (const [patternKey, newValue] of pendingCorrections.entries()) {
          const pattern = correctionSummary?.patterns.find(p => 
            `${p.field}:${p.invalidName}` === patternKey
          );
          
          if (pattern) {
            employeesToUse = MappingUtils.applyBulkCorrection(employeesToUse, pattern, newValue);
            newResolvedPatterns.set(patternKey, newValue);
          } else {
            console.warn(`⚠️ Pattern not found for correction: ${patternKey}`);
          }
        }
        
        // Clear pending corrections after applying them
        setPendingCorrections(new Map());
      } catch (error) {
        console.error('❌ Error applying pending corrections:', error);
      }
    }
    
    // Mark bulk corrections as completed
    setHelperCompletionState(prev => ({ ...prev, bulkCorrectionsCompleted: true }));
    
    // CRITICAL: Save resolved patterns to parent state BEFORE checking dates
    // This ensures bulk corrections are saved even if we have ambiguous dates
    if (hadPendingCorrections || newResolvedPatterns.size > 0) {
      onPatternsResolved?.(newResolvedPatterns);
    }
    
    // ALWAYS check for ambiguous dates when proceeding forward
    const ambiguousDates = checkForAmbiguousDatesInMappedFields(employeesToUse);
    
    if (ambiguousDates.length > 0 && !helperCompletionState.dateFormatCompleted) {
      // Found ambiguous dates - show date format selection page
      setAmbiguousDateSamples(ambiguousDates);
      setCurrentEmployees(employeesToUse);
      setCurrentPhase('date-format-selection');
      return; // Early return is OK now - patterns already saved above
    }
    
    // No ambiguous dates - proceed directly to individual corrections
    setCurrentEmployees(employeesToUse);
    setHasNavigatedToIndividualCorrection(true);
    setCurrentPhase('individual-correction');
  };



  // Show loading state while correction summary is being calculated
  if (!correctionSummary && currentPhase === 'bulk-correction') {
    return (
      <div className={`validation-correction-step ${className}`}>
        <Card className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-4"></div>
            <span className="text-gray-600">Analyzing data for validation...</span>
          </div>
        </Card>
      </div>
    );
  }

  // Render date format selection page
  if (currentPhase === 'date-format-selection') {
    return (
      <div className={`validation-correction-step ${className}`}>
        <DateFormatSelectionStep
          samples={ambiguousDateSamples}
          onComplete={handleDateFormatSelection}
          onBack={onBack}
          className={className}
        />
      </div>
    );
  }

  // Render bulk correction phase
  if (currentPhase === 'bulk-correction') {
    return (
      <div className={`validation-correction-step ${className}`}>
        


        {/* Header */}
        <Card className="p-6 mb-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-orange-600 text-2xl">🔧</span>
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">
              Fix Invalid Names
            </h3>
            <p className="text-gray-600">
              These department/employee group/employee type names don't exist in Planday and must be corrected before proceeding.
            </p>
          </div>
        </Card>

        {/* Bulk Correction Summary */}
        {correctionSummary && (
          <Card className="p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-semibold text-gray-900">
                Bulk Corrections Required
              </h4>
              <div className="text-sm text-gray-600">
                {`${pendingCorrections.size} of ${correctionSummary.patterns.length} corrections set`}
              </div>
            </div>

            {correctionSummary.patterns.length === 0 && !hasNavigatedToIndividualCorrection ? (
              <div className="text-center py-8">
                <div className="text-green-600 text-4xl mb-4">✅</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  No Invalid Names Found
                </h3>
                <p className="text-gray-600 mb-4">
                  All department and employee group names are valid in Planday.
                </p>
                
                {/* Navigation buttons - consistent with other phases */}
                <div className="flex justify-between items-center">
                  <Button
                    variant="outline"
                    onClick={onBack}
                    className="text-gray-600 hover:bg-gray-50"
                  >
                    ← Back to Mapping
                  </Button>
                  
                  <Button onClick={handleProceedToIndividualCorrections} className="bg-green-600 hover:bg-green-700 text-white">
                    Continue to Data Validation →
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* Correction Cards */}
                {correctionSummary.patterns.map(pattern => {
                  const validOptions = MappingUtils.getAvailableOptions(pattern.field);
                  const patternKey = `${pattern.field}:${pattern.invalidName}`;
                  const pendingCorrection = pendingCorrections.get(patternKey);
                  
                  return (
                    <CorrectionCard
                      key={patternKey}
                      pattern={pattern}
                      validOptions={validOptions}
                      isResolved={false} // Never show as resolved - always show as editable pending corrections
                      pendingCorrection={pendingCorrection}
                      onPendingCorrection={handlePendingCorrection}
                    />
                  );
                })}

                {/* Progress Actions */}
                <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                  <div className="flex justify-between items-center">
                    <Button
                      variant="outline"
                      onClick={onBack}
                      className="text-gray-600 hover:bg-gray-50"
                    >
                      ← Back to Mapping
                    </Button>
                    
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-gray-600">
                        {(() => {
                          const totalPatterns = correctionSummary.patterns.length;
                          const remainingCorrections = totalPatterns - pendingCorrections.size;
                          
                          if (allBulkCorrectionsComplete) {
                            return 'All corrections set!';
                          } else {
                            return `${remainingCorrections} corrections remaining`;
                          }
                        })()}
                      </span>
                      
                      <Button
                        onClick={handleProceedToIndividualCorrections}
                        disabled={!allBulkCorrectionsComplete}
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        {allBulkCorrectionsComplete ? 
                          'Continue to Data Validation →' : 
                          'Select corrections to continue'
                        }
                      </Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </Card>
        )}
      </div>
    );
  }

  // Render individual correction phase with proper validation
  if (currentPhase === 'individual-correction') {
    return (
      <DataCorrectionStepWithPreprocessing
        employees={currentEmployees}
        departments={departments}
        employeeGroups={employeeGroups}
        employeeTypes={employeeTypes}
        plandayApi={plandayApi}
        resyncNonce={resyncNonce}
        onComplete={(correctedEmployees, excludedEmployees) => {
          setCurrentEmployees(correctedEmployees);
          // Individual corrections completed
          // ValidationAndCorrectionStep - calling onComplete with corrected employees
          onComplete(correctedEmployees, excludedEmployees); // Pass through excluded employees
        }}
        onBack={() => {
          // Backward navigation: skip helpers and go directly to Column Mapping
          // Navigate back to column mapping
          onBack();
        }}
        className={className}
      />
    );
  }

  // Fallback render - should never reach here, but prevents white screen
  return (
    <div className={`validation-correction-step ${className}`}>
      <Card className="p-6">
        <div className="text-center">
          <div className="text-yellow-600 text-4xl mb-4">⚠️</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Unexpected State
          </h3>
          <p className="text-gray-600 mb-4">
            Current phase: {currentPhase}
          </p>
          <Button variant="secondary" onClick={onBack}>
            ← Go Back
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default ValidationAndCorrectionStep; 