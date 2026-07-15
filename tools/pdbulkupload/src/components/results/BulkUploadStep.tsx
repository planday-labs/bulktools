import React, { useState, useEffect, useRef } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import type { Employee, BulkUploadProgress, EmployeeUploadResult, PlandayEmployeeCreateRequest, PayrateSetResult, FixedSalarySetResult, ContractRuleSetResult } from '../../types/planday';
import { usePlandayApi } from '../../hooks/usePlandayApi';
import { MappingUtils } from '../../services/mappingService';
import { ValidationService } from '../../services/mappingService';



// Post-creation operation results passed back to parent
export interface PostCreationResults {
  supervisorResults?: Array<{ employeeId: number; supervisorName: string; success: boolean; error?: string }>;
  salaryResults?: Array<{ employeeId: number; success: boolean; error?: string }>;
  contractRuleResults?: Array<{ employeeId: number; success: boolean; error?: string }>;
}

interface BulkUploadStepProps {
  employees: Employee[];
  onComplete: (results: EmployeeUploadResult[], postCreationResults?: PostCreationResults) => void;
  /**
   * Return to the validation/correction (edit) table with the uploaded data still in memory.
   * Rows that were created in Planday (success + partial) are stripped before re-entry so a
   * re-run can't duplicate them; failed rows remain for correction and retry.
   */
  onBackToEditTable: (results: EmployeeUploadResult[]) => void;
  /** Reports whether an upload is actively running, so the parent can block top-level navigation. */
  onBusyChange?: (busy: boolean) => void;
  className?: string;
}

/**
 * Bulk Upload Step Component
 *
 * This step handles the actual upload of validated employee data to Planday:
 * - Re-validates all employees as a gate before any upload starts
 * - Best-effort upload: a failing row records its error and the loop continues
 * - Live Successful / Partial / Failure counters that update per row
 * - Abort button that stops the run at the current row (after a confirmation)
 */
