/**
 * Data Correction Step Component
 * Provides editable data grid for final employee record corrections
 * Features:
 * - Inline cell editing with validation
 * - Real-time validation feedback
 * - Bulk edit capabilities
 * - Smart suggestions for common fixes
 * - Session persistence during editing
 * - Keyboard navigation support
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button, Input, Card } from '../ui';
import { ValidationService } from '../../services/mappingService';
import { VALIDATION_CONFIG } from '../../constants';

import type {
  Employee,
  ValidationError,
  ExcludedEmployee,
  PlandayDepartment,
  PlandayEmployeeGroup,
  PlandayEmployeeType,
  PlandayEmployeeResponse
} from '../../types/planday';
import type { UsePlandayApiReturn } from '../../hooks/usePlandayApi';



interface DataCorrectionStepProps {
  employees: Employee[];
  departments: PlandayDepartment[];
  employeeGroups: PlandayEmployeeGroup[];
  employeeTypes: PlandayEmployeeType[];
  plandayApi: UsePlandayApiReturn;
  resyncNonce?: number;
  onComplete: (correctedEmployees: Employee[], excludedEmployees?: ExcludedEmployee[]) => void;
  onBack: () => void;
  className?: string;
}

interface EditingCell {
  rowIndex: number;
  field: keyof Employee;
  value: string;
}

// Removed unused interface CellValidation

/**
 * Data Correction Step Component
 */
