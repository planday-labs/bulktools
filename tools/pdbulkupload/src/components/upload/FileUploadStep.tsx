/**
 * File Upload Step Component
 * Handles Excel file upload with drag & drop functionality
 * Features:
 * - Drag & drop file upload
 * - File validation and error handling
 * - Progress tracking during parsing
 * - Data preview with sample rows
 * - Auto-mapping preview
 * - File format validation
 * - Ambiguous date format detection with user confirmation modal
 */

import React, { useState, useRef, useCallback } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { TemplateOptionsModal } from '../ui/TemplateOptionsModal';
// DateFormatModal will be used in mapping/validation steps

// import { FieldDefinitionsDebugButton } from '../ui/FieldDefinitionsModal'; // Commented out for production
import { ExcelUtils, type ExcelParseResult } from '../../services/excelParser';
import { ValidationService, MappingService } from '../../services/mappingService';
import type { 
  StepComponentProps, 
  ParsedExcelData, 
  ExcelColumnMapping,
  ValidationError 
} from '../../types/planday';

interface FileUploadStepProps extends StepComponentProps {
  onFileProcessed?: (data: ParsedExcelData, mappings: ExcelColumnMapping[]) => void;
  // Authentication success props
  isAuthenticated?: boolean;
  departmentCount?: number;
  employeeGroupCount?: number;
  companyName?: string;
}

