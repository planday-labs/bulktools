import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { usePlandayApi } from '../../hooks/usePlandayApi';
import type {
  EmployeeUploadResult,
  PlandayEmployeeResponse,
  PlandayEmployeeCreateRequest,
  ExcludedEmployee
} from '../../types/planday';
import { ExcelParser } from '../../services/excelParser';

// Import post-creation results type
interface PostCreationResults {
  supervisorResults?: Array<{ employeeId: number; supervisorName: string; success: boolean; error?: string }>;
  salaryResults?: Array<{ employeeId: number; success: boolean; error?: string }>;
  contractRuleResults?: Array<{ employeeId: number; success: boolean; error?: string }>;
}

interface ResultsVerificationStepProps {
  uploadResults: EmployeeUploadResult[];
  originalEmployees: PlandayEmployeeCreateRequest[];
  postCreationResults?: PostCreationResults;
  excludedEmployees?: ExcludedEmployee[];
  onComplete: () => void;
  onReset?: () => void; // New prop for resetting the entire process
  onBackToEditTable?: () => void; // Return to the edit table, stripping already-created rows
  className?: string;
}

interface VerificationResult {
  employee: PlandayEmployeeCreateRequest;
  uploadResult: EmployeeUploadResult;
  apiEmployee?: PlandayEmployeeResponse;
  verified: boolean;
  issues: string[];
}

interface VerificationSummary {
  totalUploaded: number;
  totalVerified: number;
  totalMissing: number;
  totalWithIssues: number;
  accuracy: number;
}

/**
 * Results Verification Step Component
 * 
 * This step provides comprehensive verification of uploaded employees:
 * - Fetches actual employees from Planday API
 * - Compares uploaded data with API data
 * - Shows paginated results with 100% accuracy verification
 * - Provides detailed summary and individual employee verification
 */
