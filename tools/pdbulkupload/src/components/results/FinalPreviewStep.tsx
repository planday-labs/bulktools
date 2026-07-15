import React, { useState, useEffect } from 'react';
import { Button, Card } from '../ui';
import type { Employee } from '../../types/planday';
import { mappingService, ValidationService, MappingUtils, getFieldGroupRank } from '../../services/mappingService';

interface FinalPreviewStepProps {
  employees: Employee[];
  onStartUpload: () => void;
}

/**
 * Final Preview Step Component
 * 
 * This step provides a comprehensive final review of all employee data
 * before proceeding to the bulk upload. Users can:
 * - Review all validated and corrected employee data
 * - See upload statistics and summary
 * - Navigate back to make final changes if needed
 * - Proceed to start the bulk upload process
 */
const FinalPreviewStep: React.FC<FinalPreviewStepProps> = ({
  employees,
  onStartUpload
}) => {
  const [convertedEmployee, setConvertedEmployee] = useState<any>(null);
  const [payratePreview, setPayratePreview] = useState<{
    payrates: Array<{ groupId: number; groupName: string; hourlyRate: number }>;
    validFrom: string;
  } | null>(null);
  const [contractRulePreview, setContractRulePreview] = useState<{
    contractRuleId: number;
    contractRuleName: string;
  } | null>(null);
  const [fixedSalaryPreview, setFixedSalaryPreview] = useState<{
    salaryTypeId: number;
    salaryTypeName: string;
    hours: number;
    salary: number;
    validFrom: string;
  } | null>(null);
  const [supervisorPreview, setSupervisorPreview] = useState<{
    supervisorId: number;
    supervisorName: string;
  } | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const employeesPerPage = 25;

  // Pre-convert all employees for table display
  const [convertedEmployees, setConvertedEmployees] = useState<any[]>([]);
  const [isConverting, setIsConverting] = useState(true);

  // Debug: Log what employees data we receive
  useEffect(() => {
    console.log('🔍 FinalPreviewStep received employees:', employees.length);
    console.log('🔍 First employee:', employees[0]);
    console.log('🔍 All employees:', employees);
  }, [employees]);

  // Helper function to get display name for field
  const getFieldDisplayName = (fieldName: string): string => {
    // Handle business fields for departments and employee groups
    if (fieldName === 'departments') {
      return 'Departments';
    }
    if (fieldName === 'employeeGroups') {
      return 'Employee Groups';
    }
    
    // Check if it's a custom field
    const customFields = ValidationService.getCustomFields();
    const customField = customFields.find(f => f.name === fieldName);
    
    if (customField && customField.description) {
      // For custom fields, show human-readable description
      return customField.description;
    }
    
    // For standard fields, show raw field names (consistent with modal and mapping)
    return fieldName;
  };

  useEffect(() => {
    const convertFirstEmployee = async () => {
      if (employees.length === 0) {
        setConvertedEmployee(null);
        setPayratePreview(null);
        setContractRulePreview(null);
        setFixedSalaryPreview(null);
        setSupervisorPreview(null);
        return;
      }

      const result = await mappingService.validateAndConvert(employees[0]);
      const converted = result.converted;

      // Use the centralized payload creation function to ensure consistency with upload
      const cleanPayload = MappingUtils.createApiPayload(converted);
      setConvertedEmployee(cleanPayload);

      const validFrom = (converted as any).wageValidFrom || new Date().toISOString().split('T')[0];

      // Capture contract rule data for preview
      const contractRuleAssignment = (converted as any).__contractRuleAssignment;
      if (contractRuleAssignment) {
        setContractRulePreview({
          contractRuleId: contractRuleAssignment.contractRuleId,
          contractRuleName: contractRuleAssignment.contractRuleName
        });
      } else {
        setContractRulePreview(null);
      }

      // Capture fixed salary data for preview
      const fixedSalaryAssignment = (converted as any).__fixedSalaryAssignment;
      if (fixedSalaryAssignment) {
        setFixedSalaryPreview({
          salaryTypeId: fixedSalaryAssignment.salaryTypeId,
          salaryTypeName: fixedSalaryAssignment.salaryTypeName,
          hours: fixedSalaryAssignment.hours,
          salary: fixedSalaryAssignment.salary,
          validFrom
        });
      } else {
        setFixedSalaryPreview(null);
      }

      // Capture payrate data for preview (this is sent separately after employee creation)
      const payrates = (converted as any).__employeeGroupPayrates;
      if (payrates && Array.isArray(payrates) && payrates.length > 0) {
        setPayratePreview({
          payrates,
          validFrom
        });
      } else {
        setPayratePreview(null);
      }

      // Capture supervisor assignment for preview (sent after ALL employees are created)
      const supervisorAssignment = (converted as any).__supervisorAssignment;
      if (supervisorAssignment) {
        setSupervisorPreview({
          supervisorId: supervisorAssignment.supervisorId,
          supervisorName: supervisorAssignment.supervisorName
        });
      } else {
        setSupervisorPreview(null);
      }
    };

    convertFirstEmployee();
  }, [employees]);

  // Convert all employees for table display
  useEffect(() => {
    const convertAllEmployees = async () => {
      setIsConverting(true);
      const converted = [];
      
      for (const employee of employees) {
        try {
          const result = await mappingService.validateAndConvert(employee);
          converted.push(result.converted);
        } catch (error) {
          console.warn('Failed to convert employee data for display:', error);
          converted.push(employee); // Fallback to original data
        }
      }
      
      setConvertedEmployees(converted);
      setIsConverting(false);
    };
    
    convertAllEmployees();
  }, [employees]);

  // Calculate statistics for the preview
  const stats = {
    totalEmployees: employees.length,
    withDepartments: employees.filter(emp => emp.departments && emp.departments.trim().length > 0).length,
    withEmployeeGroups: employees.filter(emp => emp.employeeGroups && emp.employeeGroups.trim().length > 0).length,
    withPhoneNumbers: employees.filter(emp => emp.cellPhone || emp.phone).length,
    withAddresses: employees.filter(emp => emp.street1 && emp.city).length,
  };

  // Calculate pagination
  const totalPages = Math.ceil(employees.length / employeesPerPage);
  const startIndex = (currentPage - 1) * employeesPerPage;
  const endIndex = startIndex + employeesPerPage;
  const displayEmployees = convertedEmployees.slice(startIndex, endIndex);

  // Get all unique field names from converted employees to create table columns
  const [allFields, setAllFields] = useState<string[]>([]);
  
  useEffect(() => {
    if (convertedEmployees.length === 0) return;
    
    const fieldSet = new Set<string>();
    // Exclude internal fields and payrate fields (payrates shown separately)
    const internalFields = new Set([
      'rowIndex', 'originalData', '__internal_id', '_id', '_bulkCorrected',
      '__departmentsIds', '__employeeGroupsIds',
      '__employeeGroupPayrates', 'wageValidFrom', // Payrate fields shown in separate preview
      'skillIds' // Show human-readable 'skills' field instead of technical ID array
    ]);
    
    convertedEmployees.forEach(converted => {
      Object.keys(converted).forEach(key => {
        // Filter out individual fields (like departments.Kitchen, employeeGroups.Waiter)
        // and internal ID fields, but keep consolidated fields (departments, employeeGroups)
        if (!internalFields.has(key) &&
            !key.startsWith('__') && // Exclude ALL internal fields starting with __
            !key.includes('.') && // Exclude individual fields like "departments.Kitchen"
            converted[key] != null &&
            converted[key] !== '') {
          fieldSet.add(key);
        }
      });
    });
    
    // Order columns by the shared group order (HR -> Custom -> Supervisor ->
    // Contract Rule -> wageValidFrom -> Fixed Salary -> Skills -> Departments ->
    // Employee Groups) so the review table matches the downloaded template.
    // firstName/lastName/email stay pinned at the front of the HR group.
    const pinnedFields = ['firstName', 'lastName', 'email'];
    const sortedFields = Array.from(fieldSet).sort((a, b) => {
      const rankA = getFieldGroupRank(a);
      const rankB = getFieldGroupRank(b);
      if (rankA !== rankB) return rankA - rankB;
      const pinA = pinnedFields.indexOf(a);
      const pinB = pinnedFields.indexOf(b);
      if (pinA !== -1 || pinB !== -1) {
        if (pinA === -1) return 1;
        if (pinB === -1) return -1;
        return pinA - pinB;
      }
      return a.localeCompare(b);
    });

    setAllFields(sortedFields);
  }, [convertedEmployees]);

  // Show loading state while converting
  if (isConverting) {
    return (
      <div className="space-y-6">
        <Card className="p-8 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Preparing Data for Review
          </h3>
          <p className="text-gray-600">
            Converting employee data to match Planday API format...
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Final Review</h2>
          <p className="text-gray-600">
            Review your employee data before uploading to Planday. 
            All validations have been completed and corrections applied.
          </p>
        </div>
      </Card>

      {/* Employee Data Table */}
      <Card>
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Employee Data Table</h3>
            <p className="text-sm text-gray-600">
              Showing {startIndex + 1}-{Math.min(endIndex, employees.length)} of {employees.length} employees
              <span className="text-blue-600 font-medium ml-2">
                (Data converted for Planday API)
              </span>
            </p>
          </div>
          
          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center space-x-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
              >
                ← Previous
              </Button>
              
              <div className="flex items-center space-x-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-8 h-8 text-sm rounded ${
                        currentPage === pageNum
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>
              
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
              >
                Next →
              </Button>
            </div>
          )}
        </div>

        {/* Table with horizontal scroll */}
        <div className="overflow-auto max-h-96 border border-gray-200 rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0 z-20">
              <tr>
                <th className="sticky left-0 z-30 bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-r border-gray-200">
                  #
                </th>
                {allFields.filter(field =>
                  !['rowIndex', 'originalData', '__internal_id', '_id', '_bulkCorrected', '__departmentsIds', '__employeeGroupsIds', 'skillIds'].includes(field) &&
                  !field.includes('.') // Exclude individual fields like "departments.Kitchen"
                ).map(field => (
                  <th
                    key={field}
                    className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap bg-gray-50 sticky top-0 z-20"
                  >
                    <span className="font-mono normal-case">{getFieldDisplayName(field)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {displayEmployees.map((convertedEmployee, index) => {
                // Filter out internal fields that shouldn't be displayed
                const internalFields = new Set(['rowIndex', 'originalData', '__internal_id', '_id', '_bulkCorrected', '__departmentsIds', '__employeeGroupsIds', 'skillIds']);
                
                return (
                  <tr key={`employee-${startIndex + index}`} className="hover:bg-gray-50">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm text-gray-900 border-r border-gray-200 font-medium">
                      {startIndex + index + 1}
                    </td>
                    {allFields.filter(field => 
                      !internalFields.has(field) &&
                      !field.includes('.') // Exclude individual fields like "departments.Kitchen"
                    ).map(field => {
                      const value = convertedEmployee[field];
                      let displayValue = '';
                      
                      if (value == null || value === '') {
                        displayValue = '-';
                      } else if (Array.isArray(value)) {
                        displayValue = value.join(', ');
                      } else {
                        // Display value as-is (dates are already in ISO format YYYY-MM-DD)
                        displayValue = String(value);
                      }
                      
                      return (
                        <td
                          key={field}
                          className="px-3 py-2 text-sm text-gray-900 whitespace-nowrap"
                          title={displayValue}
                        >
                          <div className="max-w-32 truncate">
                            {displayValue}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Table Footer with Summary */}
        <div className="mt-4 text-sm text-gray-500 text-center">
          {allFields.length} columns • {employees.length} total employees • Page {currentPage} of {totalPages}
        </div>
      </Card>

      {/* JSON Payload Preview */}
      <Card>
        <div className="space-y-4">
          <div className="flex items-start space-x-3">
            <svg className="w-6 h-6 text-blue-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <div className="flex-1">
              <h4 className="font-medium text-gray-900 mb-2">API Payload Preview</h4>
              <p className="text-gray-600 text-sm mb-4">
                This shows exactly what will be sent to the Planday API for the first employee. 
                All other employees will follow the same structure with their respective data.
              </p>
            </div>
          </div>
          
          <div className="text-xs text-gray-500 mb-3 font-medium">
            Sample API calls for: {employees[0]?.firstName} {employees[0]?.lastName}
          </div>

          <div className="space-y-3">
            {/* Step 1: Create Employee */}
            {convertedEmployee && (
              <div className="bg-gray-50 rounded border border-gray-200 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="bg-green-100 text-green-800 text-xs font-semibold px-2 py-0.5 rounded">Step 1</span>
                  <span className="text-xs font-mono text-gray-600">POST /hr/v1.0/employees</span>
                </div>
                <pre className="text-xs text-gray-800 whitespace-pre-wrap max-h-48 overflow-y-auto bg-white p-2 rounded border">
                  {JSON.stringify(convertedEmployee, null, 2)}
                </pre>
              </div>
            )}

            {/* Step 2: Assign Contract Rule (if applicable) */}
            {contractRulePreview && (
              <div className="bg-purple-50 rounded border border-purple-200 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="bg-purple-100 text-purple-800 text-xs font-semibold px-2 py-0.5 rounded">Step 2</span>
                  <span className="text-xs font-mono text-gray-600">PUT /contractrules/v1/employees/{'{employeeId}'}?contractRuleId={contractRulePreview.contractRuleId}</span>
                </div>
                <pre className="text-xs text-gray-800 whitespace-pre-wrap bg-white p-2 rounded border">
                  {JSON.stringify({
                    contractRuleId: contractRulePreview.contractRuleId,
                    _comment: `Assigns "${contractRulePreview.contractRuleName}" contract rule`
                  }, null, 2)}
                </pre>
              </div>
            )}

            {/* Step 3: Set Fixed Salary (if applicable) */}
            {fixedSalaryPreview && (
              <div className="bg-amber-50 rounded border border-amber-200 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="bg-amber-100 text-amber-800 text-xs font-semibold px-2 py-0.5 rounded">Step {contractRulePreview ? '3' : '2'}</span>
                  <span className="text-xs font-mono text-gray-600">PUT /pay/v1.0/salaries/employees/{'{employeeId}'}</span>
                </div>
                <pre className="text-xs text-gray-800 whitespace-pre-wrap bg-white p-2 rounded border">
                  {JSON.stringify({
                    salaryTypeId: fixedSalaryPreview.salaryTypeId,
                    hours: fixedSalaryPreview.hours,
                    salary: fixedSalaryPreview.salary,
                    validFrom: fixedSalaryPreview.validFrom,
                    _comment: `${fixedSalaryPreview.salaryTypeName} salary of ${fixedSalaryPreview.salary} for ${fixedSalaryPreview.hours} hours`
                  }, null, 2)}
                </pre>
              </div>
            )}

            {/* Step 4: Set Hourly Pay Rates (if applicable) */}
            {payratePreview && payratePreview.payrates.length > 0 && (
              <div className="bg-blue-50 rounded border border-blue-200 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-0.5 rounded">
                    Step {1 + (contractRulePreview ? 1 : 0) + (fixedSalaryPreview ? 1 : 0) + 1}
                  </span>
                  <span className="text-xs font-mono text-gray-600">PUT /pay/v1.0/payrates/employeeGroups/{'{groupId}'}</span>
                </div>
                <pre className="text-xs text-gray-800 whitespace-pre-wrap bg-white p-2 rounded border">
                  {JSON.stringify({
                    employeeId: '{employeeId}',
                    validFrom: payratePreview.validFrom,
                    payrates: payratePreview.payrates.map(pr => ({
                      groupId: pr.groupId,
                      groupName: pr.groupName,
                      hourlyRate: pr.hourlyRate
                    })),
                    _comment: 'One API call per employee group'
                  }, null, 2)}
                </pre>
              </div>
            )}

            {/* Step 5: Assign Supervisor (if applicable) - done after ALL employees created */}
            {supervisorPreview && (
              <div className="bg-orange-50 rounded border border-orange-200 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="bg-orange-100 text-orange-800 text-xs font-semibold px-2 py-0.5 rounded">Final</span>
                  <span className="text-xs font-mono text-gray-600">PUT /hr/v1.0/employees/{'{employeeId}'}</span>
                  <span className="text-xs text-orange-600 italic">(after all employees created)</span>
                </div>
                <pre className="text-xs text-gray-800 whitespace-pre-wrap bg-white p-2 rounded border">
                  {JSON.stringify({
                    supervisorId: supervisorPreview.supervisorId,
                    _comment: `Assigns "${supervisorPreview.supervisorName}" as supervisor`
                  }, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Important Notes */}
      <Card className="bg-yellow-50 border-yellow-200">
        <div className="flex items-start space-x-3">
          <svg className="w-6 h-6 text-yellow-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div>
            <h4 className="font-medium text-yellow-800 mb-2">Before You Continue</h4>
            <ul className="text-sm text-yellow-700 space-y-1">
              <li>• Once you start the upload, the process cannot be undone</li>
              <li>• All {stats.totalEmployees} employees will be created in your Planday account</li>
              <li>• Make sure you have the necessary permissions in Planday</li>
              <li>• The upload process may take several minutes depending on the number of employees</li>
              <li>• You can go back to make changes if needed</li>
            </ul>
          </div>
        </div>
      </Card>

      {/* Action Buttons (step-back lives in the top navigation bar) */}
      <div className="flex flex-col sm:flex-row justify-end items-center gap-4 pt-6">
        <Button
          variant="primary"
          onClick={onStartUpload}
          className="flex items-center justify-center space-x-2 w-full sm:w-auto"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
          <span>Start Upload ({stats.totalEmployees} employees)</span>
        </Button>
      </div>
    </div>
  );
};

export default FinalPreviewStep; 