export const FileUploadStep: React.FC<FileUploadStepProps> = ({
  onNext,
  onFileProcessed,
  isLoading = false,
  isAuthenticated = false,
  departmentCount = 0,
  employeeGroupCount = 0,
  companyName,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ExcelParseResult | null>(null);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);

  // Date format modal will be handled in mapping/validation steps

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Date format checking will be handled during mapping/validation, not during initial parsing

  /**
   * Handle file selection (both drag & drop and click)
   */
  const handleFileSelect = useCallback(async (file: File) => {
    setUploadError(null);
    setParseResult(null);
    setValidationErrors([]);
    setProgress(0);

    // Validate file format first
    if (!ExcelUtils.isValidExcelFile(file)) {
      setUploadError('Please upload a valid Excel file (.xlsx). Legacy .xls files are not supported - please convert to .xlsx first.');
      return;
    }

    setIsProcessing(true);

    try {
      console.log(`📁 Processing file: ${file.name} (${ExcelUtils.formatFileSize(file.size)})`);

      // Parse the Excel file with ALL available fields for name-agnostic auto-mapping
      const result = await ExcelUtils.parseFile(file, {
        onProgress: (progressValue) => {
          setProgress(progressValue);
        },
        customFields: ValidationService.getCustomFields(), // Legacy compatibility
        allFields: ValidationService.getAllAvailableFields().map(field => ({
          name: field.field,
          displayName: field.displayName,
          isCustom: field.isCustom
        })), // NEW: All API fields for exact name matching
      });

      if (result.success && result.data && result.columnMappings) {
        // No date format checking here - that happens later during mapping/validation
        setParseResult(result);
        
        // Validate the parsed data
        const errors = ExcelUtils.validateData(result.data);
        setValidationErrors(errors);

        // Notify parent component
        if (onFileProcessed) {
          onFileProcessed(result.data, result.columnMappings);
        }

        // File processing completed successfully
      } else {
        setUploadError(result.error || 'Failed to process the Excel file');
      }

    } catch (error) {
      console.error('❌ File processing failed:', error);
      setUploadError(
        error instanceof Error 
          ? error.message 
          : 'An unexpected error occurred while processing the file'
      );
    } finally {
      setIsProcessing(false);
      setProgress(0);
    }
  }, [onFileProcessed]);

  /**
   * Handle drag events
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  /**
   * Handle file input change
   */
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  /**
   * Reset file upload
   */
  const handleReset = useCallback(() => {
    setParseResult(null);
    setUploadError(null);
    setValidationErrors([]);
    setProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  /**
   * Handle template download button click - opens modal
   */
  const handleDownloadTemplate = useCallback(() => {
    // Check if field definitions are loaded
    const status = ValidationService.getStatus();

    if (!status.isLoaded) {
      setUploadError('Portal field definitions not loaded yet. Please wait a moment and try again.');
      return;
    }

    // Open the template options modal
    setIsTemplateModalOpen(true);
  }, []);

  /**
   * Handle actual template download with options
   */
  const handleDownloadWithOptions = useCallback((options: { includeSupervisorColumns: boolean; includeFixedSalaryColumns: boolean }) => {
    try {
      console.log('📋 Starting template download...', options);

      // Generate template data using portal configuration
      const templateData = MappingService.generatePortalTemplate(options);

      console.log('📊 Template data generated:', {
        headerCount: templateData.headers.length,
        fieldOrderCount: templateData.fieldOrder.length,
        customFieldsIncluded: templateData.fieldOrder.filter(f => f.isCustom).length,
        requiredFieldsIncluded: templateData.fieldOrder.filter(f => f.isRequired).length,
        ...options
      });

      // Download the Excel file
      ExcelUtils.downloadTemplate(templateData);

      console.log('✅ Template download initiated');
    } catch (error) {
      console.error('❌ Template download failed:', error);
      setUploadError('Failed to download template. Please try again.');
    }
  }, []);

  /**
   * Render file upload area
   */
  const renderUploadArea = () => (
    <Card
      className={`relative border-2 border-dashed transition-colors cursor-pointer h-full flex flex-col justify-center ${
        isDragOver
          ? 'border-blue-400 bg-blue-50'
          : 'border-gray-300 hover:border-gray-400'
      }`}
      onClick={() => fileInputRef.current?.click()}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="text-center p-6">
        <div className="mb-4">
          {isProcessing ? (
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
          )}
        </div>
        
        <div className="space-y-2">
          {isProcessing ? (
            <>
              <p className="text-lg font-medium text-gray-900">
                Processing Excel file...
              </p>
              <div className="w-full bg-gray-200 rounded-full h-2 max-w-xs mx-auto">
                <div 
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <p className="text-sm text-gray-500">
                {progress}% complete
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-medium text-gray-900">
                Load your Excel file
              </p>
              <p className="text-gray-500">
                Drag and drop your file here, or click to browse
              </p>
              <p className="text-sm text-gray-400">
                Supports .xlsx files up to 10MB • Processed locally on your device
              </p>
            </>
          )}
        </div>
      </div>
      
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        onChange={handleFileInputChange}
        className="hidden"
        disabled={isProcessing}
      />
    </Card>
  );

  /**
   * Render parsing results
   */
  const renderResults = () => {
    if (!parseResult?.data) return null;

    const { data, columnMappings } = parseResult;
    const sampleData = ExcelUtils.getSample(data, 3);
    const mappedCount = columnMappings?.filter(m => m.isMapped).length || 0;

    return (
      <div className="space-y-6">
        {/* File Info */}
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                📁 {data.fileName}
              </h3>
              <p className="text-sm text-gray-600">
                {data.totalRows} rows • {data.headers.length} columns • {ExcelUtils.formatFileSize(data.fileSize)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleReset}>
              Load Different File
            </Button>
          </div>
        </Card>

        {/* Validation Errors/Warnings */}
        {validationErrors.length > 0 && (
          <Card>
            <h4 className="text-lg font-semibold text-gray-900 mb-4">
              ⚠️ Data Issues Found
            </h4>
            <div className="space-y-2">
              {validationErrors.map((error, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-md border ${
                    error.severity === 'error'
                      ? 'bg-red-50 border-red-200 text-red-800'
                      : 'bg-yellow-50 border-yellow-200 text-yellow-800'
                  }`}
                >
                  <div className="flex">
                    <div className="flex-shrink-0">
                      {error.severity === 'error' ? (
                        <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <div className="ml-3">
                      <p className="text-sm font-medium">
                        {error.message}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Auto-mapping Results */}
        <Card>
          <h4 className="text-lg font-semibold text-gray-900 mb-4">
            🎯 Auto-mapping Results
          </h4>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-600">
              Automatically mapped {mappedCount} out of {data.headers.length} columns
            </p>
            <div className="flex items-center">
              <div className="w-32 bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-green-600 h-2 rounded-full"
                  style={{ width: `${(mappedCount / data.headers.length) * 100}%` }}
                ></div>
              </div>
              <span className="ml-2 text-sm text-gray-500">
                {Math.round((mappedCount / data.headers.length) * 100)}%
              </span>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {columnMappings?.slice(0, 8).map((mapping, index) => (
              <div
                key={index}
                className={`flex items-center justify-between p-3 rounded-md border ${
                  mapping.isMapped
                    ? 'bg-green-50 border-green-200'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">
                    {mapping.excelColumn}
                  </p>
                  <p className="text-xs text-gray-500 font-mono">
                    {mapping.isMapped ? `→ ${
                      // Use same logic as other components: raw names for standard fields, descriptions for custom fields
                      (mapping.plandayField && typeof mapping.plandayField === 'string' && mapping.plandayField.startsWith('custom_'))
                        ? (mapping.plandayFieldDisplayName || mapping.plandayField)
                        : mapping.plandayField
                    }` : 'Not mapped'}
                  </p>
                </div>
                <div className="flex-shrink-0">
                  {mapping.isMapped ? (
                    <svg className="h-5 w-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="h-5 w-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          {(columnMappings?.length || 0) > 8 && (
            <p className="text-sm text-gray-500 mt-4">
              And {(columnMappings?.length || 0) - 8} more columns...
            </p>
          )}
        </Card>

        {/* Discarded Empty Columns */}
        {data.discardedColumns && data.discardedColumns.length > 0 && (
          <Card>
            <h4 className="text-lg font-semibold text-gray-900 mb-4">
              🗑️ Empty Columns Discarded
            </h4>
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-blue-500 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-sm text-gray-700 mb-3">
                  The following Excel columns contained headers but no actual data, so they were automatically excluded from the mapping process:
                </p>
                <div className="bg-gray-50 border border-gray-200 rounded-md p-3">
                  <div className="flex flex-wrap gap-2">
                    {data.discardedColumns.map((column, index) => (
                      <span 
                        key={index}
                        className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-700 border border-gray-300"
                      >
                        {column}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-3">
                  ✨ <strong>Smart filtering:</strong> This helps keep your mapping interface clean by only showing columns with actual data.
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Data Preview */}
        <Card>
          <h4 className="text-lg font-semibold text-gray-900 mb-4">
            👀 Data Preview (First 3 Rows)
          </h4>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {data.headers.map((header, index) => (
                    <th
                      key={index}
                      className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sampleData.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="px-4 py-3 text-sm text-gray-900 max-w-xs truncate"
                        title={cell?.toString() || ''}
                      >
                        {cell?.toString() || '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">
          Load Employee Data
        </h2>
        <p className="text-gray-600">
          Load an Excel file for local processing on your device
        </p>
      </div>

      {/* Authentication Success Message */}
      {isAuthenticated && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-md">
          <div className="flex items-start justify-between">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <p className="text-sm text-green-800">
                  Connected to Planday portal {companyName ? `${companyName} ` : ''}successfully!
                  <span className="block mt-1">
                    Found {departmentCount} departments and {employeeGroupCount} employee groups
                  </span>
                </p>
              </div>
            </div>
            
            {/* Debug Button - Commented out for production but kept for future debugging */}
            {/*
            <div className="flex-shrink-0 ml-4">
              <FieldDefinitionsDebugButton className="whitespace-nowrap" />
            </div>
            */}
          </div>
        </div>
      )}

      {/* Upload Area or Results */}
      {!parseResult?.data ? (
        <>
          {/* Upload and Template Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Upload Area - Left side (2/3 width) */}
            <div className="lg:col-span-2">
              {renderUploadArea()}
            </div>
            
            {/* Download Template - Right side (1/3 width) */}
            <div className="lg:col-span-1">
              <Card className="h-full flex flex-col justify-center">
                <div className="text-center p-6">
                  <div className="mb-4">
                    <div className="mx-auto w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                      <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Download Excel Template
                  </h3>
                  <p className="text-sm text-gray-600 mb-4">
                    Get a pre-formatted Excel template with your portal's fields and requirements
                  </p>
                  <Button
                    onClick={handleDownloadTemplate}
                    disabled={isProcessing || !isAuthenticated}
                    variant="secondary"
                    className="w-full"
                  >
                    Download
                  </Button>
                  {!isAuthenticated && (
                    <p className="text-xs text-gray-500 mt-2">
                      Template will be available after authentication
                    </p>
                  )}
                </div>
              </Card>
            </div>
          </div>
          
          {/* Error Display */}
          {uploadError && (
            <Card>
              <div className="flex items-center p-4 bg-red-50 border border-red-200 rounded-md">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-red-800">{uploadError}</p>
                </div>
              </div>
            </Card>
          )}
        </>
      ) : (
        renderResults()
      )}

      {/* Action Buttons (step-back lives in the top navigation bar) */}
      <div className="flex justify-end">
        <Button
          onClick={onNext}
          disabled={isLoading || isProcessing || !parseResult?.data}
        >
          Continue to Column Mapping →
        </Button>
      </div>

      {/* Instructions */}
      <Card variant="outline">
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-gray-900">
            📋 Excel File Requirements:
          </h3>
          <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
            <li>First row should contain column headers</li>
            <li>Each row represents one employee</li>
            <li>Include columns for: First Name, Last Name, Email, Department</li>
            <li>Dates should be in recognizable format (YYYY-MM-DD, MM/DD/YYYY, etc.)</li>
            <li>File size limit: 10MB</li>
            <li>Maximum 1,000 employees per file</li>
          </ul>
        </div>
      </Card>

      {/* Date Format Modal will be added to mapping/validation steps */}

      {/* Template Options Modal */}
      <TemplateOptionsModal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        onDownload={handleDownloadWithOptions}
      />
    </div>
  );
};