export const DataCorrectionStep: React.FC<DataCorrectionStepProps> = ({
  employees: initialEmployees,
  departments,
  employeeGroups,
  employeeTypes,
  plandayApi,
  resyncNonce,
  onComplete,
  onBack,
  className = ''
}) => {
  // Initialize component with employee data

  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [validationErrors, setValidationErrors] = useState<Map<string, ValidationError[]>>(new Map());
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [bulkEditField, setBulkEditField] = useState<keyof Employee | ''>('');
  const [bulkEditValue, setBulkEditValue] = useState('');
  const [bulkEditMode, setBulkEditMode] = useState<'replace' | 'prepend' | 'append'>('replace');
  const [searchFilter, setSearchFilter] = useState('');
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [showProceedWithErrorsModal, setShowProceedWithErrorsModal] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // New state for duplicate checking
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [existingEmployees, setExistingEmployees] = useState<Map<string, PlandayEmployeeResponse>>(new Map());
  const [existingSsnEmployees, setExistingSsnEmployees] = useState<Map<string, PlandayEmployeeResponse>>(new Map());
  const [ssnCheckUnavailable, setSsnCheckUnavailable] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize mapping service with department, employee group, and employee type data
  useEffect(() => {
    // Note: MappingService doesn't have setDepartments/setEmployeeGroups methods
    // This will be handled directly in validation
    // DataCorrectionStep initialized with provided data
  }, [departments, employeeGroups, employeeTypes]);

  // Check for existing employees with duplicate emails on component initialization
  useEffect(() => {
    const checkForExistingEmployees = async () => {
      try {
        setIsCheckingDuplicates(true);
        // Checking for existing employees with duplicate emails
        
        // Extract email addresses from employees
        const emailAddresses = employees
          .map(emp => emp.email)
          .filter(email => email && email.trim() !== '')
          .map(email => email!.toLowerCase().trim());

        // Extract SSNs (exact-string, no normalization beyond dropping empties)
        const ssnValues = employees
          .map(emp => (emp as any).ssn)
          .filter(ssn => ssn !== null && ssn !== undefined && String(ssn).trim() !== '')
          .map(ssn => String(ssn));

        if (emailAddresses.length === 0 && ssnValues.length === 0) {
          setIsCheckingDuplicates(false);
          return;
        }

        // Check for existing employees by email and SSN
        if (emailAddresses.length > 0) {
          const existingEmps = await plandayApi.checkExistingEmployeesByEmail(emailAddresses);
          setExistingEmployees(existingEmps);
        }

        if (ssnValues.length > 0) {
          const ssnResult = await plandayApi.checkExistingEmployeesBySsn(ssnValues);
          setExistingSsnEmployees(ssnResult.existing);
          setSsnCheckUnavailable(!ssnResult.available);
        }

        // Existing employees check completed

      } catch (error) {
        console.error('❌ Failed to check for existing employees:', error);
        // Don't block validation if duplicate check fails - just log and continue
      } finally {
        setIsCheckingDuplicates(false);
      }
    };

    // Only check if we have authentication and employees
    if (plandayApi.isAuthenticated && employees.length > 0) {
      checkForExistingEmployees();
    }
  }, [employees.length]); // Only run when employees change, not on every re-render

  // Validate all employees on component mount and when data changes.
  // resyncNonce is included so a portal-data resync (which repopulates the validation
  // caches without changing the employee rows) forces a fresh validation pass — newly
  // created portal options then clear their "not found in Planday" errors.
  useEffect(() => {
    // Re-running validation due to data changes
    validateAllEmployees().catch(error => {
      console.error('❌ Validation failed:', error);
    });
  }, [employees, existingEmployees, existingSsnEmployees, resyncNonce]); // Re-validate when existing employees data changes or after a resync

  // Focus input when editing cell (only on initial edit start)
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      // Position cursor at end instead of selecting all text
      // Use setTimeout to ensure the value is set before positioning cursor
      setTimeout(() => {
        if (inputRef.current) {
          const length = inputRef.current.value.length;
          inputRef.current.setSelectionRange(length, length);
        }
      }, 0);
    }
  }, [editingCell?.rowIndex, editingCell?.field]); // Only trigger when starting to edit a different cell

  /**
   * Validate all employees and update error state
   */
  const validateAllEmployees = useCallback(async () => {
    const newValidationErrors = new Map<string, ValidationError[]>();

    // Process employees sequentially to avoid overwhelming the system
    for (let index = 0; index < employees.length; index++) {
      const employee = employees[index];
      const errors: ValidationError[] = [];
      const employeeKey = `employee-${index}`;

      // Use dynamic required field validation from ValidationService
      const requiredFieldErrors = ValidationService.validateRequiredFields(employee, index);
      errors.push(...requiredFieldErrors);

      // Email validation
      if (employee.email && !VALIDATION_CONFIG.EMAIL_PATTERN.test(employee.email)) {
        errors.push({
          field: 'email',
          value: employee.email,
          message: 'Invalid email format',
          rowIndex: index,
          severity: 'error'
        });
      }

      // Phone validation with user-specified country code
      // Convert cellPhone to string and check if it's not empty
      const cellPhoneStr = employee.cellPhone?.toString()?.trim() || '';
      if (cellPhoneStr !== '') {
        const countryCode = employee.cellPhoneCountryCode?.toString()?.trim() || '';
        
        if (countryCode) {
          // Use the new parsePhoneNumberWithCountry method for proper validation
          const { PhoneParser } = await import('../../utils');
          const parseResult = PhoneParser.parsePhoneNumberWithCountry(cellPhoneStr, countryCode);
          
          if (!parseResult.isValid && parseResult.error) {
            errors.push({
              field: 'cellPhone',
              value: cellPhoneStr,
              message: parseResult.error,
              rowIndex: index,
              severity: 'error'
            });
          }
        } else {
          // cellPhone provided but no country code - this should be caught by conditional validation in mapping
          errors.push({
            field: 'cellPhone',
            value: cellPhoneStr,
            message: 'Country code is required when cellPhone is provided',
            rowIndex: index,
            severity: 'error'
          });
        }
      }

      // Date validation using mapping service (supports 8-digit formats)
      // Convert hiredFrom to string and check if it's not empty
      const hiredFromStr = employee.hiredFrom?.toString()?.trim() || '';
      if (hiredFromStr !== '') {
        try {
          const { mappingService } = await import('../../services/mappingService');
          const validation = await mappingService.validateAndConvert(employee);
          
          // Check if there are date-specific errors
          const dateErrors = validation.errors.filter(e => e.field === 'hiredFrom');
          if (dateErrors.length > 0) {
            errors.push(...dateErrors.map(e => ({
              field: e.field,
              value: e.value,
              message: e.message,
              rowIndex: index,
              severity: 'error' as const
            })));
          }
        } catch {
          // Fallback to simple format check if mapping service fails
          const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
          if (!dateRegex.test(hiredFromStr)) {
            errors.push({
              field: 'hiredFrom',
              value: hiredFromStr,
              message: 'Date must be in YYYY-MM-DD format',
              rowIndex: index,
              severity: 'error'
            });
          }
        }
      }

      // Country code validation using centralized ValidationService
      const countryCodeErrors = ValidationService.validateCountryCodeFields(employee, index);
      errors.push(...countryCodeErrors);

      // Custom field validation using centralized ValidationService
      const customFieldResult = ValidationService.convertAllCustomFields(employee, index);
      errors.push(...customFieldResult.errors);
      
      // Log warnings for custom field conversions
      if (customFieldResult.warnings.length > 0) {
        console.warn(`⚠️ Custom field warnings for employee at row ${index}:`, customFieldResult.warnings);
      }

      // Every employee must have at least one department. This is a field-level
      // emptiness check (not name-to-ID mapping, which stays in the bulk phase), so
      // clearing the departments cell re-flags the row live and refilling clears it.
      const departmentsValue = (employee as any).departments;
      if (!departmentsValue || departmentsValue.toString().trim() === '') {
        errors.push({
          field: 'departments',
          value: '',
          message: 'At least one department must be assigned to each employee',
          rowIndex: index,
          severity: 'error'
        });
      }

      if (errors.length > 0) {
        newValidationErrors.set(employeeKey, errors);
      }
    }

    // Validate unique fields across all employees
    const uniqueFieldErrors = ValidationService.validateUniqueFields(employees);
    uniqueFieldErrors.forEach(error => {
      const employeeKey = `employee-${error.rowIndex}`;
      const existingErrors = newValidationErrors.get(employeeKey) || [];
      existingErrors.push(error);
      newValidationErrors.set(employeeKey, existingErrors);
    });

    // Validate against existing employees in Planday (duplicate checking)
    if (existingEmployees.size > 0) {
      const existingEmployeeErrors = ValidationService.validateExistingEmployees(employees, existingEmployees);
      
      // Duplicate employee validation completed
      
      existingEmployeeErrors.forEach(error => {
        const employeeKey = `employee-${error.rowIndex}`;
        const existingErrors = newValidationErrors.get(employeeKey) || [];
        existingErrors.push(error);
        newValidationErrors.set(employeeKey, existingErrors);
      });
    }

    // Validate against existing SSNs in Planday (duplicate checking)
    if (existingSsnEmployees.size > 0) {
      const existingSsnErrors = ValidationService.validateExistingEmployeesBySsn(employees, existingSsnEmployees);

      existingSsnErrors.forEach(error => {
        const employeeKey = `employee-${error.rowIndex}`;
        const existingErrors = newValidationErrors.get(employeeKey) || [];
        existingErrors.push(error);
        newValidationErrors.set(employeeKey, existingErrors);
      });
    }

    setValidationErrors(newValidationErrors);
  }, [employees, existingEmployees, existingSsnEmployees]);

  /**
   * Handle cell click to start editing
   */
  const handleCellClick = (rowIndex: number, field: keyof Employee) => {
    // Prevent editing of internal ID fields (they're for API use only)
    if (field.toString().startsWith('__') && field.toString().endsWith('Ids')) {
      return;
    }
    
    const employee = employees[rowIndex];
    setEditingCell({
      rowIndex,
      field,
      value: employee[field]?.toString() || ''
    });
  };

  /**
   * Handle cell value change during editing
   */
  const handleCellChange = (value: string) => {
    if (editingCell) {
      setEditingCell({
        ...editingCell,
        value
      });
    }
  };

  /**
   * Re-check duplicates for specific email addresses
   */
  const recheckDuplicatesForEmails = useCallback(async (emailAddresses: string[]) => {
    if (!plandayApi.isAuthenticated || emailAddresses.length === 0) return;

    try {
      // Only log if multiple emails to reduce noise
      if (emailAddresses.length > 1) {
        // Logging intentionally removed to reduce noise
      }
      
      // Check only the specific emails that were modified
      const existingEmps = await plandayApi.checkExistingEmployeesByEmail(emailAddresses);
      
      // Merge with existing results, but update/remove entries for the checked emails
      setExistingEmployees(prev => {
        const updated = new Map(prev);
        
        // Remove old entries for the checked emails
        emailAddresses.forEach(email => {
          const normalizedEmail = email.toLowerCase().trim();
          updated.delete(normalizedEmail);
        });
        
        // Add new entries if duplicates were found
        existingEmps.forEach((employee, email) => {
          updated.set(email, employee);
        });
        
        return updated;
      });
      
      // Only log results summary to reduce noise
      if (existingEmps.size > 0) {
        // Logging intentionally removed to reduce noise
      }
    } catch (error) {
      console.error('❌ Failed to re-check duplicates:', error);
    }
  }, [plandayApi]);

  /**
   * Re-check Planday for specific SSNs (exact-string match, no normalization)
   */
  const recheckDuplicatesForSsns = useCallback(async (ssnValues: string[]) => {
    if (!plandayApi.isAuthenticated || ssnValues.length === 0) return;

    try {
      const ssnResult = await plandayApi.checkExistingEmployeesBySsn(ssnValues);
      setSsnCheckUnavailable(!ssnResult.available);

      setExistingSsnEmployees(prev => {
        const updated = new Map(prev);

        // Remove old entries for the checked SSNs
        ssnValues.forEach(ssn => {
          updated.delete(String(ssn));
        });

        // Add new entries if duplicates were found
        ssnResult.existing.forEach((employee, ssn) => {
          updated.set(ssn, employee);
        });

        return updated;
      });
    } catch (error) {
      console.error('❌ Failed to re-check SSN duplicates:', error);
    }
  }, [plandayApi]);

  /**
   * Commit cell edit
   */
  const commitCellEdit = useCallback(() => {
    if (!editingCell) return;

    const { rowIndex, field, value } = editingCell;
    const oldValue = employees[rowIndex]?.[field];
    
    // Cell edit detected - validation will trigger via useEffect
    
    setEmployees(prev => {
      const updated = [...prev];
      updated[rowIndex] = {
        ...updated[rowIndex],
        [field]: value
      };
      return updated;
    });

    // Custom field validation now handled in validateAllEmployees for consistency

    // If email field was modified, re-check duplicates for the new email
    if (field === 'email' && value !== oldValue) {
      // Remove the old email from existingEmployees if it was there
      if (oldValue && oldValue.trim() !== '') {
        const oldNormalizedEmail = oldValue.toLowerCase().trim();
        setExistingEmployees(prev => {
          const updated = new Map(prev);
          updated.delete(oldNormalizedEmail);
          return updated;
        });
      }
      
      // Check the new email for duplicates if it's valid
      if (value && value.trim() !== '') {
        const normalizedEmail = value.toLowerCase().trim();
        // Only check if it looks like a valid email format
        if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(normalizedEmail)) {
          recheckDuplicatesForEmails([normalizedEmail]);
        }
      }
    }

    // If SSN field was modified, re-check Planday for the new value (exact-string)
    if (field === 'ssn' && value !== oldValue) {
      // Drop the old SSN from the existing-SSN map if it was flagged
      if (oldValue !== null && oldValue !== undefined && String(oldValue).trim() !== '') {
        const oldSsn = String(oldValue);
        setExistingSsnEmployees(prev => {
          const updated = new Map(prev);
          updated.delete(oldSsn);
          return updated;
        });
      }

      // Check the new SSN against Planday if non-empty
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        recheckDuplicatesForSsns([String(value)]);
      }
    }

    setEditingCell(null);
  }, [editingCell, employees, recheckDuplicatesForEmails, recheckDuplicatesForSsns]);

  /**
   * Cancel cell edit
   */
  const cancelCellEdit = () => {
    setEditingCell(null);
  };

  /**
   * Handle keyboard navigation in grid
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!editingCell) return;

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        commitCellEdit();
        break;
      case 'Escape':
        e.preventDefault();
        cancelCellEdit();
        break;
      case 'Tab':
        e.preventDefault();
        commitCellEdit();
        // Move to next cell logic could be added here
        break;
    }
  };

  /**
   * Toggle row selection for bulk operations
   */
  const toggleRowSelection = (rowIndex: number) => {
    setSelectedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(rowIndex)) {
        newSet.delete(rowIndex);
      } else {
        newSet.add(rowIndex);
      }
      return newSet;
    });
  };

  /**
   * Select all rows
   */
  const selectAllRows = () => {
    const allIndices = employees.map((_, index) => index);
    setSelectedRows(new Set(allIndices));
  };

  /**
   * Clear row selection
   */
  const clearSelection = () => {
    setSelectedRows(new Set());
  };

  /**
   * Mark duplicate employees to be skipped (excluded from upload)
   */
  const handleSkipDuplicates = useCallback(() => {
    const duplicateEmails = new Set(Array.from(existingEmployees.keys()));
    const updatedEmployees = employees.map(emp => {
      const email = emp.email?.toLowerCase().trim();
      if (email && duplicateEmails.has(email)) {
        return { ...emp, _skipUpload: true }; // Add flag to skip this employee
      }
      return emp;
    });
    
    
    setEmployees(updatedEmployees);
    
    // Clear existing employees state since duplicates are now marked to skip
    setExistingEmployees(new Map());
  }, [employees, existingEmployees]);

  /**
   * Apply bulk edit to selected rows
   */
  const applyBulkEdit = async () => {
    if (!bulkEditField || bulkEditValue.trim() === '' || selectedRows.size === 0) return;

    setIsProcessing(true);

    try {
      setEmployees(prev => {
        const updated = [...prev];
        selectedRows.forEach(rowIndex => {
          const currentValue = updated[rowIndex][bulkEditField]?.toString() || '';
          let newValue: string;
          
          // Apply the selected bulk edit mode
          switch (bulkEditMode) {
            case 'prepend':
              newValue = bulkEditValue + currentValue;
              break;
            case 'append':
              newValue = currentValue + bulkEditValue;
              break;
            case 'replace':
            default:
              newValue = bulkEditValue;
              break;
          }
          
          updated[rowIndex] = {
            ...updated[rowIndex],
            [bulkEditField]: newValue
          };
        });
        return updated;
      });

      // Clear bulk edit form
      setBulkEditField('');
      setBulkEditValue('');
      setBulkEditMode('replace');
      clearSelection();


    } catch (error) {
      console.error('Error applying bulk edit:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Smart suggestions function removed for now - will be added in Phase 3.2

  // Calculate skipped employees and employees with errors BEFORE filtering
  // (needed for the "show errors only" filter)
  const skippedEmployees = useMemo(() => {
    const skipped = new Set<number>();
    employees.forEach((emp, index) => {
      if (emp._skipUpload) {
        skipped.add(index);
      }
    });
    return skipped;
  }, [employees]);

  const employeesWithErrors = useMemo(() => {
    const withErrors = new Set<number>();
    validationErrors.forEach((errors, employeeKey) => {
      if (errors.some(e => e.severity === 'error')) {
        const rowIndex = parseInt(employeeKey.split('-')[1]);
        const employee = employees[rowIndex];
        // Only count errors for employees that will be uploaded
        if (!employee?._skipUpload) {
          withErrors.add(rowIndex);
        }
      }
    });
    return withErrors;
  }, [validationErrors, employees]);

  /**
   * Filter employees based on search and "show errors only" toggle
   * Safely converts all values to strings before searching (handles numbers, nulls, etc.)
   */
  const filteredEmployees = employees.filter((employee, index) => {
    // First, apply "show errors only" filter if enabled
    if (showErrorsOnly && !employeesWithErrors.has(index)) {
      return false;
    }

    // Then apply search filter
    if (!searchFilter) return true;
    const searchLower = searchFilter.toLowerCase();
    const safeIncludes = (value: any) =>
      value != null && String(value).toLowerCase().includes(searchLower);
    return (
      safeIncludes(employee.firstName) ||
      safeIncludes(employee.lastName) ||
      safeIncludes(employee.email) ||
      safeIncludes(employee.departments) ||
      safeIncludes(employee.employeeGroups) ||
      safeIncludes(employee.employeeTypeId)
    );
  });

  // Calculate validation statistics (excluding skipped employees)
  const totalErrors = Array.from(validationErrors.entries()).reduce(
    (sum, [employeeKey, errors]) => {
      const rowIndex = parseInt(employeeKey.split('-')[1]);
      const employee = employees[rowIndex];
      // Only count errors for employees that will be uploaded
      if (!employee?._skipUpload) {
        return sum + errors.filter(e => e.severity === 'error').length;
      }
      return sum;
    },
    0
  );
  const totalWarnings = Array.from(validationErrors.entries()).reduce(
    (sum, [employeeKey, errors]) => {
      const rowIndex = parseInt(employeeKey.split('-')[1]);
      const employee = employees[rowIndex];
      // Only count warnings for employees that will be uploaded
      if (!employee?._skipUpload) {
        return sum + errors.filter(e => e.severity === 'warning').length;
      }
      return sum;
    },
    0
  );

  const validEmployees = employees.length - employeesWithErrors.size - skippedEmployees.size;
  const willBeUploaded = employees.length - skippedEmployees.size;

  // Validation summary calculated

  // Get all fields that actually have data (dynamically determined from employee data)
  const editableFields = useMemo(() => {
    const fieldSet = new Set<string>();
    employees.forEach(emp => {
      // Define internal fields that should be excluded
      const internalFields = new Set(['rowIndex', 'originalData', '__internal_id', '_id', '_bulkCorrected', '__employeeGroupPayrates']);
      
      Object.keys(emp).forEach(key => {
        // Exclude individual department/employee group/skill fields (e.g., departments.Kitchen, employeeGroups.Reception, skills.Bartending)
        // These are converted to comma-separated editable fields (departments, employeeGroups, skills)
        const isIndividualDeptField = key.startsWith('departments.') || key.startsWith('employeeGroups.') || key.startsWith('skills.');
        // Exclude ALL internal fields that start with __ (e.g., __departmentsIds, __employeeGroupPayrates)
        // Also exclude skillIds (show human-readable 'skills' field instead)
        const isInternalField = key.startsWith('__') || key === 'skillIds';
        
        // Always include business fields (departments, employeeGroups, skills) even if empty, otherwise only include non-empty fields
        const isBusinessField = ['departments', 'employeeGroups', 'skills'].includes(key);
        
        // Debug: Log department and employee group field values for first few employees
        if (fieldSet.size < 10 && (key === 'departments' || key === 'employeeGroups')) {
          // Debug logging removed
        }
        
        if (!internalFields.has(key) && !isIndividualDeptField && !isInternalField) {
          if (isBusinessField || (emp[key as keyof Employee] != null && emp[key as keyof Employee] !== '')) {
            fieldSet.add(key);
            if (isBusinessField) {
              console.log(`✅ Added business field ${key} to fieldSet, value:`, emp[key as keyof Employee]);
            }
          }
        }
      });
    });
    
    // Sort fields with important ones first
    const importantFields = ['firstName', 'lastName', 'email'];
    const businessFields = ['departments', 'employeeGroups', 'skills']; // Business-critical editable fields - always show
    const otherFields = Array.from(fieldSet).filter(field =>
      !importantFields.includes(field) && !businessFields.includes(field)
    ).sort();

    // Always include business fields even if not in fieldSet (they might be empty but should still be editable)
    const fieldsToShow = [
      ...importantFields.filter(field => fieldSet.has(field)),
      ...businessFields, // Always include business fields, regardless of fieldSet
      ...otherFields
    ];
    

    
    return fieldsToShow as (keyof Employee)[];
  }, [employees]);

  // Get fields that can be bulk edited (exclude email since emails must be unique, and internal fields)
  const bulkEditableFields = useMemo(() => {
    return editableFields.filter(field =>
      field !== 'email' &&
      !field.toString().startsWith('__') // Exclude internal ID fields like __departmentsIds
    );
  }, [editableFields]);

  // Helper function to get display name for field
  const getFieldDisplayName = (fieldName: string): string => {
    // Handle business fields for departments, employee groups, and skills
    if (fieldName === 'departments') {
      return 'Departments';
    }
    if (fieldName === 'employeeGroups') {
      return 'Employee Groups';
    }
    if (fieldName === 'skills') {
      return 'Skills';
    }
    
    // Check if it's a custom field
    const customFields = ValidationService.getCustomFields();
    const customField = customFields.find(f => f.name === fieldName);
    
    if (customField && customField.description) {
      // For custom fields, show just the human-readable description
      return customField.description;
    }
    
    // For standard fields, show raw field names (consistent with modal and mapping)
    return fieldName;
  };

  // Helper function to clean up redundant error messages
  const cleanErrorMessage = (message: string): string => {
    // Fix redundant dropdown values like "XXL (XXL), XL (XL)" -> "XXL, XL"
    return message.replace(/(\w+) \(\1\)/g, '$1');
  };

  // Helper function to format employee groups with their hourly rates
  const formatEmployeeGroupsWithRates = (employee: Employee): string | null => {
    const payrates = (employee as any).__employeeGroupPayrates as Array<{ groupId: number; groupName: string; hourlyRate: number }> | undefined;
    const baseGroups = employee.employeeGroups;

    // If no payrates data, return null to use default display
    if (!payrates || !Array.isArray(payrates) || payrates.length === 0) {
      return null;
    }

    // Build a map of group names to hourly rates
    const ratesMap = new Map<string, number>();
    payrates.forEach(pr => {
      ratesMap.set(pr.groupName, pr.hourlyRate);
    });

    // If we have base groups string, parse and enhance it
    if (baseGroups && typeof baseGroups === 'string') {
      const groups = baseGroups.split(',').map(g => g.trim()).filter(g => g);
      return groups.map(groupName => {
        const rate = ratesMap.get(groupName);
        return rate !== undefined ? `${groupName} (${rate})` : groupName;
      }).join(', ');
    }

    // Fallback: just show payrate groups with rates
    return payrates.map(pr => `${pr.groupName} (${pr.hourlyRate})`).join(', ');
  };

  /**
   * Render validation status for a cell
   */
  const renderCellValidation = (rowIndex: number, field: keyof Employee) => {
    const employeeKey = `employee-${rowIndex}`;
    const errors = validationErrors.get(employeeKey) || [];
    const fieldErrors = errors.filter(e => e.field === field);
    
    // Render validation indicator if errors exist for this field
    
    if (fieldErrors.length === 0) return null;

    const hasError = fieldErrors.some(e => e.severity === 'error');
    const hasWarning = fieldErrors.some(e => e.severity === 'warning');

    return (
      <div className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${
        hasError ? 'bg-red-500' : hasWarning ? 'bg-yellow-500' : ''
      }`} title={fieldErrors.map(e => e.message).join(', ')} />
    );
  };

  return (
    <div className={`data-correction-step ${className}`}>
      {/* Header */}
      <Card className="p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">
            📝 Final Data Review & Correction
          </h2>
          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-600">
              <span className="font-medium text-green-600">{validEmployees}</span> valid • 
              <span className="font-medium text-red-600 ml-1">{totalErrors}</span> errors • 
              <span className="font-medium text-yellow-600 ml-1">{totalWarnings}</span> warnings
              {skippedEmployees.size > 0 && (
                <>
                  {' • '}
                  <span className="font-medium text-blue-600">{skippedEmployees.size}</span> skipped
                </>
              )}
            </div>
          </div>
        </div>

        <p className="text-gray-600 mb-4">
          Review and edit individual employee records. Click any cell to edit inline. 
          All errors must be resolved before proceeding to upload.
        </p>

        {/* Duplicate Checking Status */}
        {isCheckingDuplicates && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <div className="flex items-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-blue-800 font-medium">
                🔍 Checking for existing employees in Planday...
              </span>
            </div>
          </div>
        )}

        {/* Duplicate Check Results */}
        {!isCheckingDuplicates && existingEmployees.size > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <span className="text-yellow-600 text-lg mr-2">⚠️</span>
                <span className="text-yellow-800 font-medium">
                  Found {existingEmployees.size} employees that already exist in Planday
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSkipDuplicates}
                className="text-blue-700 border-blue-300 hover:bg-blue-50"
              >
                ⏭️ Skip Duplicates
              </Button>
            </div>
            <p className="text-yellow-700 text-sm mt-2">
              Click <strong>Skip Duplicates</strong> to exclude them from upload while keeping them visible for review.
            </p>
          </div>
        )}

        {/* SSN duplicate check unavailable (protected scope not granted) */}
        {!isCheckingDuplicates && ssnCheckUnavailable && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
            <div className="flex items-center">
              <span className="text-amber-600 text-lg mr-2">⚠️</span>
              <span className="text-amber-800 font-medium">
                SSN check skipped — this Planday connection can't read existing SSNs
              </span>
            </div>
            <p className="text-amber-700 text-sm mt-2">
              Duplicate SSNs <strong>within this file</strong> are still flagged, but rows whose SSN already
              exists in Planday can't be detected without the SSN access scope. Verify these manually if needed.
            </p>
          </div>
        )}

        {/* Show skipped employees status */}
        {skippedEmployees.size > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
            <div className="flex items-center">
              <span className="text-blue-600 text-lg mr-2">ℹ️</span>
              <span className="text-blue-800 font-medium">
                {skippedEmployees.size} employees marked to skip upload
              </span>
            </div>
            <p className="text-blue-700 text-sm mt-1">
              These employees are visible below with blue highlighting but will not be uploaded to Planday.
            </p>
          </div>
        )}

        {!isCheckingDuplicates && existingEmployees.size === 0 && employees.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
            <div className="flex items-center">
              <span className="text-green-600 text-lg mr-2">✅</span>
              <span className="text-green-800 font-medium">
                No duplicate employees found in Planday
              </span>
            </div>
          </div>
        )}

        {/* Search and Filter */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 flex gap-2">
            <Input
              placeholder="Search employees..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              leftIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              }
              className="flex-1"
            />
            {/* Show Errors Only Toggle */}
            <Button
              variant={showErrorsOnly ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setShowErrorsOnly(!showErrorsOnly)}
              className={`whitespace-nowrap ${showErrorsOnly ? 'bg-red-600 hover:bg-red-700' : ''}`}
              disabled={employeesWithErrors.size === 0}
            >
              {showErrorsOnly ? 'Show All' : 'Errors Only'}
              {employeesWithErrors.size > 0 && (
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${showErrorsOnly ? 'bg-red-800 text-white' : 'bg-red-100 text-red-800'}`}>
                  {employeesWithErrors.size}
                </span>
              )}
            </Button>
          </div>

          {/* Row Selection Controls */}
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={selectAllRows}>
              Select All
            </Button>
            <Button variant="outline" size="sm" onClick={clearSelection}>
              Clear Selection
            </Button>
            <span className="text-sm text-gray-600">
              {selectedRows.size} selected
            </span>
          </div>
        </div>

        {/* Bulk Edit Panel */}
        {selectedRows.size > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h4 className="text-sm font-medium text-blue-900 mb-3">
              Bulk Edit ({selectedRows.size} rows selected)
            </h4>
            <p className="text-xs text-blue-700 mb-3">
              📧 Email addresses cannot be bulk edited since each employee needs a unique email.
            </p>
            <div className="flex flex-col md:flex-row gap-3">
              <select
                value={bulkEditField}
                onChange={(e) => setBulkEditField(e.target.value as keyof Employee)}
                className="px-3 py-2 border border-blue-300 rounded-md text-sm"
              >
                <option value="">Select field...</option>
                                 {bulkEditableFields.map(field => (
                   <option key={field} value={field}>
                     {getFieldDisplayName(field.toString())}
                   </option>
                 ))}
              </select>
              <select
                value={bulkEditMode}
                onChange={(e) => setBulkEditMode(e.target.value as 'replace' | 'prepend' | 'append')}
                className="px-3 py-2 border border-blue-300 rounded-md text-sm min-w-24"
                title="Choose how to apply the value"
              >
                <option value="replace">Replace</option>
                <option value="prepend">Add to start</option>
                <option value="append">Add to end</option>
              </select>
              <Input
                placeholder={
                  bulkEditMode === 'replace' ? "Enter new value..." :
                  bulkEditMode === 'prepend' ? "Enter prefix to add..." :
                  "Enter suffix to add..."
                }
                value={bulkEditValue}
                onChange={(e) => setBulkEditValue(e.target.value)}
                size="sm"
                className="flex-1"
              />
              <Button
                onClick={applyBulkEdit}
                disabled={!bulkEditField || !bulkEditValue.trim() || isProcessing}
                size="sm"
                loading={isProcessing}
              >
                {bulkEditMode === 'replace' ? 'Replace' : 
                 bulkEditMode === 'prepend' ? 'Add to Start' : 
                 'Add to End'}
              </Button>
            </div>
            {/* Mode explanation */}
            <div className="mt-2 text-xs text-blue-600">
              {bulkEditMode === 'replace' && "💡 Replace: Completely replace the existing value with your input"}
              {bulkEditMode === 'prepend' && "💡 Add to start: Add your input to the beginning of existing values (e.g., add '45' to phone numbers)"}
              {bulkEditMode === 'append' && "💡 Add to end: Add your input to the end of existing values (e.g., add '@company.com' to usernames)"}
            </div>
          </div>
        )}
      </Card>

      {/* Data Grid */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto max-h-96">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0 z-10">
                  <input
                    type="checkbox"
                    onChange={(e) => e.target.checked ? selectAllRows() : clearSelection()}
                    checked={selectedRows.size === employees.length && employees.length > 0}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider bg-gray-50 sticky top-0 z-10">
                  Row
                </th>
                                                 {editableFields.map(field => (
                  <th key={field} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-32 bg-gray-50 sticky top-0 z-10">
                    <span className="font-mono normal-case">{getFieldDisplayName(field.toString())}</span>
                    {ValidationService.isRequired(field.toString()) && (
                      <span className="text-red-500 ml-1">*</span>
                    )}
                    {/* Note: Read-only lock removed - for bulk import (new employees), these fields CAN be set initially */}
                    {ValidationService.isUnique(field.toString()) && (
                      <span className="text-orange-500 ml-1" title="Must be unique">⚡</span>
                    )}
                    {field.toString().startsWith('__') && field.toString().endsWith('Ids') && (
                      <span className="text-gray-500 ml-1" title="Internal field">🔒</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
                                           {filteredEmployees.map((employee) => {
                const originalIndex = employees.indexOf(employee);
                const employeeKey = `employee-${originalIndex}`;
                const errors = validationErrors.get(employeeKey) || [];
                const hasErrors = errors.some(e => e.severity === 'error');
                const hasWarnings = errors.some(e => e.severity === 'warning');
                const isSkipped = employee._skipUpload;

                return (
                  <tr 
                    key={originalIndex} 
                    className={`hover:bg-gray-50 ${
                      isSkipped ? 'bg-blue-50 opacity-75 border-l-4 border-blue-400' : 
                      hasErrors ? 'bg-red-50' : 
                      hasWarnings ? 'bg-yellow-50' : ''
                    } ${selectedRows.has(originalIndex) ? 'ring-2 ring-blue-500' : ''}`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={selectedRows.has(originalIndex)}
                        onChange={() => toggleRowSelection(originalIndex)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      <div className="flex items-center gap-2">
                        <span>{originalIndex + 1}</span>
                        {isSkipped && (
                          <span className="text-blue-600 font-medium text-xs bg-blue-100 px-2 py-1 rounded" title="This employee will be skipped during upload">
                            SKIP
                          </span>
                        )}
                      </div>
                    </td>
                    {editableFields.map(field => (
                      <td key={field} className="px-4 py-3 whitespace-nowrap relative">
                        {editingCell?.rowIndex === originalIndex && editingCell?.field === field ? (
                          <Input
                            ref={inputRef}
                            value={editingCell.value}
                            onChange={(e) => handleCellChange(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onBlur={commitCellEdit}
                            size="sm"
                            className="min-w-32"
                          />
                        ) : (
                          <div
                            onClick={() => handleCellClick(originalIndex, field)}
                            className={`min-h-6 px-2 py-1 text-sm rounded border-2 border-transparent relative ${
                              field.toString().startsWith('__')
                                ? 'bg-gray-50 text-gray-700 cursor-default' // Read-only internal fields
                                : 'cursor-pointer hover:bg-gray-100 hover:border-blue-200'
                            }`}
                            title={field.toString().startsWith('__') ? 'Internal field' : 'Click to edit'}
                          >
                            {(() => {
                              // Special handling for employeeGroups to show hourly rates
                              if (field === 'employeeGroups') {
                                const groupsWithRates = formatEmployeeGroupsWithRates(employee);
                                if (groupsWithRates) {
                                  return groupsWithRates;
                                }
                                // Fall through to normal display if no rates
                              }
                              const value = employee[field];
                              // Don't render objects/arrays directly - they're internal data
                              if (value && typeof value === 'object') {
                                return <span className="text-gray-400 italic">Internal data</span>;
                              }
                              return value || (
                                <span className="text-gray-400 italic">
                                  {field.toString().startsWith('__') ? 'Internal data' : 'Click to add...'}
                                </span>
                              );
                            })()}
                            {renderCellValidation(originalIndex, field)}
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Validation Summary */}
      {(totalErrors > 0 || totalWarnings > 0) && (
        <Card className="p-6 mt-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            ⚠️ Validation Issues
          </h3>
          <div className="space-y-2">
            {Array.from(validationErrors.entries())
              .filter(([employeeKey]) => {
                // Only show validation errors for employees that will be uploaded
                const rowIndex = parseInt(employeeKey.split('-')[1]);
                const employee = employees[rowIndex];
                return !employee?._skipUpload;
              })
              .map(([employeeKey, errors]) => {
                const rowIndex = parseInt(employeeKey.split('-')[1]);
                const employee = employees[rowIndex];
                
                return (
                  <div key={employeeKey} className="border rounded-lg p-3">
                    <div className="font-medium text-sm text-gray-900 mb-2">
                      Row {rowIndex + 1}: {employee.firstName} {employee.lastName}
                    </div>
                    <div className="space-y-1">
                      {errors.map((error, errorIndex) => (
                        <div
                          key={errorIndex}
                          className={`text-sm px-2 py-1 rounded ${
                            error.severity === 'error'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          <strong className="font-mono">{getFieldDisplayName(error.field)}:</strong> {cleanErrorMessage(error.message)}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>
      )}

      {/* Actions */}
      <Card className="p-6 mt-6">
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={onBack}>
            ← Back to Mapping
          </Button>

          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-600">
              {totalErrors > 0 && (
                <span className="text-orange-600 font-medium">
                  {employeesWithErrors.size} employee(s) with errors • {validEmployees} valid
                </span>
              )}
              {totalErrors === 0 && totalWarnings > 0 && (
                <span className="text-yellow-600">
                  {totalWarnings} warnings (can proceed)
                </span>
              )}
              {totalErrors === 0 && totalWarnings === 0 && (
                <span className="text-green-600 font-medium">
                  All data is valid ✓
                </span>
              )}
            </div>

            <Button
              onClick={() => {
                if (totalErrors > 0) {
                  // Show confirmation modal when there are errors
                  setShowProceedWithErrorsModal(true);
                } else {
                  // No errors - proceed directly
                  const employeesToUpload = employees.filter(emp => !emp._skipUpload);
                  onComplete(employeesToUpload);
                }
              }}
              disabled={willBeUploaded === 0 || validEmployees === 0}
              className={totalErrors === 0 && willBeUploaded > 0 ? 'bg-green-600 hover:bg-green-700' : totalErrors > 0 && validEmployees > 0 ? 'bg-orange-600 hover:bg-orange-700' : ''}
            >
              {willBeUploaded === 0 || validEmployees === 0 ?
                'No valid employees to upload' :
                totalErrors === 0 ?
                  `Proceed with ${willBeUploaded} employees` :
                  `Proceed with ${validEmployees} valid employees`
              }
            </Button>
          </div>
        </div>
      </Card>

      {/* Proceed With Errors Confirmation Modal */}
      {showProceedWithErrorsModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
            onClick={() => setShowProceedWithErrorsModal(false)}
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full">
              <div className="p-6">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-orange-100 mx-auto mb-4">
                  <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">
                  Proceed with Errors?
                </h3>
                <p className="text-gray-600 text-center mb-4">
                  <strong className="text-orange-600">{employeesWithErrors.size} employee(s)</strong> have validation errors and will
                  <strong className="text-red-600"> NOT be uploaded</strong> to Planday.
                </p>
                <p className="text-sm text-gray-500 text-center mb-6">
                  Only <strong>{validEmployees}</strong> valid employee(s) will be uploaded.
                  You can download the excluded employees after the upload completes.
                </p>
                <div className="flex space-x-3">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowProceedWithErrorsModal(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="flex-1 bg-orange-600 hover:bg-orange-700 text-white"
                    onClick={() => {
                      setShowProceedWithErrorsModal(false);
                      // Get valid employees (not skipped AND not having errors)
                      const validEmployeesToUpload = employees.filter((emp, index) =>
                        !emp._skipUpload && !employeesWithErrors.has(index)
                      );
                      // Get excluded employees (with errors) and their error details
                      const excludedEmployeesList: ExcludedEmployee[] = employees
                        .map((emp, index) => ({
                          employee: emp,
                          errors: validationErrors.get(`employee-${index}`) || [],
                          rowIndex: index
                        }))
                        .filter((item) =>
                          !item.employee._skipUpload && employeesWithErrors.has(item.rowIndex)
                        );
                      onComplete(validEmployeesToUpload, excludedEmployeesList);
                    }}
                  >
                    Proceed Anyway
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}; 