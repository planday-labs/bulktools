/**
 * Planday API Service
 * Comprehensive service for all Planday API interactions
 * Features:
 * - Automatic token refresh management
 * - Department and employee group fetching
 * - Employee creation with batch processing
 * - Comprehensive error handling for all Planday API error codes
 * - Rate limiting compliance with exponential backoff
 */

import type {
  PlandayAuthTokens,
  TokenRefreshRequest,
  PlandayDepartment,
  PlandayEmployeeGroup,
  PlandayEmployeeType,
  PlandayEmployeeTypesResponse,
  PlandaySupervisor,
  PlandaySkill,
  PlandaySkillsResponse,
  PlandaySalaryType,
  PlandaySalaryTypesResponse,
  PlandayContractRule,
  PlandayContractRulesResponse,
  PlandayEmployeeCreateRequest,
  PlandayEmployeeResponse,
  SsnExistenceCheckResult,
  BulkUploadProgress,
  EmployeeUploadResult,
  PlandayFieldDefinitionsSchema,
  PlandayFieldDefinitionsResponse,
  PlandayPortalInfo,
  PayrateSetRequest,
  PayrateSetResult,
  PayrateAssignment,
  FixedSalaryAssignment,
  FixedSalarySetResult,
} from '../types/planday';

import { PlandayErrorCodes } from '../types/planday';

import {
  PLANDAY_API_CONFIG,
  API_ENDPOINTS,
  TOKEN_CONFIG,
  RATE_LIMIT_CONFIG,
} from '../constants';

/**
 * Planday API Client
 * Handles all communication with Planday APIs
 */
