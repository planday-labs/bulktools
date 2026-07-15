/**
 * Workflow App Component
 * 
 * Contains the main 7-step workflow logic, extracted from App.tsx
 * This component handles the actual business logic while App.tsx handles routing
 */

import { useState, useEffect, useRef } from 'react';
import { Button, Card, ProgressIndicator, PrivacyModal, CookieModal, TermsOfServiceModal, VersionModal, getCurrentVersion, BetaBanner, BetaTag, ConfirmDialog } from './ui';
import { AuthenticationStep } from './auth/AuthenticationStep';
import { FileUploadStep } from './upload/FileUploadStep';
import MappingStep from './mapping/MappingStep';
import ValidationAndCorrectionStep from './validation/ValidationAndCorrectionStep';

import FinalPreviewStep from './results/FinalPreviewStep';
import BulkUploadStep from './results/BulkUploadStep';
import type { PostCreationResults } from './results/BulkUploadStep';
import ResultsVerificationStep from './results/ResultsVerificationStep';
import { usePlandayApi } from '../hooks/usePlandayApi';
import { APP_METADATA, WorkflowStep, MAIN_WORKFLOW_STEPS } from '../constants';
import type {
  ParsedExcelData,
  ExcelColumnMapping,
  ColumnMapping,
  Employee,
  ExcludedEmployee,
  WorkflowStep as WorkflowStepType,
  EmployeeUploadResult,
  PlandayEmployeeCreateRequest
} from '../types/planday';

interface WorkflowAppProps {
  onStepChange?: (step: WorkflowStepType) => void;
}

