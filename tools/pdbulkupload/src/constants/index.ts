// Temporary inline types to fix import issue
interface PlandayApiConfig {
  baseUrl: string;
  authUrl: string;
  clientId: string;
  requiredHeaders: {
    'X-ClientId': string;
    'Content-Type': string;
    'Accept': string;
  };
}

interface RateLimitConfig {
  maxRequestsPerMinute: number;
  batchSize: number;
  delayBetweenBatches: number;
  maxRetries: number;
  exponentialBackoffBase: number;
}

import type { CountryPhoneMapping } from '../types/planday';

export const WorkflowStep = {
  Authentication: 'authentication',
  FileUpload: 'upload',
  ColumnMapping: 'mapping',
  // Helper steps (conditional, between mapping and validation)
  BulkCorrections: 'bulk-corrections',
  DateFormat: 'date-format',
  // Main validation step
  ValidationCorrection: 'validation-correction',
  FinalPreview: 'preview',
  BulkUpload: 'uploading',
  Results: 'results',
  Documentation: 'documentation',
} as const;

/**
 * Planday API Configuration
 * Based on implementation plan specifications
 */
export const PLANDAY_API_CONFIG: PlandayApiConfig = {
  baseUrl: 'https://openapi.planday.com',
  authUrl: 'https://id.planday.com/connect/token',
  clientId: '13000bf2-dd1f-41ab-a1a0-eeec783f50d7', // Planday Application ID
  requiredHeaders: {
    'X-ClientId': '13000bf2-dd1f-41ab-a1a0-eeec783f50d7', // Planday Application ID
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
};

/**
 * API Endpoints
 * Based on actual Planday API documentation
 */
export const API_ENDPOINTS = {
  // Authentication
  TOKEN_REFRESH: '/connect/token',

  // HR API Endpoints (v1.0 with lowercase paths)
  DEPARTMENTS: '/hr/v1.0/departments',
  EMPLOYEES: '/hr/v1.0/employees',
  EMPLOYEE_GROUPS: '/hr/v1.0/employeegroups',
  EMPLOYEE_TYPES: '/hr/v1.0/employeetypes',
  EMPLOYEE_FIELD_DEFINITIONS: '/hr/v1.0/employees/fielddefinitions',
  SUPERVISORS: '/hr/v1.0/employees/supervisors',
  SKILLS: '/hr/v1.0/skills',

  // Pay API Endpoints (v1.0)
  PAYRATES_BY_GROUP: '/pay/v1.0/payrates/employeeGroups',
  SALARY_TYPES: '/pay/v1.0/salaries/types',  // Correct endpoint per Google Apps Script
  SALARIES: '/pay/v1.0/salaries/employees',

  // Contract Rules API Endpoints (v1 - must use v1, not v1.0, for CORS to work)
  CONTRACT_RULES: '/contractrules/v1/contractrules',
  CONTRACT_RULES_EMPLOYEES: '/contractrules/v1/employees',
} as const;

/**
 * Rate Limiting Configuration
 * Based on Planday API rate limits and best practices
 */
export const RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxRequestsPerMinute: 60,
  batchSize: 10, // Process 10 employees at a time
  delayBetweenBatches: 1000, // 1 second delay between batches
  maxRetries: 3,
  exponentialBackoffBase: 1000, // Start with 1 second, then 2s, 4s, 8s...
};

/**
 * Token Configuration
 * Access tokens expire after 1 hour according to Planday documentation
 */
export const TOKEN_CONFIG = {
  ACCESS_TOKEN_EXPIRY_MINUTES: 60,
  REFRESH_BUFFER_MINUTES: 5, // Refresh token 5 minutes before expiry
  STORAGE_KEY_REFRESH_TOKEN: 'planday_refresh_token',
  STORAGE_KEY_ACCESS_TOKEN: 'planday_access_token',
  STORAGE_KEY_TOKEN_EXPIRY: 'planday_token_expiry',
} as const;

/**
 * Main Workflow Steps Configuration (Blue Steps)
 * These are the 7 core steps shown in progress indicator
 */