export class PlandayApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private refreshPromise: Promise<void> | null = null;

  constructor() {
    // Load stored tokens on initialization
    this.loadStoredTokens();
  }

  /**
   * Initialize the API client with a refresh token
   * This is the entry point for authentication
   */
  async initialize(refreshToken: string): Promise<void> {
    this.refreshToken = refreshToken;
    this.storeRefreshToken(refreshToken);
    
    // Get initial access token
    await this.refreshAccessToken();
  }

  /**
   * Check if the client is properly authenticated
   */
  isAuthenticated(): boolean {
    return !!(this.accessToken && this.refreshToken && this.tokenExpiry);
  }

  /**
   * Get current access token, refreshing if necessary
   */
  private async getValidAccessToken(): Promise<string> {
    // Check if we need to refresh the token
    if (this.shouldRefreshToken()) {
      await this.ensureTokenRefresh();
    }

    if (!this.accessToken) {
      throw new Error('No valid access token available. Please re-authenticate.');
    }

    return this.accessToken;
  }

  /**
   * Check if token should be refreshed (5 minutes before expiry)
   */
  private shouldRefreshToken(): boolean {
    if (!this.tokenExpiry) return true;
    
    const bufferTime = TOKEN_CONFIG.REFRESH_BUFFER_MINUTES * 60 * 1000;
    const refreshTime = this.tokenExpiry.getTime() - bufferTime;
    
    return Date.now() >= refreshTime;
  }

  /**
   * Ensure token refresh happens only once if multiple requests are made
   */
  private async ensureTokenRefresh(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.refreshAccessToken();
    
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) {
      throw new Error('No refresh token available. Please re-authenticate.');
    }

    const requestBody: TokenRefreshRequest = {
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken,
      client_id: PLANDAY_API_CONFIG.clientId,
    };

    try {
      const response = await fetch(PLANDAY_API_CONFIG.authUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams(requestBody as any).toString(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Token refresh failed: ${errorData.error_description || response.statusText}`);
      }

      const tokens: PlandayAuthTokens = await response.json();
      
      // Update stored tokens
      this.accessToken = tokens.access_token;
      this.tokenExpiry = new Date(Date.now() + (tokens.expires_in * 1000));
      
      // Store in sessionStorage for persistence
      this.storeTokens(tokens);
      
  
    } catch (error) {
      console.error('❌ Token refresh failed:', error);
      this.clearStoredTokens();
      throw error;
    }
  }

  /**
   * Make authenticated API request with automatic token refresh
   */
  private async makeAuthenticatedRequest<T = any>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const accessToken = await this.getValidAccessToken();
    
    const response = await fetch(`${PLANDAY_API_CONFIG.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        ...PLANDAY_API_CONFIG.requiredHeaders,
        'Authorization': `Bearer ${accessToken}`,
        ...options.headers,
      },
    });

    return this.handleApiResponse<T>(response);
  }

  /**
   * Fetch all records from a paginated endpoint
   * Automatically handles pagination to retrieve all records beyond the 50-record limit
   */
  private async fetchAllPaginated<T>(
    endpoint: string,
    entityName: string
  ): Promise<T[]> {
    const allRecords: T[] = [];
    const pageSize = 50; // Planday's maximum limit per request
    let offset = 0;
    let total = 0;

    do {
      const paginatedEndpoint = `${endpoint}?limit=${pageSize}&offset=${offset}`;
      const response = await this.makeAuthenticatedRequest<{ paging: { offset: number; limit: number; total: number }; data: T[] }>(paginatedEndpoint);

      if (!response.data || !response.paging) {
        console.warn(`⚠️ Unexpected response format for ${entityName}, returning available data`);
        return allRecords;
      }

      allRecords.push(...response.data);
      total = response.paging.total;
      offset += response.data.length;

      if (offset < total) {
        console.log(`📄 Fetched ${offset}/${total} ${entityName}...`);
      }
    } while (offset < total);

    console.log(`✅ Fetched all ${allRecords.length} ${entityName}`);
    return allRecords;
  }

  /**
   * Handle API response with comprehensive error handling
   */
  private async handleApiResponse<T>(response: Response): Promise<T> {
    // Handle successful responses
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      return {} as T;
    }

    // Handle error responses with specific Planday error codes
    let errorData: any = {};
    try {
      errorData = await response.json();
    } catch {
      errorData = { message: response.statusText };
    }

    // Enhanced error message extraction - handle various Planday error formats
    let errorMessage = errorData.message ||
                        errorData.error_description ||
                        errorData.error ||
                        errorData.detail ||
                        response.statusText ||
                        'Unknown error';

    // Ensure errorMessage is a string (API sometimes returns objects)
    if (typeof errorMessage !== 'string') {
      errorMessage = JSON.stringify(errorMessage);
    }

    // Check for nested errors array (Planday validation errors)
    if (errorData.errors && Array.isArray(errorData.errors)) {
      const errorMessages = errorData.errors.map((e: any) =>
        typeof e === 'string' ? e : (typeof e.message === 'string' ? e.message : typeof e.error === 'string' ? e.error : JSON.stringify(e))
      );
      if (errorMessages.length > 0) {
        errorMessage = errorMessages.join('; ');
      }
    }

    // Check for ModelState validation errors (ASP.NET format)
    if (errorData.ModelState) {
      const modelErrors: string[] = [];
      Object.entries(errorData.ModelState).forEach(([field, errors]) => {
        if (Array.isArray(errors)) {
          modelErrors.push(`${field}: ${errors.join(', ')}`);
        }
      });
      if (modelErrors.length > 0) {
        errorMessage = modelErrors.join('; ');
      }
    }

    // Check for title in problem details format
    if (errorData.title && errorMessage === 'Unknown error') {
      errorMessage = errorData.title;
    }

    const error = new PlandayApiError(
      response.status as PlandayErrorCodes,
      errorMessage,
      errorData
    );

    // Enhanced error logging for debugging
    console.error(`❌ Planday API Error (${response.status}):`, errorMessage);
    console.error('Full error response:', JSON.stringify(errorData, null, 2));
    console.error('Response headers:', Object.fromEntries(response.headers.entries()));

    throw error;
  }

  /**
   * Fetch all departments from Planday
   * Handles pagination automatically (API limit: 50 per request)
   */
  async fetchDepartments(): Promise<PlandayDepartment[]> {
    try {
      return await this.fetchAllPaginated<PlandayDepartment>(
        API_ENDPOINTS.DEPARTMENTS,
        'departments'
      );
    } catch (error) {
      console.error('❌ Failed to fetch departments:', error);
      throw error;
    }
  }

  /**
   * Fetch all employee groups from Planday
   * Handles pagination automatically (API limit: 50 per request)
   */
  async fetchEmployeeGroups(): Promise<PlandayEmployeeGroup[]> {
    try {
      return await this.fetchAllPaginated<PlandayEmployeeGroup>(
        API_ENDPOINTS.EMPLOYEE_GROUPS,
        'employee groups'
      );
    } catch (error) {
      console.error('❌ Failed to fetch employee groups:', error);
      throw error;
    }
  }

  /**
   * Fetch all employee types from Planday
   */
  async fetchEmployeeTypes(): Promise<PlandayEmployeeType[]> {
    try {
      const response = await this.makeAuthenticatedRequest<PlandayEmployeeTypesResponse>(
        API_ENDPOINTS.EMPLOYEE_TYPES
      );

      console.log(`✅ Fetched ${response.data.length} employee types`);
      return response.data || [];
    } catch (error) {
      console.error('❌ Failed to fetch employee types:', error);
      throw error;
    }
  }

  /**
   * Fetch all supervisors (employees marked as supervisors)
   * Used for mapping supervisor names to supervisor record IDs
   * Handles pagination automatically (API limit: 50 per request)
   */
  async fetchSupervisors(): Promise<PlandaySupervisor[]> {
    try {
      // Supervisors can exceed 50 in large organizations, use pagination
      return await this.fetchAllPaginated<PlandaySupervisor>(
        API_ENDPOINTS.SUPERVISORS,
        'supervisors'
      );
    } catch (error) {
      console.error('❌ Failed to fetch supervisors:', error);
      throw error;
    }
  }

  /**
   * Fetch all skills from Planday
   * Skills API returns a direct array, not paginated
   */
  async fetchSkills(): Promise<PlandaySkill[]> {
    try {
      // Skills endpoint returns a direct array, not a paginated response
      const skills = await this.makeAuthenticatedRequest<PlandaySkillsResponse>(
        API_ENDPOINTS.SKILLS
      );

      console.log(`✅ Fetched ${skills.length} skills`);
      return skills;
    } catch (error) {
      console.error('❌ Failed to fetch skills:', error);
      throw error;
    }
  }

  /**
   * Assign a supervisor to an employee via PUT request
   * This must be done AFTER employee creation (supervisorId not accepted in POST)
   */
  async assignSupervisorToEmployee(employeeId: number, supervisorRecordId: number): Promise<void> {
    try {
      await this.makeAuthenticatedRequest(
        `${API_ENDPOINTS.EMPLOYEES}/${employeeId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ supervisorId: supervisorRecordId })
        }
      );
      console.log(`✅ Assigned supervisor ${supervisorRecordId} to employee ${employeeId}`);
    } catch (error) {
      console.error(`❌ Failed to assign supervisor to employee ${employeeId}:`, error);
      throw error;
    }
  }

  /**
   * Bulk assign supervisors to employees after creation
   */
  async bulkAssignSupervisors(
    assignments: Array<{ employeeId: number; supervisorId: number; supervisorName: string }>,
    onProgress?: (completed: number, total: number) => void
  ): Promise<Array<{ employeeId: number; supervisorId: number; supervisorName: string; success: boolean; error?: string }>> {
    const results: Array<{ employeeId: number; supervisorId: number; supervisorName: string; success: boolean; error?: string }> = [];

    if (assignments.length === 0) {
      return results;
    }

    console.log(`👔 Assigning supervisors to ${assignments.length} employees...`);

    let completed = 0;
    const total = assignments.length;

    for (const assignment of assignments) {
      try {
        await this.assignSupervisorToEmployee(assignment.employeeId, assignment.supervisorId);
        results.push({
          employeeId: assignment.employeeId,
          supervisorId: assignment.supervisorId,
          supervisorName: assignment.supervisorName,
          success: true
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          employeeId: assignment.employeeId,
          supervisorId: assignment.supervisorId,
          supervisorName: assignment.supervisorName,
          success: false,
          error: errorMessage
        });
      }

      completed++;
      onProgress?.(completed, total);
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`👔 Supervisor assignment complete: ${successful} successful, ${failed} failed`);

    return results;
  }

  /**
   * Fetch salary types from Planday Pay API
   * Returns list of salary period types (Monthly, Weekly, etc.)
   */
  async fetchSalaryTypes(): Promise<PlandaySalaryType[]> {
    try {
      const response = await this.makeAuthenticatedRequest<PlandaySalaryTypesResponse>(
        API_ENDPOINTS.SALARY_TYPES
      );

      console.log(`✅ Fetched ${response.data.length} salary types`);
      return response.data;
    } catch (error) {
      console.error('❌ Failed to fetch salary types:', error);
      throw error;
    }
  }

  /**
   * Assign a fixed salary to an employee via PUT request
   * This can be done after employee creation
   */
  async assignFixedSalary(
    employeeId: number,
    salaryTypeId: number,
    hours: number,
    salary: number,
    validFrom: string
  ): Promise<void> {
    try {
      await this.makeAuthenticatedRequest(
        `${API_ENDPOINTS.SALARIES}/${employeeId}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            from: validFrom,
            salaryTypeId,
            hours: Number(hours),
            salary: Number(salary)
          })
        }
      );
      console.log(`✅ Assigned fixed salary (type ${salaryTypeId}, ${salary}) to employee ${employeeId}`);
    } catch (error) {
      console.error(`❌ Failed to assign fixed salary to employee ${employeeId}:`, error);
      throw error;
    }
  }

  /**
   * Bulk assign fixed salaries to employees after creation
   */
  async bulkAssignFixedSalaries(
    assignments: FixedSalaryAssignment[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<FixedSalarySetResult[]> {
    const results: FixedSalarySetResult[] = [];

    if (assignments.length === 0) {
      return results;
    }

    console.log(`💵 Assigning fixed salaries to ${assignments.length} employees...`);

    let completed = 0;
    const total = assignments.length;

    for (const assignment of assignments) {
      try {
        await this.assignFixedSalary(
          assignment.employeeId,
          assignment.salaryTypeId,
          assignment.hours,
          assignment.salary,
          assignment.validFrom
        );
        results.push({
          employeeId: assignment.employeeId,
          salaryTypeId: assignment.salaryTypeId,
          salaryTypeName: assignment.salaryTypeName,
          hours: assignment.hours,
          salary: assignment.salary,
          success: true
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          employeeId: assignment.employeeId,
          salaryTypeId: assignment.salaryTypeId,
          salaryTypeName: assignment.salaryTypeName,
          hours: assignment.hours,
          salary: assignment.salary,
          success: false,
          error: errorMessage
        });
      }

      completed++;
      onProgress?.(completed, total);
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`💵 Fixed salary assignment complete: ${successful} successful, ${failed} failed`);

    return results;
  }

  /**
   * Fetch all contract rules from the portal
   * Contract rules define contracted hours (per week, month, or year)
   */
  async fetchContractRules(): Promise<PlandayContractRule[]> {
    try {
      const response = await this.makeAuthenticatedRequest<PlandayContractRulesResponse>(
        API_ENDPOINTS.CONTRACT_RULES
      );

      console.log(`✅ Fetched ${response.data.length} contract rules`);
      return response.data;
    } catch (error) {
      console.error('❌ Failed to fetch contract rules:', error);
      throw error;
    }
  }

  /**
   * Assign a contract rule to an employee via PUT request
   * This is done inline after employee creation (not deferred like supervisors)
   *
   * Endpoint: PUT /contractrules/v1/employees/{employeeId}?contractRuleId={contractRuleId}
   * Body: {"employeeId": "123456"} (employeeId as string)
   */
  async assignContractRule(employeeId: number, contractRuleId: number): Promise<void> {
    try {
      await this.makeAuthenticatedRequest(
        `${API_ENDPOINTS.CONTRACT_RULES_EMPLOYEES}/${employeeId}?contractRuleId=${contractRuleId}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            employeeId: String(employeeId)
          })
        }
      );
      console.log(`✅ Assigned contract rule ${contractRuleId} to employee ${employeeId}`);
    } catch (error) {
      console.error(`❌ Failed to assign contract rule to employee ${employeeId}:`, error);
      throw error;
    }
  }

  /**
   * Fetch portal information including company name and country
   * Used for phone number parsing defaults and user experience
   */
  async fetchPortalInfo(): Promise<PlandayPortalInfo> {
    try {
      const response = await this.makeAuthenticatedRequest<{ data: PlandayPortalInfo }>(
        '/portal/v1.0/info'
      );
      
      return response.data;
    } catch (error) {
      console.error('❌ Failed to fetch portal info:', error);
      throw new PlandayApiError(
        PlandayErrorCodes.ServerError,
        `Failed to fetch portal information: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Fetch employee field definitions from Planday HR API
   * Returns schema with required fields, read-only fields, and custom fields for this portal
   */
  async fetchEmployeeFieldDefinitions(type: 'Post' | 'Put' = 'Post'): Promise<PlandayFieldDefinitionsSchema> {
    try {
      const response = await this.makeAuthenticatedRequest<PlandayFieldDefinitionsResponse>(
        `${API_ENDPOINTS.EMPLOYEE_FIELD_DEFINITIONS}?type=${type}`
      );
      
      // Field definitions fetched successfully
      
      return response.data;
    } catch (error) {
      console.error('❌ Failed to fetch employee field definitions:', error);
      throw error;
    }
  }

  /**
   * Fetch employees from Planday with pagination
   * Used for verification after upload to ensure employees were created correctly
   */
  async fetchEmployees(limit: number = 100, offset: number = 0, special?: string): Promise<{
    employees: PlandayEmployeeResponse[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      // `special` requests protected fields (e.g. "Ssn") that need an extra OAuth scope.
      const specialParam = special ? `&Special=${encodeURIComponent(special)}` : '';
      const response = await this.makeAuthenticatedRequest<{
        paging: { offset: number; limit: number; total: number };
        data: PlandayEmployeeResponse[];
      }>(`${API_ENDPOINTS.EMPLOYEES}?limit=${limit}&offset=${offset}${specialParam}`);
      
      return {
        employees: response.data,
        total: response.paging.total,
        hasMore: (offset + limit) < response.paging.total,
      };
    } catch (error) {
      console.error('❌ Failed to fetch employees:', error);
      throw error;
    }
  }

  /**
   * Fetch a small sample of employees for field discovery.
   * Returns raw employee records; catches errors internally and returns [] on failure.
   */
  async fetchEmployeeSample(sampleSize: number = 5): Promise<Record<string, any>[]> {
    try {
      const result = await this.fetchEmployees(sampleSize, 0);
      return result.employees as Record<string, any>[];
    } catch (error) {
      console.warn('⚠️ Could not fetch employee sample for field discovery:', error);
      return [];
    }
  }

  /**
   * Check if employees with specific email addresses already exist in Planday
   * Returns a map of email -> existing employee data
   */
  async checkExistingEmployeesByEmail(emailAddresses: string[]): Promise<Map<string, PlandayEmployeeResponse>> {
    const existingEmployees = new Map<string, PlandayEmployeeResponse>();
    
    try {
      
      // Fetch all employees in batches to check for duplicates
      // Note: Planday API doesn't have a direct "search by email" endpoint,
      // so we need to fetch employees and filter locally
      let offset = 0;
      const limit = 50; // Planday API maximum is 50 records per request
      let hasMore = true;
      
      while (hasMore) {
        const result = await this.fetchEmployees(limit, offset);
        
        // Check each employee's userName against our list
        for (const employee of result.employees) {
          if (employee.userName) {
            const normalizedApiEmail = employee.userName.toLowerCase().trim();
            
            if (emailAddresses.includes(normalizedApiEmail)) {
              existingEmployees.set(normalizedApiEmail, employee);
            }
          }
        }
        
        hasMore = result.hasMore;
        offset += limit;
        
        // Add a small delay between batches to respect rate limits
        if (hasMore) {
          await this.delay(200);
        }
      }
      
      // Existing employee check completed
      
      return existingEmployees;

    } catch (error) {
      console.error('❌ Failed to check existing employees by email:', error);
      throw error;
    }
  }

  /**
   * Check if employees with specific SSNs already exist in Planday.
   * Returns the matched SSNs (exact-string keys, no normalization) plus an
   * `available` flag.
   *
   * SSN is a protected field requiring an extra OAuth scope. If the portal/token
   * doesn't grant it, the check degrades gracefully and reports `available: false`
   * so the caller can surface a notice instead of treating it as "no duplicates":
   *  - the request throws (e.g. 403), or
   *  - employees are returned but none expose an `ssn` field at all.
   */
  async checkExistingEmployeesBySsn(ssnValues: string[]): Promise<SsnExistenceCheckResult> {
    const existing = new Map<string, PlandayEmployeeResponse>();

    // Exact-match set; only normalization is dropping empty/whitespace entries.
    const wantedSsns = new Set<string>();
    ssnValues.forEach(value => {
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        wantedSsns.add(String(value));
      }
    });

    if (wantedSsns.size === 0) {
      return { existing, available: true };
    }

    try {
      let offset = 0;
      const limit = 50; // Planday API maximum is 50 records per request
      let hasMore = true;
      let sawEmployees = false;
      let sawSsnField = false;

      while (hasMore) {
        // Request the protected ssn field explicitly.
        const result = await this.fetchEmployees(limit, offset, 'Ssn');

        for (const employee of result.employees) {
          sawEmployees = true;
          if ('ssn' in employee) {
            sawSsnField = true;
          }
          const employeeSsn = (employee as any).ssn;
          if (employeeSsn !== null && employeeSsn !== undefined) {
            const ssnString = String(employeeSsn);
            if (wantedSsns.has(ssnString)) {
              existing.set(ssnString, employee);
            }
          }
        }

        hasMore = result.hasMore;
        offset += limit;

        // Add a small delay between batches to respect rate limits
        if (hasMore) {
          await this.delay(200);
        }
      }

      // If the portal has employees but none expose ssn, the scope is withheld.
      const available = !(sawEmployees && !sawSsnField);
      if (!available) {
        console.warn('⚠️ SSN existence check unavailable: employee records did not include SSN (scope likely not granted).');
      }
      return { existing, available };

    } catch (error) {
      // Degrade gracefully: SSN scope may not be granted for this portal/token.
      console.warn('⚠️ SSN existence check skipped (Planday may not return SSN for this token):', error);
      return { existing, available: false };
    }
  }

  /**
   * Fetch specific employees by IDs for verification
   * More efficient when we know exactly which employees to verify
   */
  async fetchEmployeesByIds(employeeIds: number[]): Promise<PlandayEmployeeResponse[]> {
    try {
      // Planday API might not support bulk ID fetching, so we'll fetch individually
      // This is less efficient but ensures accuracy for verification
      const employees: PlandayEmployeeResponse[] = [];
      
      for (const id of employeeIds) {
        try {
          const response = await this.makeAuthenticatedRequest<{ data: PlandayEmployeeResponse }>(
            `${API_ENDPOINTS.EMPLOYEES}/${id}`
          );
          // Handle wrapped response structure
          const employee = response.data || response;
          employees.push(employee);
        } catch (error) {
          console.warn(`⚠️ Failed to fetch employee with ID ${id}:`, error);
          // Continue with other employees even if one fails
        }
      }
      
      return employees;
    } catch (error) {
      console.error('❌ Failed to fetch employees by IDs:', error);
      throw error;
    }
  }

  /**
   * Create a single employee in Planday
   */
  async createEmployee(employee: PlandayEmployeeCreateRequest): Promise<{ data: PlandayEmployeeResponse }> {
    try {
      console.log(`📤 Creating employee: ${employee.firstName} ${employee.lastName}`);

      const response = await this.makeAuthenticatedRequest<{ data: PlandayEmployeeResponse }>(
        API_ENDPOINTS.EMPLOYEES,
        {
          method: 'POST',
          body: JSON.stringify(employee),
        }
      );

      return response;
    } catch (error) {
      console.error(`❌ Failed to create employee ${employee.firstName} ${employee.lastName}:`, error);
      throw error;
    }
  }

  /**
   * Atomic upload employees - stops on first failure
   * All employees must succeed or none are uploaded (best effort rollback)
   */
  async atomicUploadEmployees(
    employees: PlandayEmployeeCreateRequest[],
    onProgress?: (progress: BulkUploadProgress) => void
  ): Promise<EmployeeUploadResult[]> {
    console.log(`🚀 Starting ATOMIC upload of ${employees.length} employees...`);
    console.log(`⚠️ ATOMIC MODE: Upload will stop on first failure`);
    
    const results: EmployeeUploadResult[] = [];
    const totalBatches = Math.ceil(employees.length / RATE_LIMIT_CONFIG.batchSize);
    let completed = 0;
    let failed = 0;

    // Update progress
    const updateProgress = (currentBatch: number) => {
      if (onProgress) {
        onProgress({
          total: employees.length,
          completed,
          failed,
          inProgress: true,
          currentBatch,
          totalBatches,
        });
      }
    };

    try {
      // Process employees in batches - STOP ON FIRST FAILURE
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * RATE_LIMIT_CONFIG.batchSize;
        const batchEnd = Math.min(batchStart + RATE_LIMIT_CONFIG.batchSize, employees.length);
        const batch = employees.slice(batchStart, batchEnd);

        console.log(`📦 Processing batch ${batchIndex + 1}/${totalBatches} (${batch.length} employees) - ATOMIC MODE`);
        updateProgress(batchIndex + 1);

        // Process batch with ATOMIC behavior (stop on first failure)
        const batchResults = await this.processAtomicBatch(batch, batchStart);
        results.push(...batchResults);

        // Update counters and CHECK FOR FAILURES
        for (const result of batchResults) {
          if (result.success) {
            completed++;
          } else {
            failed++;
            // ATOMIC: Stop on first failure
            console.log(`🛑 ATOMIC FAILURE: Stopping upload due to failed employee: ${result.employee.firstName} ${result.employee.lastName}`);
        
            
            // Final progress update with failure
            if (onProgress) {
              onProgress({
                total: employees.length,
                completed,
                failed,
                inProgress: false,
                currentBatch: batchIndex + 1,
                totalBatches,
              });
            }
            
            return results; // Return immediately on first failure
          }
        }

        // Add delay between batches (except for the last batch)
        if (batchIndex < totalBatches - 1) {
          await this.delay(RATE_LIMIT_CONFIG.delayBetweenBatches);
        }
      }

      // If we get here, all employees succeeded
      console.log(`🎉 ATOMIC SUCCESS: All ${completed} employees uploaded successfully!`);
      
      // Final progress update
      if (onProgress) {
        onProgress({
          total: employees.length,
          completed,
          failed,
          inProgress: false,
          currentBatch: totalBatches,
          totalBatches,
        });
      }

      return results;

    } catch (error) {
      console.error('❌ Atomic upload failed:', error);
      
      // Final progress update with error state
      if (onProgress) {
        onProgress({
          total: employees.length,
          completed,
          failed,
          inProgress: false,
          currentBatch: totalBatches,
          totalBatches,
        });
      }
      
      throw error;
    }
  }

  /**
   * Process a batch of employees with ATOMIC behavior (stop on first failure)
   */
  private async processAtomicBatch(
    employees: PlandayEmployeeCreateRequest[],
    startIndex: number
  ): Promise<EmployeeUploadResult[]> {
    const batchResults: EmployeeUploadResult[] = [];

    for (let i = 0; i < employees.length; i++) {
      const employee = employees[i];
      const rowIndex = startIndex + i;

      try {
        const response = await this.createEmployee(employee);
        
        batchResults.push({
          employee,
          success: true,
          plandayId: response.data?.id || (response as any).id, // Handle both wrapped and unwrapped responses
          rowIndex,
        });

        console.log(`✅ Created employee: ${employee.firstName} ${employee.lastName} (ID: ${response.data?.id || (response as any).id})`);

      } catch (error) {
        let errorMessage = 'Unknown error';
        let fullErrorDetails = error;

        if (error instanceof PlandayApiError) {
          errorMessage = error.message;
          fullErrorDetails = {
            message: error.message,
            statusCode: error.statusCode,
            originalError: error.originalError
          };
        } else if (error instanceof Error) {
          errorMessage = error.message;
        }

        console.log(`❌ Failed to create employee: ${employee.firstName} ${employee.lastName} - ${errorMessage}`);
        console.error('Full error details:', fullErrorDetails);

        batchResults.push({
          employee,
          success: false,
          error: errorMessage,
          rowIndex,
        });

        // ATOMIC: Return immediately on any failure (don't process remaining employees in batch)
        return batchResults;
      }
    }

    return batchResults;
  }

  /**
   * Bulk upload employees with progress tracking and error handling
   * Implements best-effort upload strategy with proper rate limiting
   */
  async bulkUploadEmployees(
    employees: PlandayEmployeeCreateRequest[],
    onProgress?: (progress: BulkUploadProgress) => void
  ): Promise<EmployeeUploadResult[]> {
    console.log(`🚀 Starting bulk upload of ${employees.length} employees...`);
    
    const results: EmployeeUploadResult[] = [];
    const totalBatches = Math.ceil(employees.length / RATE_LIMIT_CONFIG.batchSize);
    let completed = 0;
    let failed = 0;

    // Update progress
    const updateProgress = (currentBatch: number) => {
      if (onProgress) {
        onProgress({
          total: employees.length,
          completed,
          failed,
          inProgress: true,
          currentBatch,
          totalBatches,
        });
      }
    };

    try {
      // Process employees in batches
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const batchStart = batchIndex * RATE_LIMIT_CONFIG.batchSize;
        const batchEnd = Math.min(batchStart + RATE_LIMIT_CONFIG.batchSize, employees.length);
        const batch = employees.slice(batchStart, batchEnd);

        console.log(`📦 Processing batch ${batchIndex + 1}/${totalBatches} (${batch.length} employees)`);
        updateProgress(batchIndex + 1);

        // Process batch with error handling
        const batchResults = await this.processBatch(batch, batchStart);
        results.push(...batchResults);

        // Update counters
        batchResults.forEach(result => {
          if (result.success) {
            completed++;
          } else {
            failed++;
          }
        });

        // Add delay between batches (except for the last batch)
        if (batchIndex < totalBatches - 1) {
          await this.delay(RATE_LIMIT_CONFIG.delayBetweenBatches);
        }
      }

      // Final progress update
      if (onProgress) {
        onProgress({
          total: employees.length,
          completed,
          failed,
          inProgress: false,
          currentBatch: totalBatches,
          totalBatches,
        });
      }

      console.log(`✅ Bulk upload completed: ${completed} successful, ${failed} failed`);
      return results;

    } catch (error) {
      console.error('❌ Bulk upload failed:', error);
      
      // Final progress update with error state
      if (onProgress) {
        onProgress({
          total: employees.length,
          completed,
          failed,
          inProgress: false,
          currentBatch: totalBatches,
          totalBatches,
        });
      }
      
      throw error;
    }
  }

  /**
   * Process a batch of employees with individual error handling
   */
  private async processBatch(
    employees: PlandayEmployeeCreateRequest[],
    startIndex: number
  ): Promise<EmployeeUploadResult[]> {
    const batchResults: EmployeeUploadResult[] = [];

    for (let i = 0; i < employees.length; i++) {
      const employee = employees[i];
      const rowIndex = startIndex + i;

      try {
        const response = await this.createEmployee(employee);
        
        batchResults.push({
          employee,
          success: true,
          plandayId: response.data?.id || (response as any).id, // Handle both wrapped and unwrapped responses
          rowIndex,
        });

        console.log(`✅ Created employee: ${employee.firstName} ${employee.lastName} (ID: ${response.data?.id || (response as any).id})`);

      } catch (error) {
        const errorMessage = error instanceof PlandayApiError 
          ? error.message 
          : error instanceof Error 
            ? error.message 
            : 'Unknown error';

        batchResults.push({
          employee,
          success: false,
          error: errorMessage,
          rowIndex,
        });

        console.log(`❌ Failed to create employee: ${employee.firstName} ${employee.lastName} - ${errorMessage}`);

        // Handle rate limiting with exponential backoff
        if (error instanceof PlandayApiError && error.statusCode === PlandayErrorCodes.TooManyRequests) {
          console.log('⏳ Rate limit hit, applying exponential backoff...');
          await this.handleRateLimit();
        }
      }
    }

    return batchResults;
  }

  /**
   * Handle rate limiting with exponential backoff
   */
  private async handleRateLimit(attempt: number = 1): Promise<void> {
    if (attempt > RATE_LIMIT_CONFIG.maxRetries) {
      throw new Error('Maximum rate limit retries exceeded');
    }

    const delay = RATE_LIMIT_CONFIG.exponentialBackoffBase * Math.pow(2, attempt - 1);
    console.log(`⏳ Rate limit backoff: waiting ${delay}ms (attempt ${attempt})`);
    
    await this.delay(delay);
  }

  /**
   * Utility function to add delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test API connectivity with detailed error reporting
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.fetchDepartments();
      return true;
    } catch (error) {
      console.error('❌ API connection test failed:', error);
      
      // Clear tokens if authentication failed
      if (error instanceof PlandayApiError && 
          (error.statusCode === PlandayErrorCodes.Unauthorized || 
           error.statusCode === PlandayErrorCodes.InsufficientScope)) {

        this.clearStoredTokens();
      }
      
      return false;
    }
  }

  /**
   * Token storage methods
   */
  private loadStoredTokens(): void {
    try {
      this.refreshToken = sessionStorage.getItem(TOKEN_CONFIG.STORAGE_KEY_REFRESH_TOKEN);
      this.accessToken = sessionStorage.getItem(TOKEN_CONFIG.STORAGE_KEY_ACCESS_TOKEN);
      
      const expiryString = sessionStorage.getItem(TOKEN_CONFIG.STORAGE_KEY_TOKEN_EXPIRY);
      if (expiryString) {
        this.tokenExpiry = new Date(expiryString);
      }
    } catch (error) {
      console.warn('Failed to load stored tokens:', error);
    }
  }

  private storeTokens(tokens: PlandayAuthTokens): void {
    try {
      sessionStorage.setItem(TOKEN_CONFIG.STORAGE_KEY_ACCESS_TOKEN, tokens.access_token);
      sessionStorage.setItem(TOKEN_CONFIG.STORAGE_KEY_TOKEN_EXPIRY, this.tokenExpiry!.toISOString());
    } catch (error) {
      console.warn('Failed to store tokens:', error);
    }
  }

  private storeRefreshToken(refreshToken: string): void {
    try {
      sessionStorage.setItem(TOKEN_CONFIG.STORAGE_KEY_REFRESH_TOKEN, refreshToken);
    } catch (error) {
      console.warn('Failed to store refresh token:', error);
    }
  }

  private clearStoredTokens(): void {
    try {
      sessionStorage.removeItem(TOKEN_CONFIG.STORAGE_KEY_REFRESH_TOKEN);
      sessionStorage.removeItem(TOKEN_CONFIG.STORAGE_KEY_ACCESS_TOKEN);
      sessionStorage.removeItem(TOKEN_CONFIG.STORAGE_KEY_TOKEN_EXPIRY);
    } catch (error) {
      console.warn('Failed to clear stored tokens:', error);
    }
    
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Set hourly pay rate for employees in an employee group
   * PUT /pay/v1.0/payrates/employeeGroups/{groupId}
   */
  async setEmployeeGroupPayrate(
    groupId: number,
    payload: PayrateSetRequest
  ): Promise<void> {
    try {
      await this.makeAuthenticatedRequest(
        `${API_ENDPOINTS.PAYRATES_BY_GROUP}/${groupId}`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        }
      );
      console.log(`✅ Set pay rate ${payload.rate} for ${payload.employeeIds.length} employees in group ${groupId}`);
    } catch (error) {
      console.error(`❌ Failed to set pay rate for group ${groupId}:`, error);
      throw error;
    }
  }

  /**
   * Bulk set pay rates after employee creation
   * Groups assignments by groupId and rate for efficient API calls
   */
  async bulkSetPayrates(
    assignments: PayrateAssignment[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<PayrateSetResult[]> {
    const results: PayrateSetResult[] = [];

    if (assignments.length === 0) {
      return results;
    }

    console.log(`💰 Setting pay rates for ${assignments.length} employee-group assignments...`);

    // Group assignments by groupId for efficient API calls
    const groupedByGroup = new Map<number, PayrateAssignment[]>();

    assignments.forEach(assignment => {
      if (!groupedByGroup.has(assignment.groupId)) {
        groupedByGroup.set(assignment.groupId, []);
      }
      groupedByGroup.get(assignment.groupId)!.push(assignment);
    });

    let completed = 0;
    const total = assignments.length;

    // Process each group
    for (const [groupId, groupAssignments] of groupedByGroup.entries()) {
      // Further group by rate (API takes array of employeeIds with same rate)
      const groupedByRate = new Map<number, { employeeIds: number[]; validFrom: string; groupName: string }>();

      groupAssignments.forEach(a => {
        if (!groupedByRate.has(a.rate)) {
          groupedByRate.set(a.rate, {
            employeeIds: [],
            validFrom: a.validFrom,
            groupName: a.groupName
          });
        }
        groupedByRate.get(a.rate)!.employeeIds.push(a.employeeId);
      });

      // Make API call for each rate value in this group
      for (const [rate, data] of groupedByRate.entries()) {
        try {
          await this.setEmployeeGroupPayrate(groupId, {
            wageType: 'HourlyRate',
            rate,
            employeeIds: data.employeeIds,
            validFrom: data.validFrom
          });

          // Mark all as successful
          data.employeeIds.forEach(employeeId => {
            results.push({
              employeeId,
              groupId,
              groupName: data.groupName,
              rate,
              success: true
            });
            completed++;
            onProgress?.(completed, total);
          });

        } catch (error) {
          // Mark all as failed
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          data.employeeIds.forEach(employeeId => {
            results.push({
              employeeId,
              groupId,
              groupName: data.groupName,
              rate,
              success: false,
              error: errorMessage
            });
            completed++;
            onProgress?.(completed, total);
          });
        }

        // Rate limit delay between API calls
        await this.delay(RATE_LIMIT_CONFIG.delayBetweenBatches);
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    console.log(`💰 Pay rate results: ${successCount} successful, ${failCount} failed`);

    return results;
  }

  /**
   * Cleanup method to clear all tokens
   */
  cleanup(): void {
    this.clearStoredTokens();
  }
}

/**
 * Custom Error class for Planday API errors
 */
export class PlandayApiError extends Error {
  public statusCode: PlandayErrorCodes;
  public originalError?: any;

  constructor(
    statusCode: PlandayErrorCodes,
    message: string,
    originalError?: any
  ) {
    super(message);
    this.name = 'PlandayApiError';
    this.statusCode = statusCode;
    this.originalError = originalError;
  }

  /**
   * Get user-friendly error message based on status code
   */
  getUserFriendlyMessage(): string {
    switch (this.statusCode) {
      case PlandayErrorCodes.BadRequest:
        return 'Invalid employee data provided. Please check the employee information and try again.';
      case PlandayErrorCodes.Unauthorized:
        return 'Authentication failed. Please check your token and try re-authenticating.';
      case PlandayErrorCodes.InsufficientScope:
        return 'Insufficient permissions. Your token may not have the required scopes for employee creation.';
      case PlandayErrorCodes.NotFound:
        return 'The requested resource was not found. Please verify your department selections.';
      case PlandayErrorCodes.Conflict:
        return 'Data conflict detected. This may be due to duplicate employees or invalid field values.';
      case PlandayErrorCodes.TooManyRequests:
        return 'Too many requests sent to Planday. The system will automatically retry with delays.';
      case PlandayErrorCodes.ServerError:
        return 'Planday server error. Please try again later or contact Planday support if the issue persists.';
      default:
        return this.message || 'An unexpected error occurred while communicating with Planday.';
    }
  }
}

/**
 * Singleton instance of the Planday API client
 */
export const plandayApiClient = new PlandayApiClient();

// ─── Field Discovery Utilities ───────────────────────────────────────────────

/**
 * Fields that only appear in GET responses and should not be offered for mapping
 */
export const RESPONSE_ONLY_FIELDS = new Set([
  'id', 'isActive', 'createdAt', 'updatedAt', 'portalId',
  'deactivatedDate', 'modifiedAt', 'profileImageUrl',
  'initials', 'displayName', 'fullName',
  'departments', 'employeeGroups', 'skills', 'supervisor',
  'userName', // auto-derived from email, should not be mapped independently
]);

/**
 * Core fields that should always be treated as required when they exist on a portal
 */
export const CORE_REQUIRED_FIELDS = ['firstName', 'lastName', 'email'];

/**
 * Extract unique field keys from a sample of employees, excluding response-only fields.
 */
export function discoverFieldsFromEmployees(employees: Record<string, any>[]): string[] {
  const discoveredKeys = new Set<string>();
  for (const emp of employees) {
    for (const key of Object.keys(emp)) {
      if (!RESPONSE_ONLY_FIELDS.has(key)) {
        discoveredKeys.add(key);
      }
    }
  }
  return Array.from(discoveredKeys);
}

/**
 * Merge discovered fields into field definitions.
 * - Adds missing fields to `properties` with a generic string type
 * - For core required fields (firstName, lastName, email): adds to `required[]` if not already present
 * Returns list of newly added field keys.
 */
export function mergeDiscoveredFields(
  fieldDefinitions: PlandayFieldDefinitionsSchema,
  discoveredFields: string[]
): string[] {
  const newFields: string[] = [];

  // Ensure required array exists (some portals omit it from API response)
  if (!fieldDefinitions.required) {
    fieldDefinitions.required = [];
  }

  for (const field of discoveredFields) {
    if (!fieldDefinitions.properties[field]) {
      fieldDefinitions.properties[field] = {
        type: 'string',
        description: 'Discovered from existing employee data',
      };
      newFields.push(field);
    }

    // Ensure core required fields are in the required array
    if (
      CORE_REQUIRED_FIELDS.includes(field) &&
      !fieldDefinitions.required.includes(field)
    ) {
      fieldDefinitions.required.push(field);
    }
  }

  if (newFields.length > 0) {
    console.log(`✅ Discovered ${newFields.length} additional fields from employee data:`, newFields);
  } else {
    console.log('ℹ️ No additional fields discovered from employee data');
  }

  return newFields;
}

/**
 * Convenience functions for common operations
 */
export const PlandayApi = {
  /**
   * Initialize with refresh token
   */
  async init(refreshToken: string): Promise<void> {
    return plandayApiClient.initialize(refreshToken);
  },

  /**
   * Check authentication status
   */
  isAuthenticated(): boolean {
    return plandayApiClient.isAuthenticated();
  },

  /**
   * Fetch departments
   */
  async getDepartments(): Promise<PlandayDepartment[]> {
    return plandayApiClient.fetchDepartments();
  },

  /**
   * Fetch employee groups
   */
  async getEmployeeGroups(): Promise<PlandayEmployeeGroup[]> {
    return plandayApiClient.fetchEmployeeGroups();
  },

  /**
   * Fetch employee types
   */
  async getEmployeeTypes(): Promise<PlandayEmployeeType[]> {
    return plandayApiClient.fetchEmployeeTypes();
  },

  /**
   * Fetch all supervisors
   */
  async getSupervisors(): Promise<PlandaySupervisor[]> {
    return plandayApiClient.fetchSupervisors();
  },

  /**
   * Fetch all skills
   */
  async getSkills(): Promise<PlandaySkill[]> {
    return plandayApiClient.fetchSkills();
  },

  /**
   * Bulk assign supervisors to employees after creation
   */
  async bulkAssignSupervisors(
    assignments: Array<{ employeeId: number; supervisorId: number; supervisorName: string }>,
    onProgress?: (completed: number, total: number) => void
  ): Promise<Array<{ employeeId: number; supervisorId: number; supervisorName: string; success: boolean; error?: string }>> {
    return plandayApiClient.bulkAssignSupervisors(assignments, onProgress);
  },

  /**
   * Fetch all salary types
   */
  async getSalaryTypes(): Promise<PlandaySalaryType[]> {
    return plandayApiClient.fetchSalaryTypes();
  },

  /**
   * Bulk assign fixed salaries to employees after creation
   */
  async bulkAssignFixedSalaries(
    assignments: FixedSalaryAssignment[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<FixedSalarySetResult[]> {
    return plandayApiClient.bulkAssignFixedSalaries(assignments, onProgress);
  },

  /**
   * Fetch all contract rules
   */
  async getContractRules(): Promise<PlandayContractRule[]> {
    return plandayApiClient.fetchContractRules();
  },

  /**
   * Assign a contract rule to an employee (inline after creation)
   */
  async assignContractRule(employeeId: number, contractRuleId: number): Promise<void> {
    return plandayApiClient.assignContractRule(employeeId, contractRuleId);
  },

  /**
   * Create a single employee
   */
  async createEmployee(employee: PlandayEmployeeCreateRequest): Promise<{ data: PlandayEmployeeResponse }> {
    return plandayApiClient.createEmployee(employee);
  },

  /**
   * Assign fixed salary to an employee (inline after creation)
   */
  async assignFixedSalary(
    employeeId: number,
    salaryTypeId: number,
    hours: number,
    salary: number,
    validFrom: string
  ): Promise<void> {
    return plandayApiClient.assignFixedSalary(employeeId, salaryTypeId, hours, salary, validFrom);
  },

  /**
   * Set payrate for an employee in a specific group (inline after creation)
   */
  async setEmployeeGroupPayrate(groupId: number, payload: PayrateSetRequest): Promise<void> {
    return plandayApiClient.setEmployeeGroupPayrate(groupId, payload);
  },

  /**
   * Assign supervisor to an employee (deferred until all employees created)
   */
  async assignSupervisorToEmployee(employeeId: number, supervisorRecordId: number): Promise<void> {
    return plandayApiClient.assignSupervisorToEmployee(employeeId, supervisorRecordId);
  },

  /**
   * Fetch portal information
   */
  async getPortalInfo(): Promise<PlandayPortalInfo> {
    return plandayApiClient.fetchPortalInfo();
  },

  /**
   * Fetch employee field definitions
   */
  async getFieldDefinitions(type: 'Post' | 'Put' = 'Post'): Promise<PlandayFieldDefinitionsSchema> {
    return plandayApiClient.fetchEmployeeFieldDefinitions(type);
  },

  /**
   * Fetch a small sample of employees for field discovery
   */
  async fetchEmployeeSample(sampleSize: number = 5): Promise<Record<string, any>[]> {
    return plandayApiClient.fetchEmployeeSample(sampleSize);
  },

  /**
   * Test connection
   */
  async testConnection(): Promise<boolean> {
    return plandayApiClient.testConnection();
  },

  /**
   * Bulk upload employees (best-effort)
   */
  async uploadEmployees(
    employees: PlandayEmployeeCreateRequest[],
    onProgress?: (progress: BulkUploadProgress) => void
  ): Promise<EmployeeUploadResult[]> {
    return plandayApiClient.bulkUploadEmployees(employees, onProgress);
  },

  /**
   * Atomic upload employees (stops on first failure)
   */
  async atomicUploadEmployees(
    employees: PlandayEmployeeCreateRequest[],
    onProgress?: (progress: BulkUploadProgress) => void
  ): Promise<EmployeeUploadResult[]> {
    return plandayApiClient.atomicUploadEmployees(employees, onProgress);
  },

  /**
   * Fetch employees for verification
   */
  async fetchEmployees(limit: number = 100, offset: number = 0, special?: string): Promise<{
    employees: PlandayEmployeeResponse[];
    total: number;
    hasMore: boolean;
  }> {
    return plandayApiClient.fetchEmployees(limit, offset, special);
  },

  /**
   * Fetch specific employees by IDs for verification
   */
  async fetchEmployeesByIds(employeeIds: number[]): Promise<PlandayEmployeeResponse[]> {
    return plandayApiClient.fetchEmployeesByIds(employeeIds);
  },

  /**
   * Bulk set pay rates for employees in employee groups
   */
  async bulkSetPayrates(
    assignments: PayrateAssignment[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<PayrateSetResult[]> {
    return plandayApiClient.bulkSetPayrates(assignments, onProgress);
  },

  /**
   * Cleanup
   */
  cleanup(): void {
    plandayApiClient.cleanup();
  },

  /**
   * Check if employees with specific email addresses already exist in Planday
   * Returns a map of email -> existing employee data
   */
  async checkExistingEmployeesByEmail(emailAddresses: string[]): Promise<Map<string, PlandayEmployeeResponse>> {
    return plandayApiClient.checkExistingEmployeesByEmail(emailAddresses);
  },

  /**
   * Check if employees with specific SSNs already exist in Planday
   * Returns a map of SSN -> existing employee data
   */
  async checkExistingEmployeesBySsn(ssnValues: string[]): Promise<SsnExistenceCheckResult> {
    return plandayApiClient.checkExistingEmployeesBySsn(ssnValues);
  },
};