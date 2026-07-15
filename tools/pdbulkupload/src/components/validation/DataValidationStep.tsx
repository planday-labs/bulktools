/**
 * Data Validation Step Component
 * Shows validation results in read-only mode with comprehensive summary
 * Features:
 * - Validation summary with error/warning counts
 * - Read-only data preview with validation indicators
 * - Progress tracking toward 100% validation
 * - Navigation to DataCorrection step for fixes
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Button, Card } from '../ui';
import { VALIDATION_CONFIG } from '../../constants';
import type { 
  Employee, 
  ValidationError, 
  PlandayDepartment,
  PlandayEmployeeGroup
} from '../../types/planday';
import { ValidationService } from '../../services/mappingService';

interface DataValidationStepProps {
  employees: Employee[];
  departments: PlandayDepartment[];
  employeeGroups: PlandayEmployeeGroup[];
  onComplete: (employees: Employee[]) => void;
  onCorrect: (employees: Employee[]) => void;
  onBack: () => void;
  className?: string;
}

/**
 * Data Validation Step Component
 */
export const DataValidationStep: React.FC<DataValidationStepProps> = ({
  employees,
  departments,
  employeeGroups,
  onComplete,
  onCorrect,
  onBack,
  className = ''
}) => {
  const [validationResults, setValidationResults] = useState<Map<string, ValidationError[]>>(new Map());
  const [isValidating, setIsValidating] = useState(true);

  // Validate all employees
  useEffect(() => {
    const validateEmployees = async () => {
      setIsValidating(true);
      
      const results = new Map<string, ValidationError[]>();
      
      // Note: MappingService will be used in later phases for more complex validation
      console.log('Validating with:', { departments: departments.length, employeeGroups: employeeGroups.length });

      for (let index = 0; index < employees.length; index++) {
        const employee = employees[index];
        const errors: ValidationError[] = [];
        const employeeKey = `employee-${index}`;

        // Use dynamic required field validation from ValidationService
        const requiredFieldErrors = ValidationService.validateRequiredFields(employee, index);
        errors.push(...requiredFieldErrors);

        // Email validation (if email is present)
        if (employee.email && !VALIDATION_CONFIG.EMAIL_PATTERN.test(employee.email)) {
          errors.push({
            field: 'email',
            value: employee.email,
            message: 'Invalid email format',
            rowIndex: index,
            severity: 'error'
          });
        }

        // Phone validation with intelligent parsing (if provided)
        if (employee.cellPhone && employee.cellPhone.trim() !== '') {
          const { PhoneParser } = await import('../../utils');
          const parseResult = PhoneParser.parsePhoneNumber(employee.cellPhone);
          
          if (!parseResult.isValid) {
            errors.push({
              field: 'cellPhone',
              value: employee.cellPhone,
              message: parseResult.error || 'Invalid phone number format',
              rowIndex: index,
              severity: 'error'
            });
          } else if (parseResult.confidence < 0.8) {
            // Show warning for low confidence parsing (assumed country)
            const displayCountry = parseResult.countryCode || 'Unknown';
            errors.push({
              field: 'cellPhone',
              value: employee.cellPhone,
              message: `Phone parsed as ${displayCountry}: ${PhoneParser.formatPhoneNumber(parseResult)}. Verify if correct.`,
              rowIndex: index,
              severity: 'warning'
            });
          }
        }

        // Date validation using mapping service (supports 8-digit formats)
        if (employee.hiredFrom && employee.hiredFrom.trim() !== '') {
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
            if (!dateRegex.test(employee.hiredFrom)) {
              errors.push({
                field: 'hiredFrom',
                value: employee.hiredFrom,
                message: 'Date must be in YYYY-MM-DD format',
                rowIndex: index,
                severity: 'error'
              });
            }
          }
        }

        // Department validation - check if department names exist
        if (employee.departments && employee.departments.trim() !== '') {
          const deptNames = employee.departments.split(',').map(d => d.trim());
          const validDepartments = departments.map(d => d.name.toLowerCase());
          
          deptNames.forEach(deptName => {
            if (!validDepartments.includes(deptName.toLowerCase())) {
              errors.push({
                field: 'departments',
                value: deptName,
                message: `Department "${deptName}" does not exist in Planday`,
                rowIndex: index,
                severity: 'error'
              });
            }
          });
        }

        // Employee group validation - check if employee group names exist
        if (employee.employeeGroups && employee.employeeGroups.trim() !== '') {
          const groupNames = employee.employeeGroups.split(',').map(g => g.trim());
          const validGroups = employeeGroups.map(g => g.name.toLowerCase());
          
          groupNames.forEach(groupName => {
            if (!validGroups.includes(groupName.toLowerCase())) {
              errors.push({
                field: 'employeeGroups',
                value: groupName,
                message: `Employee group "${groupName}" does not exist in Planday`,
                rowIndex: index,
                severity: 'error'
              });
            }
          });
        }

        if (errors.length > 0) {
          results.set(employeeKey, errors);
        }
      }

      // Validate unique fields across all employees
      const uniqueFieldErrors = ValidationService.validateUniqueFields(employees);
      uniqueFieldErrors.forEach(error => {
        const employeeKey = `employee-${error.rowIndex}`;
        const existingErrors = results.get(employeeKey) || [];
        existingErrors.push(error);
        results.set(employeeKey, existingErrors);
      });

      setValidationResults(results);
      setIsValidating(false);
    };

    validateEmployees();
  }, [employees, departments, employeeGroups]);

  // Calculate validation statistics
  const validationStats = useMemo(() => {
    const totalErrors = Array.from(validationResults.values()).reduce(
      (sum, errors) => sum + errors.filter(e => e.severity === 'error').length, 
      0
    );
    const totalWarnings = Array.from(validationResults.values()).reduce(
      (sum, errors) => sum + errors.filter(e => e.severity === 'warning').length, 
      0
    );
    const validEmployees = employees.length - validationResults.size;
    const employeesWithErrors = Array.from(validationResults.values()).filter(errors => 
      errors.some(e => e.severity === 'error')
    ).length;

    return {
      totalEmployees: employees.length,
      validEmployees,
      employeesWithErrors,
      totalErrors,
      totalWarnings,
      validationPercentage: Math.round((validEmployees / employees.length) * 100)
    };
  }, [employees.length, validationResults]);

  // Group errors by type for summary
  const errorSummary = useMemo(() => {
    const summary: Record<string, { count: number; message: string; severity: 'error' | 'warning' }> = {};
    
    Array.from(validationResults.values()).flat().forEach(error => {
      const key = `${error.field}-${error.message}`;
      if (!summary[key]) {
        summary[key] = {
          count: 0,
          message: error.message,
          severity: error.severity
        };
      }
      summary[key].count++;
    });

    return Object.entries(summary)
      .sort(([,a], [,b]) => {
        // Sort by severity (errors first), then by count
        if (a.severity !== b.severity) {
          return a.severity === 'error' ? -1 : 1;
        }
        return b.count - a.count;
      });
  }, [validationResults]);

  if (isValidating) {
    return (
      <div className={`data-validation-step ${className}`}>
        <Card className="p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Validating Employee Data
          </h3>
          <p className="text-gray-600">
            Checking {employees.length} employees against Planday requirements...
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className={`data-validation-step ${className}`}>
      {/* Header */}
      <Card className="p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">
            📊 Data Validation Results
          </h2>
          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-600">
              <span className="font-medium text-green-600">{validationStats.validEmployees}</span> valid • 
              <span className="font-medium text-red-600 ml-1">{validationStats.totalErrors}</span> errors • 
              <span className="font-medium text-yellow-600 ml-1">{validationStats.totalWarnings}</span> warnings
            </div>
          </div>
        </div>

        <p className="text-gray-600 mb-4">
          Review validation results below. All errors must be fixed before uploading to Planday.
        </p>

        {/* Progress Bar */}
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-700">Validation Progress</span>
            <span className="text-sm text-gray-500">{validationStats.validationPercentage}% Complete</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div 
              className={`h-2 rounded-full transition-all duration-500 ${
                validationStats.validationPercentage === 100 ? 'bg-green-500' : 'bg-blue-500'
              }`}
              style={{ width: `${validationStats.validationPercentage}%` }}
            ></div>
          </div>
        </div>
      </Card>

      {/* Validation Summary Cards */}
      <div className="grid md:grid-cols-3 gap-6 mb-6">
        <Card className="p-6">
          <div className="flex items-center">
            <div className="text-3xl mr-4">
              {validationStats.totalErrors === 0 ? '✅' : '❌'}
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">
                {validationStats.validEmployees}
              </div>
              <div className="text-sm text-gray-600">Valid Employees</div>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center">
            <div className="text-3xl mr-4">⚠️</div>
            <div>
              <div className="text-2xl font-bold text-red-600">
                {validationStats.totalErrors}
              </div>
              <div className="text-sm text-gray-600">Total Errors</div>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center">
            <div className="text-3xl mr-4">🔶</div>
            <div>
              <div className="text-2xl font-bold text-yellow-600">
                {validationStats.totalWarnings}
              </div>
              <div className="text-sm text-gray-600">Warnings</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Error Summary */}
      {errorSummary.length > 0 && (
        <Card className="p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            📋 Error Summary
          </h3>
          <div className="space-y-3">
            {errorSummary.map(([key, error]) => (
              <div
                key={key}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  error.severity === 'error'
                    ? 'bg-red-50 border-red-200'
                    : 'bg-yellow-50 border-yellow-200'
                }`}
              >
                <div className="flex items-center">
                  <span className={`text-2xl mr-3 ${
                    error.severity === 'error' ? 'text-red-500' : 'text-yellow-500'
                  }`}>
                    {error.severity === 'error' ? '❌' : '⚠️'}
                  </span>
                  <div>
                    <div className={`font-medium ${
                      error.severity === 'error' ? 'text-red-800' : 'text-yellow-800'
                    }`}>
                      {error.message}
                    </div>
                    <div className={`text-sm ${
                      error.severity === 'error' ? 'text-red-600' : 'text-yellow-600'
                    }`}>
                      Affects {error.count} {error.count === 1 ? 'employee' : 'employees'}
                    </div>
                  </div>
                </div>
                <div className={`text-lg font-bold ${
                  error.severity === 'error' ? 'text-red-600' : 'text-yellow-600'
                }`}>
                  {error.count}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Employee Preview Table */}
      <Card className="mb-6">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">
            👥 Employee Data Preview
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            First 10 employees with validation status
          </p>
        </div>
        
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Row
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Departments
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {employees.slice(0, 10).map((employee, index) => {
                const employeeKey = `employee-${index}`;
                const errors = validationResults.get(employeeKey) || [];
                const hasErrors = errors.some(e => e.severity === 'error');
                const hasWarnings = errors.some(e => e.severity === 'warning');
                
                return (
                  <tr 
                    key={index}
                    className={`${
                      hasErrors ? 'bg-red-50' : hasWarnings ? 'bg-yellow-50' : 'bg-green-50'
                    }`}
                  >
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {index + 1}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {employee.firstName} {employee.lastName}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {employee.email || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {employee.departments || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {hasErrors ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          ❌ {errors.filter(e => e.severity === 'error').length} errors
                        </span>
                      ) : hasWarnings ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          ⚠️ {errors.filter(e => e.severity === 'warning').length} warnings
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          ✅ Valid
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        {employees.length > 10 && (
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              Showing first 10 of {employees.length} employees
            </p>
          </div>
        )}
      </Card>

      {/* Actions */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={onBack}>
            ← Back to Column Mapping
          </Button>
          
          <div className="flex items-center space-x-4">
            {validationStats.totalErrors > 0 ? (
              <>
                <div className="text-sm text-red-600 font-medium">
                  {validationStats.totalErrors} errors must be fixed before uploading
                </div>
                <Button onClick={() => onCorrect(employees)} variant="primary">
                  Fix Errors in Data Correction →
                </Button>
              </>
            ) : (
              <>
                <div className="text-sm text-green-600 font-medium">
                  {validationStats.totalWarnings > 0 
                    ? `All data is valid! (${validationStats.totalWarnings} warnings can be ignored)`
                    : 'All data is valid and ready for upload!'
                  }
                </div>
                <Button onClick={() => onComplete(employees)} className="bg-green-600 hover:bg-green-700">
                  ✅ Proceed to Final Preview
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}; 