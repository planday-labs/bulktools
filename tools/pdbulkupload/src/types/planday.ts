// Planday API Types
// Based on implementation plan and OpenAPI documentation

/**
 * Planday API Authentication Types
 */
export interface PlandayAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface TokenRefreshRequest {
  grant_type: 'refresh_token';
  refresh_token: string;
  client_id: string;
}

/**
 * Planday HR API Employee Types
 */
export interface PlandayEmployee {
  id?: number;
  firstName: string;
  lastName: string;
  userName: string; // Email format - used as login credential
  cellPhone?: string;
  street1?: string;
  zip?: string;
  city?: string;
  phone?: string;
  gender?: 'Male' | 'Female';
  email?: string;
  departments: number[]; // Array of department IDs (required)
  employeeGroups?: number[]; // Array of employee group IDs
  hiredFrom?: string; // YYYY-MM-DD format
  birthDate?: string; // YYYY-MM-DD format - requires special scope
  ssn?: string; // Social Security Number - requires special scope
  bankAccount?: {
    accountNumber?: string;
    registrationNumber?: string;
  }; // Bank account info - requires special scope
  custom_xxxx?: any; // Custom fields with custom_ prefix
}

export interface PlandayEmployeeCreateRequest {
  firstName: string;
  lastName: string;
  userName: string;
  cellPhone?: string;
  cellPhoneCountryCode?: string;  // ISO 3166-1 alpha-2 (e.g., "NO", "DK")
  cellPhoneCountryId?: number;    // Planday internal country ID
  street1?: string;
  zip?: string;
  city?: string;
  phone?: string;
  phoneCountryCode?: string;      // For landline phones
  phoneCountryId?: number;
  gender?: 'Male' | 'Female';
  email?: string;
  departments: number[];
  employeeGroups?: number[];
  skillIds?: number[];  // Array of skill IDs to assign to employee
  hiredFrom?: string;
  birthDate?: string;
  ssn?: string;
  bankAccount?: {
    accountNumber?: string;
    registrationNumber?: string;
  };
  employeeTypeId?: number;
  [key: string]: any; // For custom fields
}

/**
 * Planday Department Types
 * Based on actual API: https://openapi.planday.com/hr/v1.0/departments
 */
export interface PlandayDepartment {
  id: number;
  name: string;
  number?: string; // Department number from API
}

export interface PlandayDepartmentsResponse {
  paging: {
    offset: number;
    limit: number;
    total: number;
  };
  data: PlandayDepartment[];
}

/**
 * Planday Employee Group Types
 * Based on actual API: https://openapi.planday.com/hr/v1.0/employeegroups
 */
export interface PlandayEmployeeGroup {
  id: number;
  name: string;
}

export interface PlandayEmployeeGroupsResponse {
  paging: {
    offset: number;
    limit: number;
    total: number;
  };
  data: PlandayEmployeeGroup[];
}

/**
 * Planday Employee Type Types
 * Based on actual API: https://openapi.planday.com/hr/v1.0/employeetypes
 */
export interface PlandayEmployeeType {
  id: number;
  name: string;
  description: string;
}

export interface PlandayEmployeeTypesResponse {
  paging: {
    offset: number;
    limit: number;
    total: number;
  };
  data: PlandayEmployeeType[];
}

/**
 * Planday Supervisor Types
 * Based on actual API: https://openapi.planday.com/hr/v1.0/employees/supervisors
 */
export interface PlandaySupervisor {
  id: number;  // Supervisor Record ID (not employee ID)
  name: string;
}

export interface PlandaySupervisorsResponse {
  paging: {
    offset: number;
    limit: number;
    total: number;
  };
  data: PlandaySupervisor[];
}

/**
 * Planday Skill Types
 * Based on actual API: https://openapi.planday.com/hr/v1.0/skills
 * Skills can be assigned to employees via skillIds array
 */
export interface PlandaySkill {
  skillId: number;  // Skill ID
  name: string;
  description?: string;
  isTimeLimited?: boolean;  // If true, skill requires ValidFrom/ValidTo dates and cannot be assigned via bulk upload
}

// Skills API returns a direct array, not paginated
export type PlandaySkillsResponse = PlandaySkill[];