export const MAIN_WORKFLOW_STEPS = [
  { key: 'authentication' as const, label: 'Authentication', description: 'Connect to Planday' },
  { key: 'upload' as const, label: 'Upload', description: 'Upload Excel file' },
  { key: 'mapping' as const, label: 'Mapping', description: 'Map columns' },
  { key: 'validation-correction' as const, label: 'Validation', description: 'Validate & fix errors' },
  { key: 'preview' as const, label: 'Preview', description: 'Final review' },
  { key: 'uploading' as const, label: 'Upload', description: 'Bulk upload' },
  { key: 'results' as const, label: 'Results', description: 'View results' },
] as const;

/**
 * Helper Steps (Yellow/Green Steps)
 * These are conditional steps between mapping and validation
 */
export const HELPER_STEPS = [
  { key: 'bulk-corrections' as const, label: 'Fix Invalid Names', description: 'Map invalid department/group names' },
  { key: 'date-format' as const, label: 'Date Format', description: 'Resolve ambiguous dates' },
] as const;

// Legacy export for backwards compatibility
export const WORKFLOW_STEPS = MAIN_WORKFLOW_STEPS;

// Re-export auto-mapping rules for backwards compatibility
export { AUTO_MAPPING_RULES, getSupportedFieldNames, getFieldPatterns, isFieldSupported } from './autoMappingRules';

/**
 * Validation Configuration
 */
export const VALIDATION_CONFIG = {
  // NOTE: Required fields are now fetched dynamically from Planday API
  // via ValidationService.getRequiredFields() instead of being hardcoded
  // Fallback required fields for cases when API is not available
  FALLBACK_REQUIRED_FIELDS: ['firstName', 'lastName'] as const,
  
  // Email validation pattern
  EMAIL_PATTERN: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  
  // Phone number cleaning patterns
  PHONE_CLEANUP_PATTERN: /[\s\-()]/g,
  
  // Date format for Planday API (YYYY-MM-DD)
  DATE_FORMAT: 'YYYY-MM-DD',
  
  // Maximum file size (10MB)
  MAX_FILE_SIZE: 10 * 1024 * 1024,
  
  // Supported file types (only .xlsx - legacy .xls format not supported)
  SUPPORTED_FILE_TYPES: ['.xlsx'] as const,
  
  // Maximum number of employees to process
  MAX_EMPLOYEES: 1000,
  
  // Field length limits
  FIELD_LIMITS: {
    firstName: { min: 1, max: 50 },
    lastName: { min: 1, max: 50 },
    userName: { min: 1, max: 100 },
    cellPhone: { max: 20 },
    street1: { max: 100 },
    city: { max: 50 },
    zip: { max: 10 },
  },
} as const;

/**
 * UI Configuration
 */
export const UI_CONFIG = {
  // Animation durations
  ANIMATION_DURATION: {
    FAST: 150,
    NORMAL: 300,
    SLOW: 500,
  },
  
  // Toast notification durations
  TOAST_DURATION: {
    SUCCESS: 3000,
    ERROR: 5000,
    WARNING: 4000,
    INFO: 3000,
  },
  
  // Progress indicator colors
  PROGRESS_COLORS: {
    COMPLETED: 'bg-success-600',
    CURRENT: 'bg-primary-600',
    PENDING: 'bg-gray-300',
  },
  
  // Table pagination
  DEFAULT_PAGE_SIZE: 25,
  PAGE_SIZE_OPTIONS: [10, 25, 50, 100],
  
  // File upload
  UPLOAD_AREA_HEIGHT: 200,
} as const;

/**
 * Error Messages
 */
export const ERROR_MESSAGES = {
  // File upload errors
  FILE_TOO_LARGE: 'File size exceeds 10MB limit',
  INVALID_FILE_TYPE: 'Only Excel files (.xlsx) are supported. Legacy .xls files must be converted to .xlsx first.',
  FILE_READ_ERROR: 'Error reading file. Please check the file format.',
  
  // Authentication errors
  AUTH_FAILED: 'Authentication failed. Please check your refresh token.',
  TOKEN_EXPIRED: 'Your session has expired. Please re-authenticate.',
  INVALID_TOKEN: 'Invalid refresh token provided.',
  
  // API errors
  API_CONNECTION_ERROR: 'Unable to connect to Planday API. Please check your internet connection.',
  RATE_LIMIT_EXCEEDED: 'Rate limit exceeded. Please wait before making more requests.',
  SERVER_ERROR: 'Server error occurred. Please try again later.',
  
  // Validation errors
  REQUIRED_FIELD_MISSING: 'This field is required',
  INVALID_EMAIL_FORMAT: 'Please enter a valid email address',
  INVALID_DATE_FORMAT: 'Please enter a valid date (YYYY-MM-DD)',
  DUPLICATE_EMAIL: 'This email address is already in use',
  INVALID_DEPARTMENT: 'Selected department does not exist',
  
  // Upload errors
  UPLOAD_FAILED: 'Upload failed. All employees have been rolled back.',
  PARTIAL_UPLOAD_ERROR: 'Some employees failed to upload. Check results for details.',
  NETWORK_ERROR: 'Network error occurred during upload. Please try again.',
} as const;