const BulkUploadStep: React.FC<BulkUploadStepProps> = ({
  employees,
  onComplete,
  onBackToEditTable,
  onBusyChange,
  className = ''
}) => {
  const [status, setStatus] = useState<'preparing' | 'validating' | 'authenticating' | 'uploading' | 'post-processing' | 'completed' | 'aborted' | 'error'>('preparing');
  const [progress, setProgress] = useState<BulkUploadProgress | null>(null);
  const [results, setResults] = useState<EmployeeUploadResult[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [processingLog, setProcessingLog] = useState<string[]>([]);
  const [validationErrors, setValidationErrors] = useState<Array<{employee: string, errors: string[]}>>([]);
  const [payrateResults, setPayrateResults] = useState<PayrateSetResult[] | null>(null);
  const [supervisorProgress, setSupervisorProgress] = useState<{ completed: number; total: number } | null>(null);
  const [supervisorResults, setSupervisorResults] = useState<Array<{ employeeId: number; supervisorId: number; supervisorName: string; success: boolean; error?: string }> | null>(null);
  const [salaryResults, setSalaryResults] = useState<FixedSalarySetResult[] | null>(null);
  const [contractRuleResults, setContractRuleResults] = useState<ContractRuleSetResult[] | null>(null);

  // Abort handling: ref is read inside the async upload loop, state drives the UI.
  const abortRef = useRef(false);
  const [abortPending, setAbortPending] = useState(false);
  const [showAbortConfirm, setShowAbortConfirm] = useState(false);

  const plandayApi = usePlandayApi();

  // Report active-upload state upward so the parent can disable top-level "Back"
  // while a run is in flight (mirrors the in-step back button's disabled states).
  useEffect(() => {
    const busy = status === 'validating' || status === 'authenticating' || status === 'uploading' || status === 'post-processing';
    onBusyChange?.(busy);
  }, [status, onBusyChange]);

  // Clear the busy flag if this step unmounts mid-run.
  useEffect(() => {
    return () => onBusyChange?.(false);
  }, [onBusyChange]);

  // Add log entry for progress tracking
  const addLogEntry = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setProcessingLog(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  // Pre-validate ALL employees before any upload
  const validateAllEmployees = async (employees: Employee[]): Promise<{
    isValid: boolean,
    validatedEmployees: PlandayEmployeeCreateRequest[],
    convertedEmployees: any[], // Keep converted data for payrate extraction
    errors: Array<{employee: string, errors: string[]}>
  }> => {
    addLogEntry(`🔍 Pre-validating all ${employees.length} employees...`);

    const validatedEmployees: PlandayEmployeeCreateRequest[] = [];
    const convertedEmployees: any[] = []; // Store converted employees with payrate data
    const allErrors: Array<{employee: string, errors: string[]}> = [];

    for (let index = 0; index < employees.length; index++) {
      const employee = employees[index];
      const employeeName = `${employee.firstName || 'Unknown'} ${employee.lastName || 'Unknown'} (row ${index + 1})`;

      // Use ValidationService for required field validation
      const requiredFieldErrors = ValidationService.validateRequiredFields(employee, index);

      // Use MappingUtils for conversion and additional validation
      const validation = await MappingUtils.validateEmployee(employee);

      // Country code validation using centralized ValidationService
      const countryCodeErrors = ValidationService.validateCountryCodeFields(employee, index);

      const allValidationErrors = [...requiredFieldErrors, ...validation.errors, ...countryCodeErrors];

      if (allValidationErrors.length > 0) {
        const errorMessages = allValidationErrors.map(e => e.message);
        allErrors.push({
          employee: employeeName,
          errors: errorMessages
        });
        addLogEntry(`❌ ${employeeName}: ${errorMessages.join(', ')}`);
      } else {
        // Use the converted data from validation
        const converted = validation.converted;

        // Store the converted data (includes __employeeGroupPayrates and wageValidFrom)
        convertedEmployees.push({ ...converted, rowIndex: index });

        // Use the centralized payload creation function to ensure consistency with preview
        const plandayEmployee = MappingUtils.createApiPayload(converted);

        validatedEmployees.push(plandayEmployee);

        // Log payrate info if present
        const payrates = converted.__employeeGroupPayrates || [];
        if (payrates.length > 0) {
          const rateInfo = payrates.map((p: any) => `${p.groupName}: ${p.hourlyRate}`).join(', ');
          addLogEntry(`✅ ${employeeName}: Valid (Hourly rates: ${rateInfo})`);
        } else if (plandayEmployee.employeeTypeId) {
          addLogEntry(`✅ ${employeeName}: Valid (employeeTypeId: ${plandayEmployee.employeeTypeId})`);
        } else {
          addLogEntry(`✅ ${employeeName}: Valid`);
        }
      }
    }

    // Check unique fields across all employees
    const uniqueFieldErrors = ValidationService.validateUniqueFields(employees);
    if (uniqueFieldErrors.length > 0) {
      uniqueFieldErrors.forEach(error => {
        const employeeName = `${employees[error.rowIndex]?.firstName || 'Unknown'} ${employees[error.rowIndex]?.lastName || 'Unknown'} (row ${error.rowIndex + 1})`;
        const existingErrorEntry = allErrors.find(e => e.employee === employeeName);
        if (existingErrorEntry) {
          existingErrorEntry.errors.push(error.message);
        } else {
          allErrors.push({
            employee: employeeName,
            errors: [error.message]
          });
        }
        addLogEntry(`❌ ${employeeName}: ${error.message}`);
      });
    }

    const isValid = allErrors.length === 0;

    if (isValid) {
      addLogEntry(`🎉 All ${employees.length} employees passed validation!`);
    } else {
      addLogEntry(`❌ ${allErrors.length} employees failed validation. Upload will not proceed.`);
    }

    return {
      isValid,
      validatedEmployees,
      convertedEmployees,
      errors: allErrors
    };
  };

  // Start the best-effort upload process with a pre-validation gate
  const startUpload = async () => {
    try {
      // Phase 1: Pre-validation gate
      setStatus('validating');
      setErrorMessage(null);
      setValidationErrors([]);
      addLogEntry('🚀 Starting upload process...');

      // Validate ALL employees first - the upload cannot start while anything is invalid
      const validation = await validateAllEmployees(employees);

      if (!validation.isValid) {
        // Validation failed - the user must go back to the edit table to fix it
        setStatus('error');
        setValidationErrors(validation.errors);
        setErrorMessage(`Validation failed for ${validation.errors.length} employees. Go back to the edit table to fix these issues before uploading.`);
        addLogEntry(`🛑 Upload blocked by validation errors. NO employees were uploaded.`);
        return;
      }

      // Phase 2: Authentication check with auto re-authentication
      addLogEntry('🔍 Checking authentication status...');
      console.log('🔍 Auth check:', {
        hookIsAuthenticated: plandayApi.isAuthenticated,
        timestamp: new Date().toISOString()
      });

      if (!plandayApi.isAuthenticated) {
        addLogEntry('⚠️ Not authenticated - attempting automatic re-authentication...');
        setStatus('authenticating');

        // Try to get stored refresh token for automatic re-authentication
        const storedRefreshToken = sessionStorage.getItem('planday_refresh_token');

        if (storedRefreshToken) {
          addLogEntry('🔄 Found stored refresh token, attempting to re-authenticate...');

          try {
            const authSuccess = await plandayApi.authenticate(storedRefreshToken);

            if (authSuccess) {
              addLogEntry('✅ Automatic re-authentication successful!');
              setStatus('validating'); // Go back to validating status
            } else {
              addLogEntry('❌ Automatic re-authentication failed');
              throw new Error('Authentication expired and automatic re-authentication failed. Please re-authenticate manually.');
            }
          } catch (error) {
            addLogEntry('❌ Automatic re-authentication error: ' + (error instanceof Error ? error.message : 'Unknown error'));
            throw new Error('Authentication expired and automatic re-authentication failed. Please re-authenticate manually.');
          }
        } else {
          addLogEntry('❌ No stored refresh token found for automatic re-authentication');
          throw new Error('Not authenticated with Planday. Please re-authenticate.');
        }
      }

      // Double-check by testing connection
      addLogEntry('🔗 Testing API connection...');
      const connectionOk = await plandayApi.testConnection();
      if (!connectionOk) {
        addLogEntry('❌ API connection test failed - trying one more re-authentication attempt...');

        // One more attempt at re-authentication
        const storedRefreshToken = sessionStorage.getItem('planday_refresh_token');
        if (storedRefreshToken) {
          addLogEntry('🔄 Final re-authentication attempt...');
          setStatus('authenticating');

          try {
            const authSuccess = await plandayApi.authenticate(storedRefreshToken);

            if (authSuccess) {
              addLogEntry('✅ Final re-authentication successful!');
              setStatus('validating'); // Go back to validating status

              // Test connection again
              const finalConnectionOk = await plandayApi.testConnection();
              if (!finalConnectionOk) {
                addLogEntry('❌ Connection still fails after re-authentication');
                throw new Error('Unable to establish connection to Planday API. Please check your network and try again.');
              }
            } else {
              throw new Error('Unable to connect to Planday API. Please check your authentication and try again.');
            }
          } catch {
            throw new Error('Unable to connect to Planday API. Please check your authentication and try again.');
          }
        } else {
          throw new Error('Unable to connect to Planday API. Please check your authentication and try again.');
        }
      }

      addLogEntry('🔐 Authentication verified and API connection successful');

      // Phase 3: Sequential best-effort upload with inline operations
      // Each employee is fully processed before moving to the next row. A failing row
      // records its error and the loop continues to the next employee.
      setStatus('uploading');
      addLogEntry(`🚀 Starting upload of ${validation.validatedEmployees.length} employees...`);
      addLogEntry(`📋 Failed rows are recorded and skipped; the rest still upload.`);

      const uploadResults: EmployeeUploadResult[] = [];
      const contractRuleResultsArray: ContractRuleSetResult[] = [];
      const payrateResultsArray: PayrateSetResult[] = [];
      const salaryResultsArray: FixedSalarySetResult[] = [];
      const supervisorQueue: Array<{ employeeId: number; supervisorName: string }> = []; // supervisorId resolved after all employees created

      const totalEmployees = validation.validatedEmployees.length;
      let successCount = 0;
      let partialCount = 0;
      let failedCount = 0;
      let abortedDuringUpload = false;

      const updateLiveProgress = (current: number, inProgress: boolean) => {
        setProgress({
          currentBatch: current,
          totalBatches: totalEmployees,
          total: totalEmployees,
          completed: successCount,
          partial: partialCount,
          failed: failedCount,
          inProgress
        });
      };

      // Process each employee sequentially
      for (let i = 0; i < totalEmployees; i++) {
        // Abort: stop before processing the next row. Any in-flight row has already
        // settled and been recorded, so no row is left in an indeterminate state.
        if (abortRef.current) {
          abortedDuringUpload = true;
          addLogEntry(`⏹️ Upload aborted by user. ${i} of ${totalEmployees} rows processed; remaining ${totalEmployees - i} row(s) were not uploaded.`);
          break;
        }

        const apiPayload = validation.validatedEmployees[i];
        const convertedEmployee = validation.convertedEmployees[i];
        const employeeName = `${apiPayload.firstName} ${apiPayload.lastName}`;
        const rowIndex = convertedEmployee.rowIndex ?? i;
        const validFrom = convertedEmployee.wageValidFrom || new Date().toISOString().split('T')[0];

        addLogEntry(`📝 Processing ${i + 1}/${totalEmployees}: ${employeeName}...`);
        updateLiveProgress(i + 1, true);

        let employeeId: number | null = null;
        const inlineErrors: string[] = [];

        // Step 1: Create the employee
        try {
          const createResult = await plandayApi.createEmployee(apiPayload);
          employeeId = createResult.data.id;
          addLogEntry(`   ✅ Employee created (ID: ${employeeId})`);

          // Log warning if time-limited skills were skipped
          if (convertedEmployee.__timeLimitedSkillIds && Array.isArray(convertedEmployee.__timeLimitedSkillIds) && convertedEmployee.__timeLimitedSkillIds.length > 0) {
            addLogEntry(`   ⚠️ ${convertedEmployee.__timeLimitedSkillIds.length} time-limited skill(s) must be assigned manually in Planday (require validity dates)`);
          }
        } catch (error) {
          // Employee creation failed - record and continue with the next row (best-effort)
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          uploadResults.push({
            success: false,
            error: errorMessage,
            employee: apiPayload,
            rowIndex
          });
          failedCount++;
          addLogEntry(`   ❌ Employee creation failed: ${errorMessage}`);
          updateLiveProgress(i + 1, true);
          continue;
        }

        // Step 2: Inline - Assign contract rule (if specified)
        if (convertedEmployee.__contractRuleAssignment) {
          try {
            await plandayApi.assignContractRule(
              employeeId,
              convertedEmployee.__contractRuleAssignment.contractRuleId
            );
            contractRuleResultsArray.push({
              employeeId,
              contractRuleId: convertedEmployee.__contractRuleAssignment.contractRuleId,
              contractRuleName: convertedEmployee.__contractRuleAssignment.contractRuleName,
              success: true
            });
            addLogEntry(`   ✅ Contract rule assigned: ${convertedEmployee.__contractRuleAssignment.contractRuleName}`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            contractRuleResultsArray.push({
              employeeId,
              contractRuleId: convertedEmployee.__contractRuleAssignment.contractRuleId,
              contractRuleName: convertedEmployee.__contractRuleAssignment.contractRuleName,
              success: false,
              error: errorMessage
            });
            inlineErrors.push(`Contract rule (${convertedEmployee.__contractRuleAssignment.contractRuleName}): ${errorMessage}`);
            addLogEntry(`   ⚠️ Contract rule failed: ${errorMessage}`);
          }
        }

        // Step 3: Inline - Assign fixed salary (if specified)
        if (convertedEmployee.__fixedSalaryAssignment) {
          try {
            await plandayApi.assignFixedSalary(
              employeeId,
              convertedEmployee.__fixedSalaryAssignment.salaryTypeId,
              convertedEmployee.__fixedSalaryAssignment.hours,
              convertedEmployee.__fixedSalaryAssignment.salary,
              validFrom
            );
            salaryResultsArray.push({
              employeeId,
              salaryTypeId: convertedEmployee.__fixedSalaryAssignment.salaryTypeId,
              salaryTypeName: convertedEmployee.__fixedSalaryAssignment.salaryTypeName,
              hours: convertedEmployee.__fixedSalaryAssignment.hours,
              salary: convertedEmployee.__fixedSalaryAssignment.salary,
              success: true
            });
            addLogEntry(`   ✅ Fixed salary assigned: ${convertedEmployee.__fixedSalaryAssignment.salaryTypeName} - ${convertedEmployee.__fixedSalaryAssignment.salary}`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            salaryResultsArray.push({
              employeeId,
              salaryTypeId: convertedEmployee.__fixedSalaryAssignment.salaryTypeId,
              salaryTypeName: convertedEmployee.__fixedSalaryAssignment.salaryTypeName,
              hours: convertedEmployee.__fixedSalaryAssignment.hours,
              salary: convertedEmployee.__fixedSalaryAssignment.salary,
              success: false,
              error: errorMessage
            });
            inlineErrors.push(`Fixed salary (${convertedEmployee.__fixedSalaryAssignment.salaryTypeName}): ${errorMessage}`);
            addLogEntry(`   ⚠️ Fixed salary failed: ${errorMessage}`);
          }
        }

        // Step 4: Inline - Assign hourly pay rates (if specified)
        const payrates = convertedEmployee.__employeeGroupPayrates || [];
        for (const pr of payrates) {
          try {
            await plandayApi.setEmployeeGroupPayrate(pr.groupId, employeeId, pr.hourlyRate, validFrom);
            payrateResultsArray.push({
              employeeId,
              groupId: pr.groupId,
              groupName: pr.groupName,
              rate: pr.hourlyRate,
              success: true
            });
            addLogEntry(`   ✅ Pay rate assigned: ${pr.groupName} - ${pr.hourlyRate}/hr`);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            payrateResultsArray.push({
              employeeId,
              groupId: pr.groupId,
              groupName: pr.groupName,
              rate: pr.hourlyRate,
              success: false,
              error: errorMessage
            });
            inlineErrors.push(`Pay rate (${pr.groupName}): ${errorMessage}`);
            addLogEntry(`   ⚠️ Pay rate failed for ${pr.groupName}: ${errorMessage}`);
          }
        }

        // Step 5: Queue supervisor assignment (deferred until all employees created)
        // Note: supervisorId will be resolved AFTER all employees are created (to include new supervisors)
        if (convertedEmployee.__supervisorAssignment) {
          supervisorQueue.push({
            employeeId,
            supervisorName: convertedEmployee.__supervisorAssignment.supervisorName
          });
          addLogEntry(`   📋 Supervisor queued: ${convertedEmployee.__supervisorAssignment.supervisorName} (will resolve & assign after all employees created)`);
        }

        // Record the row result. Inline failures => "partial" (created, but follow-up failed).
        const isPartial = inlineErrors.length > 0;
        uploadResults.push({
          success: true,
          plandayId: employeeId,
          employee: apiPayload,
          rowIndex,
          partialErrors: isPartial ? inlineErrors : undefined
        });
        if (isPartial) {
          partialCount++;
        } else {
          successCount++;
        }
        updateLiveProgress(i + 1, true);
      }

      // Set inline operation results
      if (contractRuleResultsArray.length > 0) setContractRuleResults(contractRuleResultsArray);
      if (payrateResultsArray.length > 0) setPayrateResults(payrateResultsArray);
      if (salaryResultsArray.length > 0) setSalaryResults(salaryResultsArray);

      // Phase 4: Deferred supervisor assignments for the employees that were created.
      // IMPORTANT: Supervisor names are resolved AFTER all employees are created because
      // new employees marked with isSupervisor=true won't be in the supervisor list until created.
      if (supervisorQueue.length > 0) {
        setStatus('post-processing');
        addLogEntry(`⚙️ Processing deferred supervisor assignments: ${supervisorQueue.length} supervisors...`);

        // Step 1: Refresh supervisor list to include newly created supervisors
        addLogEntry(`   🔄 Refreshing supervisor list to include newly created supervisors...`);
        try {
          await plandayApi.refreshSupervisors();
          addLogEntry(`   ✅ Supervisor list refreshed successfully`);
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : 'Unknown error';
          addLogEntry(`   ⚠️ Warning: Failed to refresh supervisor list: ${errMsg}`);
        }

        const supervisorResultsData: Array<{ employeeId: number; supervisorId: number; supervisorName: string; success: boolean; error?: string }> = [];

        // Attach a supervisor failure to the employee's row result (marks it as partial)
        const markRowPartial = (empId: number, message: string) => {
          const entry = uploadResults.find(r => r.success && r.plandayId === empId);
          if (entry) {
            if (!entry.partialErrors) entry.partialErrors = [];
            entry.partialErrors.push(message);
          }
        };

        // Step 2: Resolve supervisor names to IDs and assign
        for (let i = 0; i < supervisorQueue.length; i++) {
          const assignment = supervisorQueue[i];
          setSupervisorProgress({ completed: i, total: supervisorQueue.length });

          try {
            // Resolve supervisor name to ID using the refreshed supervisor list
            const supervisorResult = MappingUtils.resolveSupervisor(assignment.supervisorName);

            if (supervisorResult.errors.length > 0) {
              // Supervisor name couldn't be resolved
              supervisorResultsData.push({
                employeeId: assignment.employeeId,
                supervisorId: 0,
                supervisorName: assignment.supervisorName,
                success: false,
                error: supervisorResult.errors.join(', ')
              });
              markRowPartial(assignment.employeeId, `Supervisor (${assignment.supervisorName}): ${supervisorResult.errors.join(', ')}`);
              addLogEntry(`   ⚠️ Supervisor not found: "${assignment.supervisorName}" - ${supervisorResult.errors.join(', ')}`);
            } else if (supervisorResult.ids.length === 1) {
              // Successfully resolved - assign the supervisor
              const resolvedSupervisorId = supervisorResult.ids[0];
              await plandayApi.assignSupervisorToEmployee(assignment.employeeId, resolvedSupervisorId);
              supervisorResultsData.push({
                employeeId: assignment.employeeId,
                supervisorId: resolvedSupervisorId,
                supervisorName: assignment.supervisorName,
                success: true
              });
              addLogEntry(`   ✅ Supervisor assigned: ${assignment.supervisorName} to employee ${assignment.employeeId}`);
            } else {
              // Multiple matches or no matches
              supervisorResultsData.push({
                employeeId: assignment.employeeId,
                supervisorId: 0,
                supervisorName: assignment.supervisorName,
                success: false,
                error: `Could not uniquely resolve supervisor "${assignment.supervisorName}"`
              });
              markRowPartial(assignment.employeeId, `Supervisor (${assignment.supervisorName}): could not uniquely resolve`);
              addLogEntry(`   ⚠️ Supervisor resolution failed: "${assignment.supervisorName}"`);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            supervisorResultsData.push({
              employeeId: assignment.employeeId,
              supervisorId: 0,
              supervisorName: assignment.supervisorName,
              success: false,
              error: errorMessage
            });
            markRowPartial(assignment.employeeId, `Supervisor (${assignment.supervisorName}): ${errorMessage}`);
            addLogEntry(`   ⚠️ Supervisor assignment failed: ${errorMessage}`);
          }
        }

        setSupervisorProgress({ completed: supervisorQueue.length, total: supervisorQueue.length });
        setSupervisorResults(supervisorResultsData);

        const successfulSupervisors = supervisorResultsData.filter(r => r.success).length;
        const failedSupervisors = supervisorResultsData.filter(r => !r.success).length;

        if (failedSupervisors > 0) {
          addLogEntry(`⚠️ Supervisor assignments: ${successfulSupervisors} successful, ${failedSupervisors} failed`);
        } else {
          addLogEntry(`✅ All ${successfulSupervisors} supervisor assignments successful!`);
        }
      }

      // Recompute final counts - supervisor failures may have moved success -> partial
      successCount = uploadResults.filter(r => r.success && !(r.partialErrors && r.partialErrors.length)).length;
      partialCount = uploadResults.filter(r => r.success && r.partialErrors && r.partialErrors.length > 0).length;
      failedCount = uploadResults.filter(r => !r.success).length;
      updateLiveProgress(totalEmployees, false);

      setResults(uploadResults);

      if (abortedDuringUpload) {
        setStatus('aborted');
        addLogEntry(`⏹️ Upload aborted. Final: ${successCount} successful, ${partialCount} partial, ${failedCount} failed.`);
      } else {
        setStatus('completed');
        addLogEntry(`✅ Upload complete. Final: ${successCount} successful, ${partialCount} partial, ${failedCount} failed.`);
      }

    } catch (error) {
      console.error('❌ Upload failed:', error);
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Unknown upload error');
      addLogEntry(`❌ Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Handle completion - pass results to parent including post-creation results
  const handleComplete = () => {
    if (results) {
      const postCreationResults: PostCreationResults = {};

      // Include supervisor results if any
      if (supervisorResults && supervisorResults.length > 0) {
        postCreationResults.supervisorResults = supervisorResults;
      }

      // Include salary results if any
      if (salaryResults && salaryResults.length > 0) {
        postCreationResults.salaryResults = salaryResults.map(r => ({
          employeeId: r.employeeId,
          success: r.success,
          error: r.error
        }));
      }

      // Include contract rule results if any
      if (contractRuleResults && contractRuleResults.length > 0) {
        postCreationResults.contractRuleResults = contractRuleResults.map(r => ({
          employeeId: r.employeeId,
          success: r.success,
          error: r.error
        }));
      }

      onComplete(results, postCreationResults);
    }
  };

  // Confirm the abort: the loop will stop before the next row.
  const confirmAbort = () => {
    abortRef.current = true;
    setAbortPending(true);
    setShowAbortConfirm(false);
    addLogEntry('⏹️ Abort requested - finishing the current row, then stopping...');
  };

  // Auto-start upload when component mounts
  useEffect(() => {
    // Small delay to allow UI to render before starting
    const timer = setTimeout(() => {
      if (status === 'preparing') {
        startUpload();
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [status]);

  // Calculate progress percentage (success + partial + failed of total)
  const partialCount = progress?.partial || 0;
  const progressPercentage = progress ? Math.round((progress.completed + partialCount + progress.failed) / progress.total * 100) : 0;

  // Terminal states where the run is over and the round-trip / results actions apply
  const isTerminal = status === 'completed' || status === 'aborted';
  const hasSuccessfulRows = !!results && results.some(r => r.success);

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Abort Confirmation Modal */}
      {showAbortConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-start space-x-3 mb-4">
              <svg className="w-6 h-6 text-red-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Abort upload?</h3>
                <p className="text-sm text-gray-600">
                  The current employee being processed will finish first, then the upload will stop.
                  Employees already uploaded will <strong>stay in Planday</strong> — they are not rolled back.
                  Remaining rows will <strong>not</strong> be processed.
                  Afterwards you can use “Go back to edit table” to fix and retry the remaining rows.
                </p>
              </div>
            </div>
            <div className="flex justify-end space-x-3">
              <Button variant="secondary" onClick={() => setShowAbortConfirm(false)}>
                Keep uploading
              </Button>
              <Button variant="error" onClick={confirmAbort}>
                Abort upload
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <Card>
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            {status === 'preparing' && (
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            )}
            {status === 'validating' && (
              <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            )}
            {status === 'authenticating' && (
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            )}
            {status === 'uploading' && (
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            )}
            {status === 'post-processing' && (
              <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin"></div>
            )}
            {status === 'completed' && (
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
              </svg>
            )}
            {status === 'aborted' && (
              <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z M9 9h6v6H9z" />
              </svg>
            )}
            {status === 'error' && (
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {status === 'preparing' && 'Preparing Upload...'}
            {status === 'validating' && 'Validating All Employees'}
            {status === 'authenticating' && 'Re-authenticating with Planday'}
            {status === 'uploading' && 'Uploading to Planday'}
            {status === 'post-processing' && 'Finalizing Employee Setup'}
            {status === 'completed' && 'Upload Complete!'}
            {status === 'aborted' && 'Upload Aborted'}
            {status === 'error' && 'Upload Failed'}
          </h2>
          <p className="text-gray-600">
            {status === 'preparing' && 'Initializing upload process...'}
            {status === 'validating' && `Pre-validating all ${employees.length} employees. Upload only starts once everything is valid.`}
            {status === 'authenticating' && 'Authentication expired. Automatically refreshing your session...'}
            {status === 'uploading' && `Upload in progress - failed rows are recorded and skipped so the rest still upload.`}
            {status === 'post-processing' && 'Setting pay rates and assigning supervisors...'}
            {status === 'completed' && 'Finished processing all employees. Review the results below.'}
            {status === 'aborted' && 'Upload was stopped. Employees already created remain in Planday. Review the results below.'}
            {status === 'error' && 'Upload could not start. Fix the issues and try again.'}
          </p>
        </div>
      </Card>

      {/* Progress Tracking */}
      {progress && (
        <Card>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold text-gray-900">Upload Progress</h3>
              <span className="text-sm text-gray-600">
                {progressPercentage}% Complete
              </span>
            </div>

            {/* Progress Bar */}
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progressPercentage}%` }}
              ></div>
            </div>

            {/* Live Counters: Successful / Partial / Failure */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div className="p-3 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{progress.completed}</div>
                <div className="text-sm text-gray-600">Successful</div>
              </div>
              <div className="p-3 bg-yellow-50 rounded-lg">
                <div className="text-2xl font-bold text-yellow-600">{partialCount}</div>
                <div className="text-sm text-gray-600">Partial</div>
              </div>
              <div className="p-3 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">{progress.failed}</div>
                <div className="text-sm text-gray-600">Failure</div>
              </div>
              <div className="p-3 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {progress.currentBatch}/{progress.total}
                </div>
                <div className="text-sm text-gray-600">Processed</div>
              </div>
            </div>

            {/* Abort button (during upload) */}
            {status === 'uploading' && (
              <div className="flex flex-col items-center space-y-2 pt-2">
                <Button
                  variant="error"
                  onClick={() => setShowAbortConfirm(true)}
                  disabled={abortPending}
                  className="flex items-center space-x-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <rect x="9" y="9" width="6" height="6" />
                  </svg>
                  <span>{abortPending ? 'Stopping after current row...' : 'Abort'}</span>
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Post-Processing Progress */}
      {status === 'post-processing' && supervisorProgress && (
        <Card>
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">Post-Processing</h3>

            {/* Supervisor Progress */}
            {supervisorProgress && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium text-gray-700">Supervisor Assignments</span>
                  <span className="text-sm text-gray-600">
                    {supervisorProgress.completed} / {supervisorProgress.total}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-purple-600 h-2 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${(supervisorProgress.completed / supervisorProgress.total) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Contract Rule Results (processed inline, before deferred operations) */}
      {isTerminal && contractRuleResults && contractRuleResults.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Contract Rule Results</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {contractRuleResults.filter(r => r.success).length}
              </div>
              <div className="text-sm text-green-700">Contract Rules Assigned</div>
            </div>
            <div className="p-4 bg-red-50 rounded-lg">
              <div className="text-2xl font-bold text-red-600">
                {contractRuleResults.filter(r => !r.success).length}
              </div>
              <div className="text-sm text-red-700">Failed (Partial Success)</div>
            </div>
          </div>
          {contractRuleResults.some(r => !r.success) && (
            <div className="mt-4">
              <h4 className="font-medium text-amber-800 mb-2">Failed Contract Rule Assignments:</h4>
              <p className="text-sm text-amber-700 mb-2">
                Employees were created successfully but contract rule assignment failed.
              </p>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {contractRuleResults.filter(r => !r.success).map((result, index) => (
                  <div key={index} className="p-2 bg-amber-50 rounded text-sm">
                    <span className="font-medium">Employee {result.employeeId}</span>: {result.contractRuleName} - {result.error}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Pay Rate Results */}
      {isTerminal && payrateResults && payrateResults.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Pay Rate Results</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {payrateResults.filter(r => r.success).length}
              </div>
              <div className="text-sm text-green-700">Pay Rates Set</div>
            </div>
            <div className="p-4 bg-red-50 rounded-lg">
              <div className="text-2xl font-bold text-red-600">
                {payrateResults.filter(r => !r.success).length}
              </div>
              <div className="text-sm text-red-700">Failed</div>
            </div>
          </div>
          {payrateResults.some(r => !r.success) && (
            <div className="mt-4">
              <h4 className="font-medium text-red-800 mb-2">Failed Pay Rates:</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {payrateResults.filter(r => !r.success).map((result, index) => (
                  <div key={index} className="p-2 bg-red-50 rounded text-sm">
                    <span className="font-medium">{result.groupName}</span>: Rate {result.rate} - {result.error}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Fixed Salary Results */}
      {isTerminal && salaryResults && salaryResults.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Fixed Salary Results</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {salaryResults.filter(r => r.success).length}
              </div>
              <div className="text-sm text-green-700">Salaries Set</div>
            </div>
            <div className="p-4 bg-red-50 rounded-lg">
              <div className="text-2xl font-bold text-red-600">
                {salaryResults.filter(r => !r.success).length}
              </div>
              <div className="text-sm text-red-700">Failed</div>
            </div>
          </div>
          {salaryResults.some(r => !r.success) && (
            <div className="mt-4">
              <h4 className="font-medium text-red-800 mb-2">Failed Fixed Salaries:</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {salaryResults.filter(r => !r.success).map((result, index) => (
                  <div key={index} className="p-2 bg-red-50 rounded text-sm">
                    <span className="font-medium">{result.salaryTypeName}</span>: {result.salary} ({result.hours}h) - {result.error}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Supervisor Results */}
      {isTerminal && supervisorResults && supervisorResults.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Supervisor Assignment Results</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {supervisorResults.filter(r => r.success).length}
              </div>
              <div className="text-sm text-green-700">Supervisors Assigned</div>
            </div>
            <div className="p-4 bg-red-50 rounded-lg">
              <div className="text-2xl font-bold text-red-600">
                {supervisorResults.filter(r => !r.success).length}
              </div>
              <div className="text-sm text-red-700">Failed</div>
            </div>
          </div>
          {supervisorResults.some(r => !r.success) && (
            <div className="mt-4">
              <h4 className="font-medium text-red-800 mb-2">Failed Supervisor Assignments:</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {supervisorResults.filter(r => !r.success).map((result, index) => (
                  <div key={index} className="p-2 bg-red-50 rounded text-sm">
                    <span className="font-medium">{result.supervisorName}</span> - {result.error}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Validation Errors Display */}
      {status === 'error' && validationErrors.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <svg className="w-6 h-6 text-red-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <h4 className="font-medium text-red-800 mb-2">Validation Errors - Upload Blocked</h4>
                <p className="text-red-700 text-sm mb-4">
                  {validationErrors.length} employees failed validation. Go back to the edit table to fix these issues before uploading.
                  <br/>
                  <strong>Note:</strong> No employees have been uploaded to Planday.
                </p>
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto">
              <h5 className="font-medium text-red-800 mb-2">Employees with validation errors:</h5>
              <div className="space-y-3">
                {validationErrors.map((errorGroup, index) => (
                  <div key={index} className="p-3 bg-white rounded border border-red-200">
                    <div className="font-medium text-red-800 mb-1">{errorGroup.employee}</div>
                    <ul className="text-sm text-red-700 list-disc list-inside space-y-1">
                      {errorGroup.errors.map((error, errorIndex) => (
                        <li key={errorIndex}>{error}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Other Errors Display */}
      {status === 'error' && errorMessage && validationErrors.length === 0 && !results && (
        <Card className="border-red-200 bg-red-50">
          <div className="flex items-start space-x-3">
            <svg className="w-6 h-6 text-red-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h4 className="font-medium text-red-800 mb-2">Upload Error</h4>
              <p className="text-red-700 text-sm">{errorMessage}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Processing Log */}
      <Card>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Processing Log</h3>
        <div className="bg-gray-50 rounded-lg p-4 max-h-60 overflow-y-auto">
          <div className="font-mono text-sm space-y-1">
            {processingLog.length === 0 ? (
              <div className="text-gray-500">Waiting to start...</div>
            ) : (
              processingLog.map((entry, index) => (
                <div key={index} className="text-gray-700">
                  {entry}
                </div>
              ))
            )}
          </div>
        </div>
      </Card>

      {/* Results Summary (terminal: completed or aborted) */}
      {isTerminal && results && (
        <Card>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Upload Results</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-green-50 rounded-lg text-center">
                <div className="text-2xl font-bold text-green-600">
                  {results.filter(r => r.success && !(r.partialErrors && r.partialErrors.length)).length}
                </div>
                <div className="text-sm text-green-700">Successful</div>
              </div>
              <div className="p-4 bg-yellow-50 rounded-lg text-center">
                <div className="text-2xl font-bold text-yellow-600">
                  {results.filter(r => r.success && r.partialErrors && r.partialErrors.length > 0).length}
                </div>
                <div className="text-sm text-yellow-700">Partial</div>
              </div>
              <div className="p-4 bg-red-50 rounded-lg text-center">
                <div className="text-2xl font-bold text-red-600">
                  {results.filter(r => !r.success).length}
                </div>
                <div className="text-sm text-red-700">Failure</div>
              </div>
            </div>

            {/* Partial Employees Details */}
            {results.some(r => r.success && r.partialErrors && r.partialErrors.length > 0) && (
              <div>
                <h4 className="font-medium text-yellow-800 mb-2">Partially Created (already exist in Planday - fix manually or via the bulk update tool):</h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {results
                    .filter(r => r.success && r.partialErrors && r.partialErrors.length > 0)
                    .map((result, index) => (
                      <div key={index} className="p-3 bg-yellow-50 rounded text-sm">
                        <div className="font-medium text-yellow-800">
                          {result.employee.firstName} {result.employee.lastName}
                          {result.plandayId ? <span className="text-yellow-700 font-normal"> (ID: {result.plandayId})</span> : null}
                        </div>
                        <ul className="text-yellow-700 list-disc list-inside">
                          {result.partialErrors!.map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {/* Failed Employees Details */}
            {results.some(r => !r.success) && (
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Failed (not created):</h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {results
                    .filter(r => !r.success)
                    .map((result, index) => (
                      <div key={index} className="p-3 bg-red-50 rounded text-sm">
                        <div className="font-medium text-red-800">
                          {result.employee.firstName} {result.employee.lastName} (Row {result.rowIndex + 1})
                        </div>
                        <div className="text-red-600">{result.error}</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}

            {results.some(r => r.success) && (
              <p className="text-sm text-gray-600">
                Use “Go back to edit table” to return to the review table. Created employees (successful and partial)
                are removed there so a re-run won’t duplicate them; failed rows stay for correction and retry.
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Action Buttons (step-back lives in the top navigation bar) */}
      <div className="flex justify-end items-center pt-6">
        <div className="space-x-3">
          {/* Validation Error - Go back to the edit table to fix issues */}
          {status === 'error' && validationErrors.length > 0 && (
            <Button
              variant="primary"
              onClick={() => onBackToEditTable(results || [])}
              className="flex items-center space-x-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span>Go back to edit table</span>
            </Button>
          )}

          {/* Other Errors - Retry upload */}
          {status === 'error' && validationErrors.length === 0 && (
            <Button
              variant="secondary"
              onClick={() => {
                abortRef.current = false;
                setAbortPending(false);
                setStatus('preparing');
                setErrorMessage(null);
                setValidationErrors([]);
                setResults(null);
                setProgress(null);
                setProcessingLog([]);
              }}
            >
              Retry Upload
            </Button>
          )}

          {/* Terminal states (completed / aborted): always offer "Go back to edit table" */}
          {isTerminal && (
            <Button
              variant="secondary"
              onClick={() => onBackToEditTable(results || [])}
              className="flex items-center space-x-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span>Go back to edit table</span>
            </Button>
          )}

          {isTerminal && hasSuccessfulRows && (
            <Button
              variant="primary"
              onClick={handleComplete}
              className="flex items-center space-x-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
              </svg>
              <span>View Results</span>
            </Button>
          )}

          {status === 'validating' && (
            <Button
              variant="primary"
              disabled
              className="flex items-center space-x-2"
            >
              <div className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Validating...</span>
            </Button>
          )}

          {status === 'authenticating' && (
            <Button
              variant="primary"
              disabled
              className="flex items-center space-x-2"
            >
              <div className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Re-authenticating...</span>
            </Button>
          )}

          {status === 'uploading' && (
            <Button
              variant="primary"
              disabled
              className="flex items-center space-x-2"
            >
              <div className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Uploading...</span>
            </Button>
          )}

          {status === 'post-processing' && (
            <Button
              variant="primary"
              disabled
              className="flex items-center space-x-2"
            >
              <div className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin"></div>
              <span>Finalizing...</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BulkUploadStep;