/**
 * Planday Salary Type
 * Based on actual API: https://openapi.planday.com/pay/v1.0/salarytypes
 */
export interface PlandaySalaryType {
  id: number;
  name: string;
}

export interface PlandaySalaryTypesResponse {
  paging: {
    offset: number;
    limit: number;
    total: number;
  };
  data: PlandaySalaryType[];
}

/**
 * Fixed Salary Assignment
 * Used for assigning fixed salary to an employee
 */
export interface FixedSalaryAssignment {
  employeeId: number;
  salaryTypeId: number;
  salaryTypeName: string;
  hours: number;
  salary: number;
  validFrom: string;
}

export interface FixedSalarySetResult {
  employeeId: number;
  salaryTypeId: number;
  salaryTypeName: string;
  hours: number;
  salary: number;
  success: boolean;
  error?: string;
}

/**
 * Planday Contract Rule Types
 * Based on actual API: https://openapi.planday.com/contractrules/v1/contractrules
 */
export interface PlandayContractRule {
  id: number;
  name: string;
}

export interface PlandayContractRulesResponse {
  paging: {
    offset: number;
    limit: number;
    total: number;
  };
  data: PlandayContractRule[];
}

/**
 * Contract Rule Assignment
 * Used for assigning contract rule to an employee inline after creation
 */
export interface ContractRuleAssignment {
  employeeId: number;
  contractRuleId: number;
  contractRuleName: string;
}

export interface ContractRuleSetResult {
  employeeId: number;
  contractRuleId: number;
  contractRuleName: string;
  success: boolean;
  error?: string;
}

/**
 * Planday API Error Types
 */
export interface PlandayApiError {
  error: string;
  error_description: string;
  statusCode: number;
  timestamp: string;
}

export interface PlandayValidationError {
  field: string;
  message: string;
  code: string;
}

export interface PlandayErrorResponse {
  message: string;
  errors?: PlandayValidationError[];
  statusCode: number;
  timestamp: string;
}

/**
 * API Response Types
 */
export interface PlandayApiResponse<T = any> {
  data: T;
  success: boolean;
  message?: string;
}

export interface PlandayEmployeeResponse {
  id: number;
  firstName: string;
  lastName: string;
  userName: string;
  email?: string;
  cellPhone?: string;
  phone?: string;
  departments: PlandayDepartment[];
  employeeGroups?: PlandayEmployeeGroup[];
  hiredFrom?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  [key: string]: any;  // Allow dynamic fields from API
}

/**
 * Result of an SSN-vs-Planday existence check.
 * `available` is false when SSN data couldn't be read (the protected SSN scope
 * appears to be missing), so callers can surface a "check skipped" notice rather
 * than treat the empty map as "no duplicates found".
 */
export interface SsnExistenceCheckResult {
  existing: Map<string, PlandayEmployeeResponse>;
  available: boolean;
}

/**
 * Employee Field Definitions Types
 * Based on Planday API: GET /hr/v1.0/employees/fielddefinitions
 */
export interface PlandayFieldDefinitionProperty {
  $ref?: string;
  description?: string;
  type?: string;
  format?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: string[];
  values?: string[];
  properties?: Record<string, PlandayFieldDefinitionProperty>; // For object types like bankAccount
  anyOf?: Array<{
    type: string;
    minLength?: number;
    maxLength?: number;
    format?: string;
    enum?: string[];
    values?: string[];
  }>;
}

export interface PlandayFieldDefinitionsSchema {
  $schema: string;
  type: string;
  required: string[];
  properties: Record<string, PlandayFieldDefinitionProperty>;
  definitions: Record<string, PlandayFieldDefinitionProperty>;
  portalId: number;
  readOnly: string[];
  unique: string[];
}

export interface PlandayFieldDefinitionsResponse {
  data: PlandayFieldDefinitionsSchema;
}

/**
 * Bulk Upload Types
 */
export interface EmployeeUploadResult {
  employee: PlandayEmployeeCreateRequest;
  success: boolean;
  error?: string;
  plandayId?: number;
  rowIndex: number;
  /**
   * Post-creation / inline operation failures (supervisor, salary, pay-rate, contract-rule).
   * When present and non-empty on a successful row, the employee WAS created in Planday but
   * one or more follow-up operations failed — i.e. a "partial" success.
   */
  partialErrors?: string[];
}