export function WorkflowApp({ onStepChange }: WorkflowAppProps = {}) {
  // Application state
  const [currentStep, setCurrentStep] = useState<WorkflowStepType>(WorkflowStep.Authentication);
  const [completedSteps, setCompletedSteps] = useState<WorkflowStepType[]>([]);
  
  // Excel file data
  const [excelData, setExcelData] = useState<ParsedExcelData | null>(null);
  const [columnMappings, setColumnMappings] = useState<ExcelColumnMapping[]>([]);
  
  // Enhanced mapping data (will be used in later steps)
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [mappedColumns, setMappedColumns] = useState<ColumnMapping>({});
  const [customValues, setCustomValues] = useState<{ [fieldName: string]: string }>({});
  
  // Bulk correction state - persists across navigation but resets when going back to mapping
  const [resolvedBulkCorrectionPatterns, setResolvedBulkCorrectionPatterns] = useState<Map<string, string>>(new Map());
  
  // Upload results state for verification step
  const [uploadResults, setUploadResults] = useState<EmployeeUploadResult[]>([]);
  const [originalEmployees, setOriginalEmployees] = useState<PlandayEmployeeCreateRequest[]>([]);

  // Post-creation operation results (supervisors, salaries, etc.)
  const [postCreationResults, setPostCreationResults] = useState<PostCreationResults>({});

  // Excluded employees (those with errors that were skipped during upload)
  const [excludedEmployees, setExcludedEmployees] = useState<ExcludedEmployee[]>([]);

  // Notice shown after a "go back to edit table" round-trip, informing the user which
  // already-created rows were removed and which need manual fixing in Planday.
  const [roundTripNotice, setRoundTripNotice] = useState<{
    removedSuccess: number;
    partial: Array<{ name: string; errors: string[] }>;
    remaining: number;
  } | null>(null);

  // Privacy modal state
  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  
  // Cookie modal state
  const [isCookieModalOpen, setIsCookieModalOpen] = useState(false);
  
  // Terms of Service modal state
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);
  
  // Version modal state
  const [isVersionModalOpen, setIsVersionModalOpen] = useState(false);

  // "Start over" confirmation dialog (guards the destructive reset)
  const [isStartOverConfirmOpen, setIsStartOverConfirmOpen] = useState(false);

  // True while the bulk upload is actively running. Used to block the top-left
  // "Back" control so the user can't navigate away mid-upload.
  const [isUploadBusy, setIsUploadBusy] = useState(false);

  // Refs read by the global popstate/beforeunload handlers (bound once on mount),
  // so they always see the latest values without re-binding the listeners.
  const currentStepRef = useRef(currentStep);
  currentStepRef.current = currentStep;
  const isUploadBusyRef = useRef(isUploadBusy);
  isUploadBusyRef.current = isUploadBusy;
  const handlePreviousStepRef = useRef<() => void>(() => {});
  const historyTrapArmedRef = useRef(false);

  // Planday API integration - centralized hook usage
  const plandayApi = usePlandayApi();
  const { departments, employeeGroups, employeeTypes } = plandayApi;

  // Resync state - lets the user pull fresh portal options (departments, groups, types,
  // supervisors, enum fields, ...) mid-flow after creating a missing option in Planday,
  // then re-validate the rows without restarting from authentication. The nonce is bumped
  // on every successful resync and threaded into the validation step to force a fresh
  // validation pass against the newly-loaded options (entered cell values are preserved).
  const [isResyncing, setIsResyncing] = useState(false);
  const [resyncNonce, setResyncNonce] = useState(0);
  const [resyncError, setResyncError] = useState<string | null>(null);
  const [resyncJustSucceeded, setResyncJustSucceeded] = useState(false);

  const handleResync = async () => {
    if (isResyncing) return;
    setIsResyncing(true);
    setResyncError(null);
    setResyncJustSucceeded(false);
    try {
      await plandayApi.resyncPortalData();
      setResyncNonce(prev => prev + 1);
      setResyncJustSucceeded(true);
      setTimeout(() => setResyncJustSucceeded(false), 4000);
    } catch (error) {
      console.error('❌ Resync failed:', error);
      setResyncError(
        error instanceof Error ? error.message : 'Failed to resync portal data. Please try again.'
      );
    } finally {
      setIsResyncing(false);
    }
  };

  // Security: Clean up any stray tokens from localStorage on app initialization
  useEffect(() => {
    // Our app uses sessionStorage for security, but clean localStorage
    // in case other apps, browser extensions, or previous versions left tokens there
    localStorage.removeItem('planday_refresh_token');
    localStorage.removeItem('planday_access_token');
    localStorage.removeItem('planday_token_expiry');
    
    // Clear any other potential Planday-related tokens
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('planday_')) {
        keysToRemove.push(key);
      }
    }
    
    // Only log if we actually found tokens to remove
    if (keysToRemove.length > 0) {
      console.log('🔒 Security cleanup: Found and removing stray Planday tokens from localStorage');
      keysToRemove.forEach(key => {
        console.log(`🧹 Removing stray token: ${key}`);
        localStorage.removeItem(key);
      });
    }
  }, []); // Run only on mount

  // Notify parent component of step changes
  useEffect(() => {
    if (onStepChange) {
      onStepChange(currentStep);
    }
  }, [currentStep, onStepChange]);

  // Arm a single history "trap" entry when the user enters the workflow (leaves
  // Authentication). The 7 steps are React state, not routes, so without this the
  // browser back button would leave the SPA entirely and silently destroy an
  // in-progress upload. With the trap in place, back fires popstate (handled
  // below) instead of unloading the app.
  useEffect(() => {
    if (currentStep !== WorkflowStep.Authentication && !historyTrapArmedRef.current) {
      window.history.pushState({ workflowTrap: true }, '');
      historyTrapArmedRef.current = true;
    } else if (currentStep === WorkflowStep.Authentication) {
      historyTrapArmedRef.current = false;
    }
  }, [currentStep]);

  // Map the browser back button to a single workflow step-back, and warn before
  // a tab close / reload that would lose an in-progress upload. Bound once.
  useEffect(() => {
    const onPopState = () => {
      const step = currentStepRef.current;
      if (step === WorkflowStep.Authentication) {
        // On step 1 there's nothing to go back to within the workflow; let the
        // browser navigate away normally.
        return;
      }
      // While an upload is actively running, swallow the back press entirely
      // (re-arm the trap, don't navigate) so we never abandon a run mid-flight.
      if (isUploadBusyRef.current) {
        window.history.pushState({ workflowTrap: true }, '');
        return;
      }
      // Re-arm the trap so the next back press is caught too — unless this press
      // returns the user to Authentication (FileUpload is the last trapped step).
      if (step !== WorkflowStep.FileUpload) {
        window.history.pushState({ workflowTrap: true }, '');
      } else {
        historyTrapArmedRef.current = false;
      }
      handlePreviousStepRef.current();
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (currentStepRef.current !== WorkflowStep.Authentication) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  /**
   * Move to the next step in the workflow
   */
  const handleNextStep = () => {
    const mainSteps = MAIN_WORKFLOW_STEPS.map(step => step.key);
    const currentIndex = mainSteps.indexOf(currentStep as typeof mainSteps[number]);
    
    if (currentIndex < mainSteps.length - 1) {
      // Mark current step as completed
      setCompletedSteps(prev => [...prev, currentStep]);

      // Move to next main step
      setCurrentStep(mainSteps[currentIndex + 1]);
    }
  };

  /**
   * Return to the Validation/Correction (edit) table after an upload/abort, keeping the
   * already-mapped/corrected data in memory. Rows that were created in Planday (successful
   * AND partial) are stripped so a re-run can't duplicate them; failed rows remain for
   * correction and retry. The user is informed about what was removed and what needs
   * manual fixing.
   */
  const handleBackToEditTable = (results: EmployeeUploadResult[]) => {
    // uploadResult.rowIndex is the position within the `employees` array that was uploaded
    // (the validation gate guarantees a 1:1 alignment), so we can filter by index directly.
    const createdRowIndexes = new Set(
      results.filter(r => r.success).map(r => r.rowIndex)
    );

    const fullySuccessful = results.filter(r => r.success && !(r.partialErrors && r.partialErrors.length));
    const partial = results.filter(r => r.success && r.partialErrors && r.partialErrors.length > 0);

    const remaining = employees.filter((_, idx) => !createdRowIndexes.has(idx));
    setEmployees(remaining);

    // Only show a notice if something was actually created (a pure validation bounce removes nothing)
    if (createdRowIndexes.size > 0) {
      setRoundTripNotice({
        removedSuccess: fullySuccessful.length,
        partial: partial.map(r => ({
          name: `${r.employee.firstName} ${r.employee.lastName}`,
          errors: r.partialErrors || []
        })),
        remaining: remaining.length
      });
    } else {
      setRoundTripNotice(null);
    }

    // Clear stale upload results - the next run produces fresh ones
    setUploadResults([]);
    setOriginalEmployees([]);
    setPostCreationResults({});

    setCurrentStep(WorkflowStep.ValidationCorrection);
    setCompletedSteps([WorkflowStep.Authentication, WorkflowStep.FileUpload, WorkflowStep.ColumnMapping]);
  };

  /**
   * Cancel upload and start over
   */
  const handleCancelUpload = () => {
    setRoundTripNotice(null);
    // Reset everything and go back to authentication
    setCurrentStep(WorkflowStep.Authentication);
    setCompletedSteps([]);
    setExcelData(null);
    setColumnMappings([]);
    setEmployees([]);
    setMappedColumns({});
    setCustomValues({});
    setResolvedBulkCorrectionPatterns(new Map());
    setUploadResults([]);
    setOriginalEmployees([]);
    
    // Also clear Planday API state
    plandayApi.logout();
    
    // Complete localStorage and sessionStorage cleanup
    // Clear all Planday-related tokens from both storage types
    try {
      // sessionStorage cleanup (handled by plandayApi.logout() but being extra sure)
      sessionStorage.removeItem('planday_refresh_token');
      sessionStorage.removeItem('planday_access_token');
      sessionStorage.removeItem('planday_token_expiry');
      
      // localStorage cleanup (in case tokens were stored there too)
      localStorage.removeItem('planday_refresh_token');
      localStorage.removeItem('planday_access_token');
      localStorage.removeItem('planday_token_expiry');
      
      // Clear any other potential app state that might be cached
      // (Future-proofing for any other localStorage usage)
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('planday_')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      
      console.log('🧹 Complete storage cleanup completed');
    } catch (error) {
      console.warn('⚠️ Storage cleanup had issues:', error);
      // Don't throw - cleanup failures shouldn't break the cancel operation
    }
  };

  /**
   * Go back exactly one step in the workflow (non-destructive). Powers the
   * top-left "← Back" control and the browser back button. Each branch mirrors
   * the per-step back transition (target step + completedSteps reset) that
   * previously lived inline on each step component's back button.
   *
   * The Results step is special: its literal previous step (BulkUpload) re-runs
   * the upload on mount, which would create duplicates. So "back" from Results
   * routes through the safe edit-table round-trip, which strips already-created
   * rows before returning to the validation/correction table.
   */
  const handlePreviousStep = () => {
    switch (currentStep) {
      case WorkflowStep.FileUpload:
        setCurrentStep(WorkflowStep.Authentication);
        setCompletedSteps([]);
        break;
      case WorkflowStep.ColumnMapping:
        setCurrentStep(WorkflowStep.FileUpload);
        setCompletedSteps([WorkflowStep.Authentication]);
        break;
      case WorkflowStep.ValidationCorrection:
        // Returning to mapping resets the bulk-correction round-trip notice
        setRoundTripNotice(null);
        setCurrentStep(WorkflowStep.ColumnMapping);
        setCompletedSteps([WorkflowStep.Authentication, WorkflowStep.FileUpload]);
        break;
      case WorkflowStep.FinalPreview:
        setCurrentStep(WorkflowStep.ValidationCorrection);
        setCompletedSteps([WorkflowStep.Authentication, WorkflowStep.FileUpload, WorkflowStep.ColumnMapping]);
        break;
      case WorkflowStep.BulkUpload:
        // Safe: FinalPreview is a static review and never auto-uploads.
        setCurrentStep(WorkflowStep.FinalPreview);
        setCompletedSteps([WorkflowStep.Authentication, WorkflowStep.FileUpload, WorkflowStep.ColumnMapping, WorkflowStep.ValidationCorrection]);
        break;
      case WorkflowStep.Results:
        // Safe round-trip: strips already-created rows so a re-run can't duplicate them.
        handleBackToEditTable(uploadResults);
        break;
      default:
        // Authentication (or any unknown step) has nowhere to go back to.
        break;
    }
  };
  handlePreviousStepRef.current = handlePreviousStep;

  // Determine if we should show the main header (only on step 1)
  const showMainHeader = currentStep === WorkflowStep.Authentication;

  // Determine if we should show the top navigation bar (steps 2-7)
  const showTopNav = currentStep !== WorkflowStep.Authentication;

  // The Results step is terminal: its only purpose-built backward action is the
  // safe "Go back to edit table" button it renders itself, so we don't show a
  // generic top-left "Back one step" there.
  const showBackButton = showTopNav && currentStep !== WorkflowStep.Results;

  // The resync control is only relevant while validating/correcting against portal options
  const showResyncButton = currentStep === WorkflowStep.ValidationCorrection;

  return (
    <>
      {/* App Header - Only shown on step 1, slides up and disappears on step 2+ */}
      <div className={`text-center transition-all duration-500 overflow-hidden ${
        showMainHeader 
          ? 'mb-12 max-h-40 opacity-100 transform translate-y-0' 
          : 'mb-0 max-h-0 opacity-0 transform -translate-y-4'
      }`}>
        <h1 className="text-4xl font-bold text-gray-900 mb-4 dynamic-header flex items-center justify-center flex-wrap">
          <span>{APP_METADATA.NAME}</span>
          <BetaTag />
        </h1>
        <p className="text-xl text-gray-600">
          {APP_METADATA.DESCRIPTION}
        </p>
      </div>

      {/* Progress Indicator - Visible for workflow steps */}
      <div className={`flex justify-center transition-all duration-500 ${showMainHeader ? 'mb-16' : 'mb-8'}`}>
        <ProgressIndicator
          currentStep={currentStep}
          completedSteps={completedSteps}
        />
      </div>

      {/* Top navigation - Shown on all steps except step 1.
          Left: non-destructive "Back one step" plus the portal "Resync" control
          (where users instinctively look).
          Right: demoted, confirmation-guarded "Start over" (the destructive reset). */}
      {showTopNav && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 transition-all duration-500">
          <div className="flex flex-wrap items-center gap-3">
            {showBackButton ? (
              <Button
                variant="outline"
                onClick={handlePreviousStep}
                disabled={isUploadBusy}
                title={isUploadBusy ? 'Please wait for the current upload to finish' : undefined}
              >
                ← Back one step
              </Button>
            ) : (
              <span />
            )}

            {showResyncButton && (
              <Button
                variant="outline"
                onClick={handleResync}
                disabled={isResyncing}
                title="Re-fetch departments, employee groups, employee types, supervisors and other field options from Planday, then re-validate the rows. Your entered corrections are kept."
                className="text-blue-600 border-blue-300 hover:bg-blue-50 hover:border-blue-400 disabled:opacity-60"
              >
                {isResyncing ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></span>
                    Resyncing…
                  </span>
                ) : (
                  '⟳ Resync portal data'
                )}
              </Button>
            )}
            {showResyncButton && resyncJustSucceeded && (
              <span className="text-sm text-green-700">✓ Portal data refreshed</span>
            )}
            {showResyncButton && resyncError && (
              <span className="text-sm text-red-700">{resyncError}</span>
            )}
          </div>

          <button
            onClick={() => setIsStartOverConfirmOpen(true)}
            className="text-sm text-gray-500 hover:text-red-600 underline transition-colors"
          >
            Start over
          </button>
        </div>
      )}

      {/* Main Application Flow */}
      {currentStep === WorkflowStep.Authentication && (
        <>
          <AuthenticationStep
            onNext={handleNextStep}
            onPrevious={() => {}}
            onCancel={handleCancelUpload}
            onAuthenticated={() => {
              // Data is already loaded during authentication process
            }}
            plandayApi={plandayApi}
          />
          
          {/* Beta Banner - Only shown on authentication step */}
          <div className="mt-12 mb-8 flex justify-center">
            <div className="w-full max-w-4xl">
              <BetaBanner />
            </div>
          </div>
        </>
      )}

      {currentStep === WorkflowStep.FileUpload && (
        <FileUploadStep
          onNext={handleNextStep}
          onPrevious={() => {
            setCurrentStep(WorkflowStep.Authentication);
            setCompletedSteps([]);
          }}
          onCancel={handleCancelUpload}
          onFileProcessed={(data, mappings) => {
            setExcelData(data);
            setColumnMappings(mappings);
          }}
          isAuthenticated={plandayApi.isAuthenticated}
          departmentCount={departments.length}
          employeeGroupCount={employeeGroups.length}
          companyName={plandayApi.portalInfo?.companyName}
        />
      )}

      {currentStep === WorkflowStep.ColumnMapping && excelData && (
        <MappingStep
          employees={excelData.rows}
          headers={excelData.headers}
          excelData={excelData}
          initialColumnMappings={columnMappings}
          savedMappings={Object.keys(mappedColumns).length > 0 ? mappedColumns : undefined}
          savedCustomValues={Object.keys(customValues).length > 0 ? customValues : undefined}
          onComplete={(mappedEmployees, mappings, customVals) => {
            setEmployees(mappedEmployees);
            setMappedColumns(mappings);
            setCustomValues(customVals);
            handleNextStep(); // This will go to ValidationCorrection step
          }}
          onBack={() => {
            // Reset state when going back to Column Mapping
            setCurrentStep(WorkflowStep.ColumnMapping);
            setCompletedSteps([WorkflowStep.Authentication, WorkflowStep.FileUpload]);
          }}
        />
      )}

      {currentStep === WorkflowStep.ValidationCorrection && (
        <>
          {/* Round-trip notice: informs the user which created rows were removed */}
          {roundTripNotice && (
            <Card className="mb-6 border-blue-200 bg-blue-50">
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <h3 className="font-semibold text-blue-900">Returned to the edit table</h3>
                  <button
                    onClick={() => setRoundTripNotice(null)}
                    className="text-blue-500 hover:text-blue-700 text-sm"
                    aria-label="Dismiss notice"
                  >
                    Dismiss
                  </button>
                </div>
                {roundTripNotice.removedSuccess > 0 && (
                  <p className="text-sm text-blue-800">
                    <strong>{roundTripNotice.removedSuccess}</strong> fully-created employee(s) were removed from the table
                    because they already exist in Planday — re-uploading them would create duplicates.
                  </p>
                )}
                {roundTripNotice.partial.length > 0 && (
                  <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
                    <p className="mb-1">
                      <strong>{roundTripNotice.partial.length}</strong> employee(s) were created but had follow-up errors.
                      They <strong>already exist in Planday</strong> and were removed from the table so they aren’t re-created.
                      Fix these manually or via the bulk update tool:
                    </p>
                    <ul className="list-disc list-inside space-y-1 max-h-40 overflow-y-auto">
                      {roundTripNotice.partial.map((p, i) => (
                        <li key={i}>
                          <span className="font-medium">{p.name}</span>
                          {p.errors.length > 0 && <span> — {p.errors.join('; ')}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-sm text-blue-800">
                  <strong>{roundTripNotice.remaining}</strong> employee(s) remain for correction and retry.
                </p>
              </div>
            </Card>
          )}

          {employees.length > 0 ? (
            <ValidationAndCorrectionStep
              key={`validation-${currentStep}-${employees.length}`} // Removed patterns.size to prevent re-mount when patterns are saved
              employees={employees}
              departments={departments}
              employeeGroups={employeeGroups}
              employeeTypes={employeeTypes}
              resyncNonce={resyncNonce}
              resolvedPatterns={resolvedBulkCorrectionPatterns}
              onPatternsResolved={(patterns) => {
                setResolvedBulkCorrectionPatterns(patterns);
              }}
              onComplete={(correctedEmployees, excluded) => {
                setRoundTripNotice(null);
                setEmployees(correctedEmployees);
                setExcludedEmployees(excluded || []);
                handleNextStep(); // Go to final preview
              }}
              onBack={() => {
                // Reset state when going back to Column Mapping
                setRoundTripNotice(null);
                setCurrentStep(WorkflowStep.ColumnMapping);
                setCompletedSteps([WorkflowStep.Authentication, WorkflowStep.FileUpload]);
              }}
              plandayApi={plandayApi}
            />
          ) : (
            <Card>
              <div className="text-center py-12">
                <h3 className="text-xl font-semibold text-gray-900 mb-4">Nothing left to edit</h3>
                <p className="text-gray-600 mb-6">
                  All employees were created in Planday, so there are no rows left to correct.
                </p>
                <Button variant="secondary" onClick={handleCancelUpload}>
                  Start over
                </Button>
              </div>
            </Card>
          )}
        </>
      )}

      {currentStep === WorkflowStep.FinalPreview && employees.length > 0 && (
        <FinalPreviewStep
          employees={employees}
          onStartUpload={() => {
            handleNextStep(); // Go to bulk upload step
          }}
        />
      )}

      {currentStep === WorkflowStep.BulkUpload && employees.length > 0 && (
        <BulkUploadStep
          employees={employees}
          onComplete={(results, postResults) => {
            setUploadResults(results);
            // Store original employees for verification
            const originalEmps = results.map(r => r.employee);
            setOriginalEmployees(originalEmps);
            // Store post-creation results (supervisor, salary, contract rule failures)
            if (postResults) {
              setPostCreationResults(postResults);
            }
            handleNextStep(); // Go to results verification step
          }}
          onBackToEditTable={handleBackToEditTable}
          onBusyChange={setIsUploadBusy}
        />
      )}

      {currentStep === WorkflowStep.Results && uploadResults.length > 0 && (
        <ResultsVerificationStep
          uploadResults={uploadResults}
          originalEmployees={originalEmployees}
          postCreationResults={postCreationResults}
          excludedEmployees={excludedEmployees}
          onBackToEditTable={() => handleBackToEditTable(uploadResults)}
          onComplete={() => {
            // Reset everything and go back to start
            setCurrentStep(WorkflowStep.Authentication);
            setCompletedSteps([]);
            setExcelData(null);
            setColumnMappings([]);
            setEmployees([]);
            setMappedColumns({});
            setCustomValues({});
            setResolvedBulkCorrectionPatterns(new Map());
            setUploadResults([]);
            setOriginalEmployees([]);
            setPostCreationResults({});
            setExcludedEmployees([]);
          }}
          onReset={() => {
            // Complete reset of the entire application state
            setCurrentStep(WorkflowStep.Authentication);
            setCompletedSteps([]);
            setExcelData(null);
            setColumnMappings([]);
            setEmployees([]);
            setMappedColumns({});
            setCustomValues({});
            setResolvedBulkCorrectionPatterns(new Map());
            setUploadResults([]);
            setOriginalEmployees([]);
            setExcludedEmployees([]);
          }}
        />
      )}

      {/* Placeholder for remaining steps */}
      {currentStep !== WorkflowStep.Authentication && 
       currentStep !== WorkflowStep.FileUpload && 
       currentStep !== WorkflowStep.ColumnMapping && 
       currentStep !== WorkflowStep.BulkCorrections && 
       currentStep !== WorkflowStep.DateFormat && 
       currentStep !== WorkflowStep.ValidationCorrection && 
       currentStep !== WorkflowStep.FinalPreview && 
       currentStep !== WorkflowStep.BulkUpload && 
       currentStep !== WorkflowStep.Results && (
        <Card className="mb-8">
          <div className="text-center py-12">
            <h3 className="text-xl font-semibold text-gray-900 mb-4">
              🚧 Step: {currentStep}
            </h3>
            <p className="text-gray-600 mb-6">
              This step is under development. You can test the completed steps below.
            </p>
            <div className="space-x-3">
              <Button 
                variant="secondary"
                onClick={() => {
                  setCurrentStep(WorkflowStep.Authentication);
                  setCompletedSteps([]);
                }}
              >
                Go to Authentication
              </Button>
              <Button 
                variant="secondary"
                onClick={() => {
                  setCurrentStep(WorkflowStep.FileUpload);
                  setCompletedSteps([WorkflowStep.Authentication]);
                }}
              >
                Go to File Upload
              </Button>
              {excelData && (
                <Button 
                  variant="secondary"
                  onClick={() => {
                    setCurrentStep(WorkflowStep.ColumnMapping);
                    setCompletedSteps([WorkflowStep.Authentication, WorkflowStep.FileUpload]);
                  }}
                >
                  Go to Mapping
                </Button>
              )}
              {employees.length > 0 && (
                <>
                  <Button 
                    variant="secondary"
                    onClick={() => {
                      setCurrentStep(WorkflowStep.ValidationCorrection);
                      setCompletedSteps([WorkflowStep.Authentication, WorkflowStep.FileUpload, WorkflowStep.ColumnMapping]);
                    }}
                  >
                    Go to Validation & Correction
                  </Button>
                  <Button 
                    variant="secondary"
                    onClick={() => {
                      setCurrentStep(WorkflowStep.FinalPreview);
                      setCompletedSteps([WorkflowStep.Authentication, WorkflowStep.FileUpload, WorkflowStep.ColumnMapping, WorkflowStep.ValidationCorrection]);
                    }}
                  >
                    Go to Final Preview
                  </Button>
                  <Button 
                    variant="secondary"
                    onClick={() => {
                      setCurrentStep(WorkflowStep.BulkUpload);
                      setCompletedSteps([WorkflowStep.Authentication, WorkflowStep.FileUpload, WorkflowStep.ColumnMapping, WorkflowStep.ValidationCorrection, WorkflowStep.FinalPreview]);
                    }}
                  >
                    Go to Bulk Upload
                  </Button>
                  {uploadResults.length > 0 && (
                    <Button 
                      variant="secondary"
                      onClick={() => {
                        setCurrentStep(WorkflowStep.Results);
                        setCompletedSteps([WorkflowStep.Authentication, WorkflowStep.FileUpload, WorkflowStep.ColumnMapping, WorkflowStep.ValidationCorrection, WorkflowStep.FinalPreview, WorkflowStep.BulkUpload]);
                      }}
                    >
                      Go to Results Verification
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Privacy Notice Footer */}
              <div className="mt-12 pt-8">
        <div className="text-center">
          <p className="text-sm text-gray-800 mb-2">
            Your employee data is processed entirely on your device and sent directly to Planday - we never store, access, or process your data on our servers. <button
            onClick={() => setIsPrivacyModalOpen(true)}
            className="text-sm text-blue-600 hover:text-blue-800 underline"
          >
            Read more
          </button>.
          </p>
          
          {/* Version Display */}
          <div className="mt-4">
            <div className="text-sm text-gray-600">
              <button
                onClick={() => setIsVersionModalOpen(true)}
                className="hover:text-gray-800 transition-colors underline"
              >
                Version {getCurrentVersion()}
              </button>
              <span className="mx-2">-</span>
              <button
                onClick={() => setIsCookieModalOpen(true)}
                className="hover:text-gray-800 transition-colors underline"
              >
                Cookie Policy
              </button>
              <span className="mx-2">-</span>
              <button
                onClick={() => setIsTermsModalOpen(true)}
                className="hover:text-gray-800 transition-colors underline"
              >
                Terms of Service
              </button>
              <span className="mx-2">-</span>
              <span>Made with <span className="heartbeat">❤️</span> by the </span>
              <a 
                href="https://www.planday.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="hover:text-gray-800 transition-colors underline"
              >
                Planday
              </a>
              <span> Community</span>
            </div>
          </div>
        </div>
      </div>

      {/* Privacy Modal */}
      <PrivacyModal
        isOpen={isPrivacyModalOpen}
        onClose={() => setIsPrivacyModalOpen(false)}
      />

      {/* Cookie Modal */}
      <CookieModal
        isOpen={isCookieModalOpen}
        onClose={() => setIsCookieModalOpen(false)}
      />

      {/* Terms of Service Modal */}
      <TermsOfServiceModal
        isOpen={isTermsModalOpen}
        onClose={() => setIsTermsModalOpen(false)}
      />

      {/* Version Modal */}
      <VersionModal
        isOpen={isVersionModalOpen}
        onClose={() => setIsVersionModalOpen(false)}
      />

      {/* Start-over confirmation - guards the destructive reset */}
      <ConfirmDialog
        isOpen={isStartOverConfirmOpen}
        title="Start over?"
        message={
          <>
            This clears all uploaded data, mappings, and corrections, and logs you out
            of Planday. You'll have to authenticate and re-upload from scratch.
            This can't be undone.
          </>
        }
        confirmLabel="Yes, start over"
        cancelLabel="Keep my progress"
        confirmVariant="error"
        onConfirm={() => {
          setIsStartOverConfirmOpen(false);
          handleCancelUpload();
        }}
        onCancel={() => setIsStartOverConfirmOpen(false)}
      />
    </>
  );
} 