/**
 * Success Messages
 */
export const SUCCESS_MESSAGES = {
  FILE_UPLOADED: 'File uploaded successfully',
  VALIDATION_PASSED: 'All data validated successfully',
  MAPPING_COMPLETED: 'Column mapping completed',
  UPLOAD_COMPLETED: 'All employees uploaded successfully',
  DATA_CORRECTED: 'Data corrections applied',
} as const;

/**
 * Local Storage Keys
 */
export const STORAGE_KEYS = {
  REFRESH_TOKEN: 'pdbulkupload_refresh_token',
  COLUMN_MAPPINGS: 'pdbulkupload_column_mappings',
  USER_PREFERENCES: 'pdbulkupload_preferences',
  SESSION_DATA: 'pdbulkupload_session',
} as const;

/**
 * Application Metadata
 */
export const APP_METADATA = {
  NAME: 'Planday Bulk Employee Uploader',
  VERSION: '1.0.0',
  DESCRIPTION: 'Upload employees to Planday in bulk from Excel files',
  AUTHOR: 'Planday',
  SUPPORT_EMAIL: 'support@planday.com',
} as const;

/**
 * Feature Flags
 * For enabling/disabling features during development
 */
export const FEATURE_FLAGS = {
  ENABLE_CUSTOM_FIELDS: true,
  ENABLE_EMPLOYEE_GROUPS: true,
  ENABLE_SPECIAL_FIELDS: true, // SSN, BankAccount, BirthDate
  ENABLE_DEBUG_MODE: false,
  ENABLE_MOCK_API: false,
} as const;

/**
 * Development Configuration
 */
export const DEV_CONFIG = {
  MOCK_DELAY: 1000, // Simulated API delay in milliseconds
  ENABLE_CONSOLE_LOGS: true,
  SHOW_DEV_TOOLS: false,
} as const;

/**
 * Phone Parsing Configuration
 */
export const PHONE_PARSING_CONFIG = {
  // Countries supported by Planday API
  SUPPORTED_COUNTRIES: ["DK", "UK", "NO", "SE", "DE", "US", "PL", "VN", "FR", "ES", "IT", "NL", "CH", "BE", "AT", "FI", "IS", "AU", "CA", "JP", "KR", "CN", "BR", "MX", "IN", "ZA", "SG"],
  
  // Minimum confidence threshold for auto-acceptance
  MIN_CONFIDENCE_THRESHOLD: 0.8,
  
  // Default country if detection fails (Denmark since Planday is Danish)
  DEFAULT_COUNTRY: 'DK'
} as const;

/**
 * Country to Phone Code Mappings
 * Based on international dialing codes and phone number formats
 */