export interface BulkUploadProgress {
  total: number;
  completed: number;
  partial?: number; // employees created but with follow-up/inline operation failures
  failed: number;
  inProgress: boolean;
  currentBatch: number;
  totalBatches: number;
}

export interface BulkUploadSummary {
  totalEmployees: number;
  successfulUploads: number;
  failedUploads: number;
  results: EmployeeUploadResult[];
  startTime: Date;
  endTime?: Date;
  duration?: number; // in milliseconds
}

/**
 * Excel and File Processing Types
 */
export interface ExcelColumnMapping {
  excelColumn: string;
  plandayField: keyof PlandayEmployeeCreateRequest;
  plandayFieldDisplayName?: string; // Human-readable name for display
  isRequired: boolean;
  isMapped: boolean;
}

export interface ParsedExcelData {
  headers: string[];
  rows: any[][];
  totalRows: number;
  fileName: string;
  fileSize: number;
  columnAnalysis?: Array<{
    index: number;
    header: string;
    totalValues: number;
    nonEmptyValues: number;
    dataPercentage: number;
    isEmpty: boolean;
    sampleData: any[];
  }>;
  discardedColumns?: string[];
  // Source Excel cell type per column (keyed by header). Lets the validation
  // pipeline branch on how a date was stored (real date cell vs. raw serial
  // number vs. free text) instead of guessing from a stringified value.
  columnExcelTypes?: Record<string, ExcelColumnType>;
  // Workbook date epoch flag (false = 1900 system, true = 1904 system).
  date1904?: boolean;
}

export type ExcelColumnType = 'date' | 'numeric' | 'text' | 'empty';

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  value: any;
  message: string;
  rowIndex: number;
  severity: 'error' | 'warning';
}

/**
 * Excluded Employee - for employees skipped due to validation errors
 * Used when user proceeds with upload despite having employees with errors
 */
export interface ExcludedEmployee {
  employee: Employee;
  errors: ValidationError[];
  rowIndex: number;
}

export interface ColumnMapping {
  firstName?: string;
  lastName?: string;
  userName?: string;
  departments?: string;
  employeeGroups?: string;
  cellPhone?: string;
  hiredFrom?: string;
  [key: string]: string | undefined;
}

/**
 * Employee type for internal processing
 * This represents an employee during the mapping and validation phases
 */
export interface Employee {
  firstName?: string;
  lastName?: string;
  userName?: string;
  departments?: string; // Can be names or IDs, comma-separated
  employeeGroups?: string; // Can be names or IDs, comma-separated
  employeeTypeId?: string; // Can be name or ID, single value only
  cellPhone?: string;
  hiredFrom?: string;
  rowIndex: number;
  _skipUpload?: boolean; // Flag to mark employee for skipping during upload
  [key: string]: any; // Allow additional fields from Excel
}

export interface ValidationWarning {
  field: string;
  value: any;
  message: string;
  rowIndex: number;
  severity: 'warning';
}

/**
 * Application State Types
 */
export interface AppState {
  currentStep: WorkflowStep;
  isAuthenticated: boolean;
  authTokens?: PlandayAuthTokens;
  departments: PlandayDepartment[];
  employeeGroups: PlandayEmployeeGroup[];
  excelData?: ParsedExcelData;
  columnMappings: ExcelColumnMapping[];
  validatedEmployees: PlandayEmployeeCreateRequest[];
  validationResults: ValidationResult;
  uploadProgress?: BulkUploadProgress;
  uploadSummary?: BulkUploadSummary;
}

/**
 * Workflow Step Enumeration
 */
export const WorkflowStep = {
  Authentication: 'authentication',
  FileUpload: 'upload',
  ColumnMapping: 'mapping',
  DataValidation: 'validation',
  DataCorrection: 'correction',
  FinalPreview: 'preview',
  BulkUpload: 'uploading',
  Results: 'results',
} as const;

// Workflow step type - matches constants/index.ts WorkflowStep  
export type WorkflowStep = 
  | 'authentication'
  | 'upload'
  | 'mapping'
  // Helper steps (conditional, between mapping and validation)
  | 'bulk-corrections'
  | 'date-format'
  // Main validation step
  | 'validation-correction'
  | 'preview'
  | 'uploading'
  | 'results'
  | 'documentation';