const ResultsVerificationStep: React.FC<ResultsVerificationStepProps> = ({
  uploadResults,
  originalEmployees,
  postCreationResults,
  excludedEmployees = [],
  onComplete,
  onReset,
  onBackToEditTable,
  className = ''
}) => {
  const plandayApi = usePlandayApi();

  const [verificationResults, setVerificationResults] = useState<VerificationResult[]>([]);
  const [summary, setSummary] = useState<VerificationSummary | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [verificationComplete, setVerificationComplete] = useState(false);
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);
  
  // Pagination settings
  const ITEMS_PER_PAGE = 100;
  const totalPages = Math.ceil(verificationResults.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentResults = verificationResults.slice(startIndex, endIndex);

  /**
   * Compare uploaded employee data with API data
   */
  const compareEmployeeData = (
    original: PlandayEmployeeCreateRequest,
    apiEmployee: PlandayEmployeeResponse
  ): { matches: boolean; issues: string[] } => {
    const issues: string[] = [];
    
    // Check basic fields
    if (original.firstName !== apiEmployee.firstName) {
      issues.push(`First name mismatch: "${original.firstName}" vs "${apiEmployee.firstName}"`);
    }
    
    if (original.lastName !== apiEmployee.lastName) {
      issues.push(`Last name mismatch: "${original.lastName}" vs "${apiEmployee.lastName}"`);
    }
    
    if (original.userName !== apiEmployee.userName) {
      issues.push(`Username mismatch: "${original.userName}" vs "${apiEmployee.userName}"`);
    }
    
    // Check optional fields
    if (original.cellPhone && original.cellPhone !== apiEmployee.cellPhone) {
      issues.push(`Cell phone mismatch: "${original.cellPhone}" vs "${apiEmployee.cellPhone}"`);
    }
    
    if (original.email && original.email !== apiEmployee.email) {
      issues.push(`Email mismatch: "${original.email}" vs "${apiEmployee.email}"`);
    }
    
    // Check departments - compare IDs
    const originalDeptIds = original.departments?.sort() || [];
    // Handle both array of numbers and array of objects with id property
    const apiDeptIds = apiEmployee.departments?.map(d => 
      typeof d === 'number' ? d : d.id
    ).sort() || [];
    
    console.log(`🔍 Department comparison for ${original.firstName} ${original.lastName}:`, {
      original: originalDeptIds,
      api: apiDeptIds,
      apiDepartmentsRaw: apiEmployee.departments
    });
    
    if (JSON.stringify(originalDeptIds) !== JSON.stringify(apiDeptIds)) {
      issues.push(`Department mismatch: [${originalDeptIds.join(', ')}] vs [${apiDeptIds.join(', ')}]`);
    }
    
    return {
      matches: issues.length === 0,
      issues
    };
  };

  /**
   * Start verification process
   */
  const startVerification = async () => {
    setIsVerifying(true);
    setVerificationError(null);
    
    try {
      // Get successful upload results with Planday IDs
      const successfulUploads = uploadResults.filter(result => result.success && result.plandayId);
      const employeeIds = successfulUploads.map(result => result.plandayId!);
      
      console.log(`🔍 Starting verification for ${employeeIds.length} employees...`);
      
      // Force re-authentication with stored token (don't trust state)
      console.log('🔐 Force re-authenticating for verification...');
      
      const storedRefreshToken = sessionStorage.getItem('planday_refresh_token');
      
      console.log('🔍 Debug token info:', {
        hasStoredToken: !!storedRefreshToken,
        tokenLength: storedRefreshToken?.length || 0,
        tokenPreview: storedRefreshToken ? storedRefreshToken.substring(0, 20) + '...' : 'none'
      });
      
      if (!storedRefreshToken) {
        console.log('❌ No stored refresh token found');
        throw new Error('No authentication token found. Please go back and re-authenticate.');
      }
      
      console.log('🔄 Re-authenticating with stored token...');
      
      const authSuccess = await plandayApi.authenticate(storedRefreshToken);
      
      if (!authSuccess) {
        console.log('❌ Re-authentication failed');
        throw new Error('Authentication failed. The stored token may be expired. Please go back and re-authenticate.');
      }
      
      console.log('✅ Re-authentication successful!');
      
      // Small delay to ensure hook state is fully updated
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Phase 2: Fetch employees from Planday API
      console.log(`📡 Fetching ${employeeIds.length} employees from Planday API for verification...`);
      console.log('🔍 Final auth check before fetch:', {
        hookAuthenticated: plandayApi.isAuthenticated
      });
      
      const apiEmployees = await plandayApi.fetchEmployeesByIds(employeeIds);
      console.log(`✅ Successfully fetched ${apiEmployees.length} employees from API`);
      
      // Debug: Log the employee IDs and API response
      console.log('🔍 Employee IDs to verify:', employeeIds);
      console.log('🔍 API employees fetched:', apiEmployees.map(emp => ({
        id: emp.id,
        idType: typeof emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        userName: emp.userName,
        email: emp.email,
        fullEmployee: emp
      })));
      console.log('🔍 Upload results to match:', uploadResults.map(ur => ({
        success: ur.success,
        plandayId: ur.plandayId,
        employeeName: `${ur.employee.firstName} ${ur.employee.lastName}`,
        employeeUserName: ur.employee.userName
      })));
      console.log('🔍 Original employees:', originalEmployees.map(oe => ({
        name: `${oe.firstName} ${oe.lastName}`,
        userName: oe.userName,
        email: oe.email
      })));
      
      // Create verification results
      const results: VerificationResult[] = [];
      
      console.log('🔍 Starting employee verification loop...');
      
      for (const uploadResult of uploadResults) {
        console.log(`🔍 Processing upload result:`, {
          employeeName: `${uploadResult.employee.firstName} ${uploadResult.employee.lastName}`,
          success: uploadResult.success,
          plandayId: uploadResult.plandayId,
          error: uploadResult.error
        });
        
        const originalEmployee = originalEmployees.find(emp => 
          emp.userName === uploadResult.employee.userName
        );
        
        if (!originalEmployee) {
          console.warn(`⚠️ Could not find original employee for ${uploadResult.employee.firstName} ${uploadResult.employee.lastName} (${uploadResult.employee.userName})`);
          continue;
        }
        
        console.log(`🔍 Found original employee:`, {
          name: `${originalEmployee.firstName} ${originalEmployee.lastName}`,
          userName: originalEmployee.userName,
          email: originalEmployee.email
        });
        
        if (uploadResult.success && uploadResult.plandayId) {
          // Find corresponding API employee
          const apiEmployee = apiEmployees.find(emp => emp.id === uploadResult.plandayId);
          
          console.log(`🔍 Matching employee ${originalEmployee.firstName} ${originalEmployee.lastName}:`, {
            uploadResultId: uploadResult.plandayId,
            uploadResultIdType: typeof uploadResult.plandayId,
            apiEmployeeIds: apiEmployees.map(emp => ({ id: emp.id, type: typeof emp.id })),
            found: !!apiEmployee,
            apiEmployee: apiEmployee ? {
              id: apiEmployee.id,
              name: `${apiEmployee.firstName} ${apiEmployee.lastName}`,
              userName: apiEmployee.userName,
              email: apiEmployee.email
            } : null
          });
          
          if (apiEmployee) {
            // Compare data
            const comparison = compareEmployeeData(originalEmployee, apiEmployee);
            
            console.log(`🔍 Comparison result for ${originalEmployee.firstName} ${originalEmployee.lastName}:`, {
              matches: comparison.matches,
              issues: comparison.issues
            });
            
            results.push({
              employee: originalEmployee,
              uploadResult,
              apiEmployee,
              verified: comparison.matches,
              issues: comparison.issues
            });
          } else {
            // Employee not found in API - this is a problem
            console.warn(`❌ Employee not found in API: ${originalEmployee.firstName} ${originalEmployee.lastName} (ID: ${uploadResult.plandayId})`);
            results.push({
              employee: originalEmployee,
              uploadResult,
              verified: false,
              issues: [`Employee not found in Planday API despite successful upload (ID: ${uploadResult.plandayId})`]
            });
          }
        } else {
          // Failed upload - FIXED: Added missing 'else' to prevent duplicate processing
          console.log(`❌ Processing failed upload: ${originalEmployee.firstName} ${originalEmployee.lastName} - ${uploadResult.error}`);
          results.push({
            employee: originalEmployee,
            uploadResult,
            verified: false,
            issues: [`Upload failed: ${uploadResult.error || 'Unknown error'}`]
          });
        }
      }
      
      console.log('🔍 Final verification results:', results.map(r => ({
        name: `${r.employee.firstName} ${r.employee.lastName}`,
        verified: r.verified,
        hasApiEmployee: !!r.apiEmployee,
        issues: r.issues,
        plandayId: r.uploadResult.plandayId
      })));
      
      setVerificationResults(results);
      
      // Calculate summary
      const totalUploaded = uploadResults.filter(r => r.success).length;
      const totalVerified = results.filter(r => r.verified).length;
      const totalMissing = results.filter(r => r.uploadResult.success && !r.apiEmployee).length;
      const totalWithIssues = results.filter(r => !r.verified).length;
      const accuracy = results.length > 0 ? (totalVerified / results.length) * 100 : 0;
      
      setSummary({
        totalUploaded,
        totalVerified,
        totalMissing,
        totalWithIssues,
        accuracy
      });
      
      setVerificationComplete(true);
      
      console.log(`📊 Verification complete:`, {
        totalUploaded,
        totalVerified,
        totalMissing,
        totalWithIssues,
        accuracy: `${accuracy.toFixed(1)}%`
      });
      
    } catch (error) {
      console.error('❌ Verification failed:', error);
      setVerificationError(error instanceof Error ? error.message : 'Verification failed');
    } finally {
      setIsVerifying(false);
    }
  };

  // Auto-start verification when component mounts
  useEffect(() => {
    if (uploadResults.length > 0 && !verificationComplete) {
      // Add a delay to allow the hook's authentication restoration to complete
      const timeoutId = setTimeout(() => {
        console.log('🔍 Starting verification with auth state:', {
          isAuthenticated: plandayApi.isAuthenticated,
          uploadResultsCount: uploadResults.length,
          verificationComplete
        });
        startVerification();
      }, 300); // Give more time for auth restoration
      
      return () => clearTimeout(timeoutId);
    }
  }, [uploadResults.length, verificationComplete, plandayApi.isAuthenticated]);

  const renderSummaryCard = () => {
    if (!summary) return null;
    
    const accuracyColor = summary.accuracy === 100 ? 'text-green-600' : 
                         summary.accuracy >= 95 ? 'text-yellow-600' : 'text-red-600';
    
    return (
      <Card className="mb-6">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            🎯 Verification Summary
          </h3>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{summary.totalUploaded}</div>
              <div className="text-sm text-gray-600">Uploaded</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{summary.totalVerified}</div>
              <div className="text-sm text-gray-600">Verified</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{summary.totalWithIssues}</div>
              <div className="text-sm text-gray-600">With Issues</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-bold ${accuracyColor}`}>
                {summary.accuracy.toFixed(1)}%
              </div>
              <div className="text-sm text-gray-600">Accuracy</div>
            </div>
          </div>
          
          {summary.accuracy === 100 ? (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-center space-x-2">
                <span className="text-green-600">✅</span>
                <span className="font-medium text-green-800">Perfect Match!</span>
              </div>
              <p className="text-green-700 mt-1">
                All employees were uploaded and verified successfully. 100% accuracy achieved!
              </p>
            </div>
          ) : (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-center space-x-2">
                <span className="text-yellow-600">⚠️</span>
                <span className="font-medium text-yellow-800">Issues Found</span>
              </div>
              <p className="text-yellow-700 mt-1">
                {summary.totalWithIssues} employees have verification issues. 
                Please review the details below.
              </p>
            </div>
          )}
        </div>
      </Card>
    );
  };

  // Render post-creation operation failures (supervisors, salaries, etc.)
  const renderPostCreationFailures = () => {
    const supervisorFailures = postCreationResults?.supervisorResults?.filter(r => !r.success) || [];
    const salaryFailures = postCreationResults?.salaryResults?.filter(r => !r.success) || [];
    const contractRuleFailures = postCreationResults?.contractRuleResults?.filter(r => !r.success) || [];

    const totalFailures = supervisorFailures.length + salaryFailures.length + contractRuleFailures.length;

    if (totalFailures === 0) return null;

    return (
      <Card className="mb-6">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            ⚠️ Post-Creation Operation Failures
          </h3>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
            <p className="text-amber-800">
              The following operations failed after employee creation. Employees were created successfully,
              but these additional assignments need to be done manually in Planday.
            </p>
          </div>

          {/* Supervisor Failures */}
          {supervisorFailures.length > 0 && (
            <div className="mb-4">
              <h4 className="font-medium text-gray-800 mb-2">
                👤 Supervisor Assignments ({supervisorFailures.length} failed)
              </h4>
              <div className="space-y-2">
                {supervisorFailures.map((failure, index) => (
                  <div key={index} className="bg-red-50 border border-red-200 rounded p-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-medium text-red-800">Employee ID: {failure.employeeId}</span>
                        <span className="text-red-700 mx-2">→</span>
                        <span className="text-red-700">Supervisor: {failure.supervisorName}</span>
                      </div>
                    </div>
                    {failure.error && (
                      <p className="text-red-600 text-sm mt-1">{failure.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Salary Failures */}
          {salaryFailures.length > 0 && (
            <div className="mb-4">
              <h4 className="font-medium text-gray-800 mb-2">
                💰 Salary Assignments ({salaryFailures.length} failed)
              </h4>
              <div className="space-y-2">
                {salaryFailures.map((failure, index) => (
                  <div key={index} className="bg-red-50 border border-red-200 rounded p-3">
                    <span className="font-medium text-red-800">Employee ID: {failure.employeeId}</span>
                    {failure.error && (
                      <p className="text-red-600 text-sm mt-1">{failure.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contract Rule Failures */}
          {contractRuleFailures.length > 0 && (
            <div className="mb-4">
              <h4 className="font-medium text-gray-800 mb-2">
                📋 Contract Rule Assignments ({contractRuleFailures.length} failed)
              </h4>
              <div className="space-y-2">
                {contractRuleFailures.map((failure, index) => (
                  <div key={index} className="bg-red-50 border border-red-200 rounded p-3">
                    <span className="font-medium text-red-800">Employee ID: {failure.employeeId}</span>
                    {failure.error && (
                      <p className="text-red-600 text-sm mt-1">{failure.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>
    );
  };

  const renderEmployeeRow = (result: VerificationResult, index: number) => {
    const globalIndex = startIndex + index + 1;
    // const statusColor = result.verified ? 'text-green-600' : 'text-red-600';
    const statusIcon = result.verified ? '✅' : '❌';
    
    return (
      <div key={globalIndex} className="flex items-center py-3 px-4 border-b border-gray-200 last:border-b-0 hover:bg-gray-50">
        {/* Row Number */}
        <span className="text-sm font-medium text-gray-500 w-8 flex-shrink-0">#{globalIndex}</span>
        
        {/* Name */}
        <div className="w-48 flex-shrink-0">
          <div className="font-medium text-gray-900 truncate">
            {result.employee.firstName} {result.employee.lastName}
          </div>
        </div>
        
        {/* Email */}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-900 truncate">
            <div>Uploaded: {result.employee.userName}</div>
            {result.apiEmployee && (
              <div className="text-gray-500">
                Planday: {result.apiEmployee.userName}
                {result.apiEmployee.email && result.apiEmployee.email !== result.apiEmployee.userName && (
                  <span className="ml-1">({result.apiEmployee.email})</span>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Planday ID */}
        <div className="w-24 flex-shrink-0 text-center">
          {result.uploadResult.plandayId ? (
            <span className="text-sm text-gray-900">{result.uploadResult.plandayId}</span>
          ) : (
            <span className="text-sm text-gray-400">-</span>
          )}
        </div>
        
        {/* Status */}
        <div className="w-28 flex-shrink-0 text-center">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
            result.verified 
              ? 'bg-green-100 text-green-800' 
              : 'bg-red-100 text-red-800'
          }`}>
            {statusIcon} {result.verified ? 'Verified' : 'Issues'}
          </span>
        </div>
        
        {/* Issues (if any) */}
        <div className="w-12 flex-shrink-0 text-center">
          {result.issues.length > 0 && (
            <button 
              className="text-red-500 hover:text-red-700"
              title={result.issues.join(', ')}
            >
              ⚠️
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderPagination = () => {
    if (totalPages <= 1) return null;
    
    return (
      <div className="flex justify-between items-center mt-6">
        <div className="text-sm text-gray-600">
          Showing {startIndex + 1}-{Math.min(endIndex, verificationResults.length)} of {verificationResults.length} employees
        </div>
        
        <div className="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
          >
            Previous
          </Button>
          
          <span className="flex items-center px-3 py-1 text-sm text-gray-600">
            Page {currentPage} of {totalPages}
          </span>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
          >
            Next
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          📋 Results Verification
        </h2>
        <p className="text-gray-600">
          Verifying uploaded employees against Planday API to ensure 100% accuracy
        </p>
      </div>

      {/* Summary Card */}
      {renderSummaryCard()}

      {/* Post-Creation Operation Failures (supervisors, salaries, etc.) */}
      {renderPostCreationFailures()}

      {/* Excluded Employees Section */}
      {excludedEmployees.length > 0 && (
        <Card>
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Excluded from Upload
              </h3>
              <div className="flex space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const text = excludedEmployees.map(exc => {
                      const errorList = exc.errors
                        .filter(e => e.severity === 'error')
                        .map(e => `  - ${e.field}: ${e.message}`)
                        .join('\n');
                      return `Row ${exc.rowIndex + 1}: ${exc.employee.firstName || ''} ${exc.employee.lastName || ''} (${exc.employee.userName || 'no email'})\n${errorList}`;
                    }).join('\n\n');
                    navigator.clipboard.writeText(text);
                    setCopiedToClipboard(true);
                    setTimeout(() => setCopiedToClipboard(false), 2000);
                  }}
                >
                  {copiedToClipboard ? 'Copied!' : 'Copy to Clipboard'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    ExcelParser.exportFailedEmployees(
                      excludedEmployees,
                      `excluded_employees_${new Date().toISOString().split('T')[0]}.xlsx`
                    );
                  }}
                >
                  Download Excel
                </Button>
              </div>
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4">
              <div className="flex items-center space-x-2">
                <span className="text-orange-600 text-lg">⚠️</span>
                <span className="font-medium text-orange-800">
                  {excludedEmployees.length} employee(s) were excluded due to validation errors
                </span>
              </div>
              <p className="text-orange-700 mt-1 text-sm">
                These employees were not uploaded to Planday. Review the errors below and re-upload them separately.
              </p>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto">
              {excludedEmployees.map((exc, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  <div className="font-medium text-gray-900 mb-2">
                    Row {exc.rowIndex + 1}: {exc.employee.firstName || ''} {exc.employee.lastName || ''}
                    <span className="text-gray-500 ml-2 font-normal">({exc.employee.userName || 'no email'})</span>
                  </div>
                  <div className="space-y-1">
                    {exc.errors
                      .filter(error => error.severity === 'error')
                      .map((error, errIndex) => (
                        <div key={errIndex} className="text-sm bg-red-50 text-red-800 px-3 py-1.5 rounded">
                          <strong>{error.field}:</strong> {error.message}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Verification Status */}
      {isVerifying && (
        <Card>
          <div className="p-6 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">
              Re-authenticating and verifying employees with Planday API...
            </p>
          </div>
        </Card>
      )}

      {/* Error State */}
      {verificationError && (
        <Card>
          <div className="p-6">
            <div className="flex items-center space-x-2 text-red-600 mb-2">
              <span>❌</span>
              <span className="font-medium">Verification Failed</span>
            </div>
            <p className="text-red-700 mb-4">{verificationError}</p>
            <Button onClick={startVerification} disabled={isVerifying}>
              Retry Verification
            </Button>
          </div>
        </Card>
      )}

      {/* Results List */}
      {verificationResults.length > 0 && (
        <Card>
          <div className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Employee Verification Details
            </h3>
            
            {/* Header Row */}
            <div className="flex items-center py-2 px-4 bg-gray-50 border-b border-gray-200 text-sm font-medium text-gray-700">
              <span className="w-8 flex-shrink-0">#</span>
              <span className="w-48 flex-shrink-0">Name</span>
              <span className="flex-1 min-w-0">Email</span>
              <span className="w-24 flex-shrink-0 text-center">Planday ID</span>
              <span className="w-28 flex-shrink-0 text-center">Status</span>
              <span className="w-12 flex-shrink-0 text-center">Issues</span>
            </div>
            
            <div className="space-y-0">
              {currentResults.map((result, index) => renderEmployeeRow(result, index))}
            </div>
            
            {renderPagination()}
          </div>
        </Card>
      )}

      {/* Actions (step-back lives in the top navigation bar) */}
      <div className="flex justify-end items-center pt-6">
        <div className="flex space-x-3">
          {onBackToEditTable && (
            <Button onClick={onBackToEditTable} variant="outline">
              Go back to edit table
            </Button>
          )}

          {verificationComplete && (
            <Button onClick={startVerification} variant="outline">
              Re-verify
            </Button>
          )}
          
          <Button 
            onClick={() => {
              // Complete storage cleanup - match the handleCancelUpload functionality exactly
              try {
                // sessionStorage cleanup
                sessionStorage.removeItem('planday_refresh_token');
                sessionStorage.removeItem('planday_access_token');
                sessionStorage.removeItem('planday_token_expiry');
                
                // localStorage cleanup
                localStorage.removeItem('planday_refresh_token');
                localStorage.removeItem('planday_access_token');
                localStorage.removeItem('planday_token_expiry');
                
                // Clear any other potential app state that might be cached
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
                // Don't throw - cleanup failures shouldn't break the operation
              }
              
              // Call logout to clear hook state
              plandayApi.logout();
              
              console.log('🔄 Process completed - all tokens cleared, going back to start');
              
              // Reset the entire process using onReset callback (same as "cancel upload and start over")
              if (onReset) {
                onReset();
              } else {
                // Fallback to onComplete if onReset is not available
                onComplete();
              }
            }}
            disabled={!verificationComplete}
          >
            Complete Process
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ResultsVerificationStep; 