export const COUNTRY_PHONE_MAPPINGS: CountryPhoneMapping[] = [
  // Nordic countries (most common for Planday)
  { countryCode: 'DK', dialCode: '45', minLength: 8, maxLength: 8 },    // Denmark
  { countryCode: 'NO', dialCode: '47', minLength: 8, maxLength: 8 },    // Norway  
  { countryCode: 'SE', dialCode: '46', minLength: 9, maxLength: 9 },    // Sweden
  { countryCode: 'FI', dialCode: '358', minLength: 8, maxLength: 9 },   // Finland
  { countryCode: 'IS', dialCode: '354', minLength: 7, maxLength: 7 },   // Iceland
  
  // Other European countries supported by Planday
  { countryCode: 'UK', dialCode: '44', minLength: 10, maxLength: 11 },  // United Kingdom
  { countryCode: 'DE', dialCode: '49', minLength: 10, maxLength: 12 },  // Germany
  { countryCode: 'FR', dialCode: '33', minLength: 9, maxLength: 9 },    // France
  { countryCode: 'IT', dialCode: '39', minLength: 9, maxLength: 11 },   // Italy
  { countryCode: 'ES', dialCode: '34', minLength: 9, maxLength: 9 },    // Spain
  { countryCode: 'NL', dialCode: '31', minLength: 9, maxLength: 9 },    // Netherlands
  { countryCode: 'CH', dialCode: '41', minLength: 9, maxLength: 9 },    // Switzerland
  { countryCode: 'BE', dialCode: '32', minLength: 8, maxLength: 9 },    // Belgium
  { countryCode: 'AT', dialCode: '43', minLength: 10, maxLength: 11 },  // Austria
  { countryCode: 'PL', dialCode: '48', minLength: 9, maxLength: 9 },    // Poland
  
  // Other supported countries
  { countryCode: 'US', dialCode: '1', minLength: 10, maxLength: 10 },   // United States
  { countryCode: 'CA', dialCode: '1', minLength: 10, maxLength: 10 },   // Canada
  { countryCode: 'AU', dialCode: '61', minLength: 9, maxLength: 9 },    // Australia
  { countryCode: 'JP', dialCode: '81', minLength: 10, maxLength: 11 },  // Japan
  { countryCode: 'KR', dialCode: '82', minLength: 8, maxLength: 9 },    // South Korea
  { countryCode: 'CN', dialCode: '86', minLength: 11, maxLength: 11 },  // China
  { countryCode: 'BR', dialCode: '55', minLength: 10, maxLength: 11 },  // Brazil
  { countryCode: 'MX', dialCode: '52', minLength: 10, maxLength: 10 },  // Mexico
  { countryCode: 'IN', dialCode: '91', minLength: 10, maxLength: 10 },  // India
  { countryCode: 'ZA', dialCode: '27', minLength: 9, maxLength: 9 },    // South Africa
  { countryCode: 'SG', dialCode: '65', minLength: 8, maxLength: 8 },    // Singapore
  { countryCode: 'VN', dialCode: '84', minLength: 9, maxLength: 10 },   // Vietnam
];

/**
 * Portal Country to Phone Country Mapping
 * Maps portal country names/codes to standardized phone country codes
 */
export const PORTAL_COUNTRY_MAPPING: Record<string, string> = {
  // Nordic countries
  'Denmark': 'DK',
  'Norway': 'NO', 
  'Sweden': 'SE',
  'Finland': 'FI',
  'Iceland': 'IS',
  
  // English-speaking
  'United States': 'US',
  'UnitedStates': 'US',    // Portal sometimes returns without space
  'United Kingdom': 'UK',
  'UnitedKingdom': 'UK',   // Portal sometimes returns without space
  'Canada': 'CA',
  'Australia': 'AU',
  
  // Other European
  'Germany': 'DE',
  'France': 'FR',
  'Italy': 'IT',
  'Spain': 'ES',
  'Netherlands': 'NL',
  'Switzerland': 'CH',
  'Belgium': 'BE',
  'Austria': 'AT',
  'Poland': 'PL',
  
  // Asian
  'Japan': 'JP',
  'South Korea': 'KR',
  'SouthKorea': 'KR',      // Portal sometimes returns without space
  'China': 'CN',
  'India': 'IN',
  'Singapore': 'SG',
  'Vietnam': 'VN',
  
  // Others
  'Brazil': 'BR',
  'Mexico': 'MX',
  'South Africa': 'ZA',
  'SouthAfrica': 'ZA',     // Portal sometimes returns without space
  
  // ISO codes (in case portal returns these directly)
  'DK': 'DK', 'NO': 'NO', 'SE': 'SE', 'FI': 'FI', 'IS': 'IS',
  'US': 'US', 'UK': 'UK', 'CA': 'CA', 'AU': 'AU',
  'DE': 'DE', 'FR': 'FR', 'IT': 'IT', 'ES': 'ES', 
  'NL': 'NL', 'CH': 'CH', 'BE': 'BE', 'AT': 'AT', 'PL': 'PL',
  'JP': 'JP', 'KR': 'KR', 'CN': 'CN', 'IN': 'IN', 
  'SG': 'SG', 'VN': 'VN', 'BR': 'BR', 'MX': 'MX', 'ZA': 'ZA'
};

// WorkflowStep is already exported above 