/**
 * API Configuration
 */
export interface PlandayApiConfig {
  baseUrl: string;
  authUrl: string;
  clientId: string;
  requiredHeaders: {
    'X-ClientId': string;
    'Content-Type': string;
    'Accept': string;
  };
}

/**
 * Custom Field Types
 */
export interface CustomField {
  key: string; // e.g., 'custom_employee_number'
  displayName: string; // e.g., 'Employee Number'
  type: 'string' | 'number' | 'boolean' | 'date';
  isRequired: boolean;
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
  };
}

/**
 * Utility Types
 */
export type RequiredEmployeeFields = Pick<
  PlandayEmployeeCreateRequest,
  'firstName' | 'lastName' | 'userName' | 'departments'
>;

export type OptionalEmployeeFields = Omit<
  PlandayEmployeeCreateRequest,
  keyof RequiredEmployeeFields
>;

/**
 * Component Props Types
 */
export interface StepComponentProps {
  onNext: () => void;
  onPrevious: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export interface ProgressIndicatorProps {
  currentStep: WorkflowStep;
  completedSteps: WorkflowStep[];
  totalSteps: number;
}

/**
 * API Error Codes from Planday Documentation
 */
export const PlandayErrorCodes = {
  BadRequest: 400,           // Employee id is invalid - validation errors
  Unauthorized: 401,         // Unauthorized - token issues, user not active
  InsufficientScope: 403,    // Insufficient scope - missing required permissions
  NotFound: 404,            // Employee doesn't exist - resource not found
  Conflict: 409,            // Conflict - validation errors in request data
  TooManyRequests: 429,     // Too many requests - rate limiting
  ServerError: 500,         // Server error - contact Planday support
} as const;

export type PlandayErrorCodes = typeof PlandayErrorCodes[keyof typeof PlandayErrorCodes];

/**
 * Rate Limiting Configuration
 */
export interface RateLimitConfig {
  maxRequestsPerMinute: number;
  batchSize: number;
  delayBetweenBatches: number; // milliseconds
  maxRetries: number;
  exponentialBackoffBase: number; // milliseconds
}

/**
 * Planday Portal Information
 */
export interface PlandayPortalInfo {
  id: number;
  name: string;
  companyName: string;
  country: string;          // Portal's country for phone parsing defaults
  timeZone: string;
  maxDepartments: number;
  aliases: string[];
  portals: Array<{
    id: number;
    name: string;
    aliases: string[];
  }>;
}

/**
 * Phone number parsing result
 */
export interface PhoneParseResult {
  isValid: boolean;
  phoneNumber?: string;      // Just the number part (e.g., "40055171")
  countryCode?: string;      // ISO code (e.g., "NO", "DK") 
  countryId?: number;        // Planday internal ID (if known)
  dialCode?: string;         // Phone country code (e.g., "47", "45")
  confidence: number;        // 0-1 confidence score
  error?: string;           // Error message if invalid
  originalInput: string;     // Original input for reference
  assumedCountry?: boolean;  // True if we used portal default country
}

/**
 * Country to phone mapping configuration
 */
export interface CountryPhoneMapping {
  countryCode: string;    // ISO 3166-1 alpha-2
  dialCode: string;       // International dial code
  minLength: number;      // Min phone number length (without country code)
  maxLength: number;      // Max phone number length (without country code)
  countryId?: number;     // Planday internal ID if available
}

/**
 * Payrate Types for Bulk Upload
 * Used for setting hourly rates on employee groups after employee creation
 */
export interface EmployeeGroupPayrateData {
  groupId: number;
  groupName: string;
  hourlyRate: number;
}

export interface PayrateSetRequest {
  wageType: 'HourlyRate';
  rate: number;
  employeeIds: number[];
  validFrom: string; // YYYY-MM-DD format
}

export interface PayrateSetResult {
  employeeId: number;
  groupId: number;
  groupName: string;
  rate: number;
  success: boolean;
  error?: string;
}

export interface PayrateAssignment {
  employeeId: number;
  groupId: number;
  groupName: string;
  rate: number;
  validFrom: string;
} 