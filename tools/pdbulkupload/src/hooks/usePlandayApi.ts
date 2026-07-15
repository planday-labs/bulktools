/**
 * Planday API React Hook
 * Provides centralized state management for Planday API operations
 * Features:
 * - Authentication state management
 * - Department and employee group caching
 * - Error handling with user-friendly messages
 * - Loading states for UI components
 * - Automatic cleanup on unmount
 */

import { useState, useEffect, useCallback } from 'react';
import { PlandayApi, PlandayApiError, discoverFieldsFromEmployees, mergeDiscoveredFields } from '../services/plandayApi';
import { MappingUtils, ValidationService, FieldDefinitionValidator } from '../services/mappingService';
import type {
  PlandayDepartment,
  PlandayEmployeeGroup,
  PlandayEmployeeType,
  PlandaySupervisor,
  PlandaySkill,
  PlandaySalaryType,
  PlandayContractRule,
  PlandayEmployeeResponse,
  SsnExistenceCheckResult,
  PlandayEmployeeCreateRequest,
  EmployeeUploadResult,
  BulkUploadProgress,
  PlandayFieldDefinitionsSchema,
  PlandayPortalInfo,
  PayrateAssignment,
  PayrateSetResult,
  FixedSalaryAssignment,
  FixedSalarySetResult,
} from '../types/planday';

interface PlandayApiState {
  // Authentication state
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  authError: string | null;
  

  
  // Portal information
  portalInfo: PlandayPortalInfo | null;
  
  // Department state
  departments: PlandayDepartment[];
  isDepartmentsLoading: boolean;
  departmentsError: string | null;
  
  // Employee group state
  employeeGroups: PlandayEmployeeGroup[];
  isEmployeeGroupsLoading: boolean;
  employeeGroupsError: string | null;
  
  // Employee type state
  employeeTypes: PlandayEmployeeType[];
  isEmployeeTypesLoading: boolean;
  employeeTypesError: string | null;

  // Supervisor state
  supervisors: PlandaySupervisor[];
  isSupervisorsLoading: boolean;
  supervisorsError: string | null;

  // Skills state
  skills: PlandaySkill[];
  isSkillsLoading: boolean;
  skillsError: string | null;

  // Salary type state
  salaryTypes: PlandaySalaryType[];
  isSalaryTypesLoading: boolean;
  salaryTypesError: string | null;

  // Contract rule state
  contractRules: PlandayContractRule[];
  isContractRulesLoading: boolean;
  contractRulesError: string | null;

  // Field definitions state
  fieldDefinitions: PlandayFieldDefinitionsSchema | null;
  isFieldDefinitionsLoading: boolean;
  fieldDefinitionsError: string | null;
  
  // Upload state
  isUploading: boolean;
  uploadProgress: BulkUploadProgress | null;
  uploadError: string | null;
}

interface PlandayApiActions {
  // Authentication actions
  authenticate: (refreshToken: string) => Promise<boolean>;
  logout: () => void;
  
  // Data fetching actions
  refreshDepartments: () => Promise<void>;
  refreshEmployeeGroups: () => Promise<void>;
  refreshEmployeeTypes: () => Promise<void>;
  refreshSupervisors: () => Promise<void>;
  refreshSkills: () => Promise<void>;
  refreshSalaryTypes: () => Promise<PlandaySalaryType[]>;
  refreshFieldDefinitions: () => Promise<void>;
  refreshPortalInfo: () => Promise<void>;
  refreshPlandayData: () => Promise<void>;
  resyncPortalData: () => Promise<void>;
  
  // Upload actions
  uploadEmployees: (
    employees: PlandayEmployeeCreateRequest[],
    onProgress?: (progress: BulkUploadProgress) => void
  ) => Promise<EmployeeUploadResult[]>;
  
  atomicUploadEmployees: (
    employees: PlandayEmployeeCreateRequest[],
    onProgress?: (progress: BulkUploadProgress) => void
  ) => Promise<EmployeeUploadResult[]>;
  
  // Employee fetching for verification
  fetchEmployees: (
    limit?: number,
    offset?: number
  ) => Promise<{
    employees: PlandayEmployeeResponse[];
    total: number;
    hasMore: boolean;
  }>;
  
  fetchEmployeesByIds: (
    employeeIds: number[]
  ) => Promise<PlandayEmployeeResponse[]>;
  
  // Duplicate checking for validation
  checkExistingEmployeesByEmail: (
    emailAddresses: string[]
  ) => Promise<Map<string, PlandayEmployeeResponse>>;

  checkExistingEmployeesBySsn: (
    ssnValues: string[]
  ) => Promise<SsnExistenceCheckResult>;

  // Pay rate actions
  bulkSetPayrates: (
    assignments: PayrateAssignment[],
    onProgress?: (completed: number, total: number) => void
  ) => Promise<PayrateSetResult[]>;

  // Supervisor assignment actions
  bulkAssignSupervisors: (
    assignments: Array<{ employeeId: number; supervisorId: number; supervisorName: string }>,
    onProgress?: (completed: number, total: number) => void
  ) => Promise<Array<{ employeeId: number; supervisorId: number; supervisorName: string; success: boolean; error?: string }>>;

  // Fixed salary assignment actions
  bulkAssignFixedSalaries: (
    assignments: FixedSalaryAssignment[],
    onProgress?: (completed: number, total: number) => void
  ) => Promise<FixedSalarySetResult[]>;

  // Contract rule assignment action (inline after employee creation)
  assignContractRule: (employeeId: number, contractRuleId: number) => Promise<void>;

  // Single employee operations (for sequential inline processing)
  createEmployee: (employee: PlandayEmployeeCreateRequest) => Promise<{ data: PlandayEmployeeResponse }>;
  assignFixedSalary: (employeeId: number, salaryTypeId: number, hours: number, salary: number, validFrom: string) => Promise<void>;
  setEmployeeGroupPayrate: (groupId: number, employeeId: number, rate: number, validFrom: string) => Promise<void>;
  assignSupervisorToEmployee: (employeeId: number, supervisorRecordId: number) => Promise<void>;

  // Utility actions
  testConnection: () => Promise<boolean>;
  clearErrors: () => void;

  // Diagnostic actions for debugging field inconsistencies
  diagnoseFieldInconsistencies: () => ReturnType<typeof ValidationService.diagnoseFieldInconsistencies>;
}

export interface UsePlandayApiReturn extends PlandayApiState, PlandayApiActions {}

/**
 * Hook for managing Planday API state and operations
 */
// Global counter to track hook instances
let hookInstanceCounter = 0;

export const usePlandayApi = (): UsePlandayApiReturn => {
  // Debug hook lifecycle with unique ID
  const instanceId = ++hookInstanceCounter;
  
  const [state, setState] = useState<PlandayApiState>({
    // Authentication state
    isAuthenticated: false,
    isAuthenticating: false,
    authError: null,
    

    
    // Portal information
    portalInfo: null,
    
    // Department state
    departments: [],
    isDepartmentsLoading: false,
    departmentsError: null,
    
    // Employee group state
    employeeGroups: [],
    isEmployeeGroupsLoading: false,
    employeeGroupsError: null,
    
    // Employee type state
    employeeTypes: [],
    isEmployeeTypesLoading: false,
    employeeTypesError: null,

    // Supervisor state
    supervisors: [],
    isSupervisorsLoading: false,
    supervisorsError: null,

    // Skills state
    skills: [],
    isSkillsLoading: false,
    skillsError: null,

    // Salary type state
    salaryTypes: [],
    isSalaryTypesLoading: false,
    salaryTypesError: null,

    // Contract rule state
    contractRules: [],
    isContractRulesLoading: false,
    contractRulesError: null,

    // Field definitions state
    fieldDefinitions: null,
    isFieldDefinitionsLoading: false,
    fieldDefinitionsError: null,
    
    // Upload state
    isUploading: false,
    uploadProgress: null,
    uploadError: null,
  });

  /**
   * Update state with partial updates
   */
  const updateState = useCallback((updates: Partial<PlandayApiState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  /**
   * Handle errors with user-friendly messages
   */
  const handleError = useCallback((error: unknown): string => {
    console.error('Planday API Error:', error);
    
    if (error instanceof PlandayApiError) {
      return error.getUserFriendlyMessage();
    } else if (error instanceof Error) {
      return error.message;
    } else {
      return 'An unexpected error occurred. Please try again.';
    }
  }, []);

  /**
   * Authenticate with Planday using refresh token
   */
  const authenticate = useCallback(async (refreshToken: string): Promise<boolean> => {
    updateState({ 
      isAuthenticating: true, 
      authError: null 
    });

    try {
      // Initialize API client
      await PlandayApi.init(refreshToken);
      
      // Fetch portal information and set up phone parsing
      let portalInfo = null;
      try {
        portalInfo = await PlandayApi.getPortalInfo();
        
        // Set up phone parser with portal country
        const { PhoneParser } = await import('../utils');
        PhoneParser.setPortalCountry(portalInfo.country);
      } catch (portalError) {
        console.warn('⚠️ Could not fetch portal info, using default phone parsing:', portalError);
        // Continue with authentication even if portal info fails
      }
      
      // Helper for optional fetches that return empty array on failure (e.g., CORS issues)
      const fetchOptional = async <T>(
        fetchFn: () => Promise<T[]>,
        name: string
      ): Promise<T[]> => {
        try {
          return await fetchFn();
        } catch (error) {
          console.warn(`⚠️ Could not fetch ${name}, feature will be unavailable:`, error);
          return [];
        }
      };

      // Test connection and fetch initial data
      const [departments, employeeGroups, employeeTypes, supervisors, skills, salaryTypes, contractRules, fieldDefinitions, employeeSample] = await Promise.all([
        PlandayApi.getDepartments(),
        PlandayApi.getEmployeeGroups(),
        PlandayApi.getEmployeeTypes(),
        PlandayApi.getSupervisors(),
        PlandayApi.getSkills(),
        PlandayApi.getSalaryTypes(),
        fetchOptional(() => PlandayApi.getContractRules(), 'contract rules'),
        PlandayApi.getFieldDefinitions(),
        PlandayApi.fetchEmployeeSample(5)
      ]);

      // Discover and merge fields from employee sample before initializing services
      if (employeeSample.length > 0) {
        const discoveredFields = discoverFieldsFromEmployees(employeeSample);
        mergeDiscoveredFields(fieldDefinitions, discoveredFields);
      }

      // Initialize services with fetched data
      MappingUtils.initialize(departments, employeeGroups, employeeTypes);
      MappingUtils.setSupervisors(supervisors);
      MappingUtils.setSkills(skills);
      MappingUtils.setSalaryTypes(salaryTypes);
      MappingUtils.setContractRules(contractRules);
      ValidationService.initialize(fieldDefinitions);
      FieldDefinitionValidator.initialize(fieldDefinitions);

      updateState({
        isAuthenticated: true,
        isAuthenticating: false,
        portalInfo,
        departments,
        employeeGroups,
        employeeTypes,
        supervisors,
        skills,
        salaryTypes,
        contractRules,
        fieldDefinitions,
        authError: null,
      });

      return true;

    } catch (error) {
      const errorMessage = handleError(error);
      updateState({
        isAuthenticated: false,
        isAuthenticating: false,
        authError: errorMessage,
        portalInfo: null,
        departments: [],
        employeeGroups: [],
        employeeTypes: [],
        supervisors: [],
        skills: [],
        salaryTypes: [],
        contractRules: [],
      });

      return false;
    }
  }, [updateState, handleError]);

  /**
   * Logout and cleanup
   */
  const logout = useCallback(() => {
    PlandayApi.cleanup();
    
          setState({
      // Reset authentication state
      isAuthenticated: false,
      isAuthenticating: false,
      authError: null,
      
      // Reset portal information
      portalInfo: null,
      
      // Reset department state
      departments: [],
      isDepartmentsLoading: false,
      departmentsError: null,
      
      // Reset employee group state
      employeeGroups: [],
      isEmployeeGroupsLoading: false,
      employeeGroupsError: null,
      
      // Reset employee type state
      employeeTypes: [],
      isEmployeeTypesLoading: false,
      employeeTypesError: null,

      // Reset supervisor state
      supervisors: [],
      isSupervisorsLoading: false,
      supervisorsError: null,

      // Reset skills state
      skills: [],
      isSkillsLoading: false,
      skillsError: null,

      // Reset salary type state
      salaryTypes: [],
      isSalaryTypesLoading: false,
      salaryTypesError: null,

      // Reset contract rule state
      contractRules: [],
      isContractRulesLoading: false,
      contractRulesError: null,

      // Reset field definitions state
      fieldDefinitions: null,
      isFieldDefinitionsLoading: false,
      fieldDefinitionsError: null,
      
      // Reset upload state
      isUploading: false,
      uploadProgress: null,
      uploadError: null,
    });

    console.log('🔐 Logged out successfully');
  }, []);

  /**
   * Refresh departments from Planday
   */
  const refreshDepartments = useCallback(async (): Promise<void> => {
    if (!state.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    updateState({ 
      isDepartmentsLoading: true,
      departmentsError: null
    });

    try {
      // Fetch departments
      const departments = await PlandayApi.getDepartments();
      
      updateState({
        departments,
        isDepartmentsLoading: false,
        departmentsError: null,
      });

      // Initialize mapping service if we have employee groups and employee types too
      if (state.employeeGroups && state.employeeGroups.length > 0 && state.employeeTypes) {
        MappingUtils.initialize(departments, state.employeeGroups, state.employeeTypes);
      }

      console.log(`✅ Refreshed ${departments.length} departments`);

    } catch (error) {
      const errorMessage = handleError(error);
      updateState({
        isDepartmentsLoading: false,
        departmentsError: errorMessage,
      });
      
      throw error;
    }
  }, [state.isAuthenticated, state.employeeGroups, updateState, handleError]);

  /**
   * Refresh employee groups from Planday
   */
  const refreshEmployeeGroups = useCallback(async (): Promise<void> => {
    if (!state.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    updateState({ 
      isEmployeeGroupsLoading: true,
      employeeGroupsError: null
    });

    try {
      // Fetch employee groups
      const employeeGroups = await PlandayApi.getEmployeeGroups();
      
      updateState({
        employeeGroups,
        isEmployeeGroupsLoading: false,
        employeeGroupsError: null,
      });

      // Initialize mapping service if we have departments and employee types too
      if (state.departments && state.departments.length > 0 && state.employeeTypes) {
        MappingUtils.initialize(state.departments, employeeGroups, state.employeeTypes);
      }

      console.log(`✅ Refreshed ${employeeGroups.length} employee groups`);

    } catch (error) {
      const errorMessage = handleError(error);
      updateState({
        isEmployeeGroupsLoading: false,
        employeeGroupsError: errorMessage,
      });
      
      throw error;
    }
  }, [state.isAuthenticated, state.departments, updateState, handleError]);

  /**
   * Refresh employee types from Planday
   */
  const refreshEmployeeTypes = useCallback(async (): Promise<void> => {
    if (!state.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    updateState({ 
      isEmployeeTypesLoading: true,
      employeeTypesError: null
    });

    try {
      // Fetch employee types
      const employeeTypes = await PlandayApi.getEmployeeTypes();
      
      updateState({
        employeeTypes,
        isEmployeeTypesLoading: false,
        employeeTypesError: null,
      });

      // Initialize mapping service if we have departments and employee groups too
      if (state.departments && state.departments.length > 0 && state.employeeGroups && state.employeeGroups.length > 0) {
        MappingUtils.initialize(state.departments, state.employeeGroups, employeeTypes);
      }

      console.log(`✅ Refreshed ${employeeTypes.length} employee types`);

    } catch (error) {
      const errorMessage = handleError(error);
      updateState({
        isEmployeeTypesLoading: false,
        employeeTypesError: errorMessage,
      });
      
      throw error;
    }
  }, [state.isAuthenticated, state.departments, state.employeeGroups, updateState, handleError]);

  /**
   * Refresh supervisors from Planday
   */
  const refreshSupervisors = useCallback(async (): Promise<void> => {
    // Use PlandayApi.isAuthenticated() instead of state to avoid stale closure issues
    if (!PlandayApi.isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    updateState({
      isSupervisorsLoading: true,
      supervisorsError: null
    });

    try {
      const supervisors = await PlandayApi.getSupervisors();

      updateState({
        supervisors,
        isSupervisorsLoading: false,
        supervisorsError: null,
      });

      // Update mapping service with supervisors
      MappingUtils.setSupervisors(supervisors);

      console.log(`✅ Refreshed ${supervisors.length} supervisors`);

    } catch (error) {
      const errorMessage = handleError(error);
      updateState({
        isSupervisorsLoading: false,
        supervisorsError: errorMessage,
      });

      throw error;
    }
  }, [updateState, handleError]);

  /**
   * Refresh skills from Planday
   */
  const refreshSkills = useCallback(async (): Promise<void> => {
    if (!state.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    updateState({
      isSkillsLoading: true,
      skillsError: null
    });

    try {
      const skills = await PlandayApi.getSkills();

      updateState({
        skills,
        isSkillsLoading: false,
        skillsError: null,
      });

      // Update mapping service with skills
      MappingUtils.setSkills(skills);

      console.log(`✅ Refreshed ${skills.length} skills`);

    } catch (error) {
      const errorMessage = handleError(error);
      updateState({
        isSkillsLoading: false,
        skillsError: errorMessage,
      });

      throw error;
    }
  }, [state.isAuthenticated, updateState, handleError]);

  /**
   * Refresh salary types from Planday (lazy loaded - only when fixed salary feature is needed)
   */
  const refreshSalaryTypes = useCallback(async (): Promise<PlandaySalaryType[]> => {
    if (!state.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    updateState({
      isSalaryTypesLoading: true,
      salaryTypesError: null
    });

    try {
      const salaryTypes = await PlandayApi.getSalaryTypes();

      updateState({
        salaryTypes,
        isSalaryTypesLoading: false,
        salaryTypesError: null,
      });

      // Update mapping service with salary types
      MappingUtils.setSalaryTypes(salaryTypes);

      console.log(`✅ Fetched ${salaryTypes.length} salary types`);
      return salaryTypes;

    } catch (error) {
      const errorMessage = handleError(error);
      updateState({
        isSalaryTypesLoading: false,
        salaryTypesError: errorMessage,
      });

      throw error;
    }
  }, [state.isAuthenticated, updateState, handleError]);

  /**
   * Refresh field definitions from Planday
   */
  const refreshFieldDefinitions = useCallback(async (): Promise<void> => {
    if (!state.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    updateState({ 
      isFieldDefinitionsLoading: true,
      fieldDefinitionsError: null
    });

    try {
      // Fetch field definitions and employee sample in parallel
      const [fieldDefinitions, employeeSample] = await Promise.all([
        PlandayApi.getFieldDefinitions(),
        PlandayApi.fetchEmployeeSample(5)
      ]);

      // Discover and merge fields from employee sample
      if (employeeSample.length > 0) {
        const discoveredFields = discoverFieldsFromEmployees(employeeSample);
        mergeDiscoveredFields(fieldDefinitions, discoveredFields);
      }

      updateState({
        fieldDefinitions,
        isFieldDefinitionsLoading: false,
        fieldDefinitionsError: null,
      });

      // Initialize validation services with field definitions
      ValidationService.initialize(fieldDefinitions);
      FieldDefinitionValidator.initialize(fieldDefinitions);

      console.log(`✅ Refreshed field definitions`);

    } catch (error) {
      const errorMessage = handleError(error);
      updateState({
        isFieldDefinitionsLoading: false,
        fieldDefinitionsError: errorMessage,
      });

      throw error;
    }
  }, [state.isAuthenticated, updateState, handleError]);

  /**
   * Refresh portal information from Planday
   */
  const refreshPortalInfo = useCallback(async (): Promise<void> => {
    if (!state.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    try {
      // Fetch portal information
      const portalInfo = await PlandayApi.getPortalInfo();
      
      updateState({
        portalInfo,
      });

      // Set up phone parser with portal country
      const { PhoneParser } = await import('../utils');
      PhoneParser.setPortalCountry(portalInfo.country);

      console.log(`✅ Refreshed portal info: ${portalInfo.companyName} (${portalInfo.country})`);

    } catch (error) {
      console.warn('⚠️ Could not refresh portal info, phone parsing will use defaults:', error);
      // Don't throw error as portal info is not critical for basic functionality
    }
  }, [state.isAuthenticated, updateState]);

  /**
   * Refresh all Planday data (departments, employee groups, field definitions, portal info)
   */
  const refreshPlandayData = useCallback(async (): Promise<void> => {
    if (!state.isAuthenticated) {
      throw new Error('Not authenticated');
    }

    // Fetch all data in parallel for better performance
    try {
      await Promise.all([
        refreshDepartments(),
        refreshEmployeeGroups(),
        refreshEmployeeTypes(),
        refreshSupervisors(),
        refreshSkills(),
        refreshFieldDefinitions(),
        refreshPortalInfo(),
      ]);

      console.log('✅ All Planday data refreshed successfully');
    } catch (error) {
      console.error('❌ Failed to refresh some Planday data:', error);
      throw error;
    }
  }, [state.isAuthenticated, refreshDepartments, refreshEmployeeGroups, refreshEmployeeTypes, refreshSupervisors, refreshSkills, refreshFieldDefinitions, refreshPortalInfo]);

  /**
   * Resync all portal option data (departments, employee groups, employee types,
   * supervisors, skills, salary types, contract rules, field definitions) in a single
   * pass and re-initialize every cache layer at once.
   *
   * Unlike refreshPlandayData (which runs the per-field refreshers in parallel, each
   * re-initializing MappingUtils from a partially-stale state snapshot), this fetches
   * everything first and then re-initializes the services once with the complete, fresh
   * dataset — mirroring the initial load in authenticate(). This avoids the partial-refresh
   * trap where a newly-created portal option is missed because one cache layer kept old data.
   *
   * It refreshes only the portal's option lists — it never touches the user's mapped or
   * corrected employee rows.
   */
  const resyncPortalData = useCallback(async (): Promise<void> => {
    if (!PlandayApi.isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    // Helper for optional fetches that return empty array on failure (e.g., CORS issues)
    const fetchOptional = async <T>(
      fetchFn: () => Promise<T[]>,
      name: string
    ): Promise<T[]> => {
      try {
        return await fetchFn();
      } catch (error) {
        console.warn(`⚠️ Could not fetch ${name}, feature will be unavailable:`, error);
        return [];
      }
    };

    // Fetch everything in parallel before touching any cache
    const [departments, employeeGroups, employeeTypes, supervisors, skills, salaryTypes, contractRules, fieldDefinitions, employeeSample] = await Promise.all([
      PlandayApi.getDepartments(),
      PlandayApi.getEmployeeGroups(),
      PlandayApi.getEmployeeTypes(),
      PlandayApi.getSupervisors(),
      PlandayApi.getSkills(),
      PlandayApi.getSalaryTypes(),
      fetchOptional(() => PlandayApi.getContractRules(), 'contract rules'),
      PlandayApi.getFieldDefinitions(),
      PlandayApi.fetchEmployeeSample(5)
    ]);

    // Discover and merge fields from employee sample before initializing services
    if (employeeSample.length > 0) {
      const discoveredFields = discoverFieldsFromEmployees(employeeSample);
      mergeDiscoveredFields(fieldDefinitions, discoveredFields);
    }

    // Re-initialize all cache layers once with the complete fresh dataset
    MappingUtils.initialize(departments, employeeGroups, employeeTypes);
    MappingUtils.setSupervisors(supervisors);
    MappingUtils.setSkills(skills);
    MappingUtils.setSalaryTypes(salaryTypes);
    MappingUtils.setContractRules(contractRules);
    ValidationService.initialize(fieldDefinitions);
    FieldDefinitionValidator.initialize(fieldDefinitions);

    // Refresh portal info / phone parser country (non-critical)
    try {
      const portalInfo = await PlandayApi.getPortalInfo();
      const { PhoneParser } = await import('../utils');
      PhoneParser.setPortalCountry(portalInfo.country);
      updateState({ portalInfo });
    } catch (error) {
      console.warn('⚠️ Could not refresh portal info during resync:', error);
    }

    // Push fresh data into hook state (new array references trigger downstream re-validation)
    updateState({
      departments,
      employeeGroups,
      employeeTypes,
      supervisors,
      skills,
      salaryTypes,
      contractRules,
      fieldDefinitions,
    });

    console.log('✅ Portal data resynced and all caches re-initialized');
  }, [updateState]);

  /**
   * Upload employees to Planday
   */
  const uploadEmployees = useCallback(async (
    employees: PlandayEmployeeCreateRequest[],
    onProgress?: (progress: BulkUploadProgress) => void
  ): Promise<EmployeeUploadResult[]> => {
    // Check both hook state and API client state
    const apiAuthenticated = PlandayApi.isAuthenticated();
    
    // Sync hook state with API client state if they're out of sync
    if (state.isAuthenticated !== apiAuthenticated) {
      console.log('🔄 Syncing hook state with API client state (uploadEmployees):', {
        before: state.isAuthenticated,
        after: apiAuthenticated
      });
      updateState({ isAuthenticated: apiAuthenticated });
    }
    
    // Use the API client state as the source of truth
    if (!apiAuthenticated) {
      throw new Error('Not authenticated with Planday. Please re-authenticate.');
    }

    updateState({ 
      isUploading: true, 
      uploadError: null,
      uploadProgress: null 
    });

    try {
      const results = await PlandayApi.uploadEmployees(employees, (progress) => {
        updateState({ uploadProgress: progress });
        if (onProgress) {
          onProgress(progress);
        }
      });

      updateState({
        isUploading: false,
        uploadProgress: null,
        uploadError: null,
      });

              // Bulk upload completed successfully
      return results;

    } catch (error) {
      const errorMessage = handleError(error);
      updateState({
        isUploading: false,
        uploadError: errorMessage,
      });
      
      throw error;
    }
  }, [state.isAuthenticated, updateState, handleError]);

  /**
   * Atomic upload employees to Planday (stop on first failure)
   */
  const atomicUploadEmployees = useCallback(async (
    employees: PlandayEmployeeCreateRequest[],
    onProgress?: (progress: BulkUploadProgress) => void
  ): Promise<EmployeeUploadResult[]> => {
    // Check both hook state and API client state
    const apiAuthenticated = PlandayApi.isAuthenticated();

    
    // Sync hook state with API client state if they're out of sync
    if (state.isAuthenticated !== apiAuthenticated) {
      console.log('🔄 Syncing hook state with API client state:', {
        before: state.isAuthenticated,
        after: apiAuthenticated
      });
      updateState({ isAuthenticated: apiAuthenticated });
    }
    
    // Use the API client state as the source of truth
    if (!apiAuthenticated) {
      throw new Error('Not authenticated with Planday. Please re-authenticate.');
    }

    updateState({ 
      isUploading: true, 
      uploadError: null,
      uploadProgress: null 
    });

    try {
      const results = await PlandayApi.atomicUploadEmployees(employees, (progress) => {
        updateState({ uploadProgress: progress });
        if (onProgress) {
          onProgress(progress);
        }
      });

      updateState({
        isUploading: false,
        uploadProgress: null,
        uploadError: null,
      });

              // Atomic upload completed successfully
      return results;

    } catch (error) {
      const errorMessage = handleError(error);
      updateState({
        isUploading: false,
        uploadError: errorMessage,
      });
      
      throw error;
    }
  }, [state.isAuthenticated, updateState, handleError]);

  /**
   * Fetch employees for verification
   */
  const fetchEmployees = useCallback(async (
    limit: number = 100,
    offset: number = 0
  ): Promise<{
    employees: PlandayEmployeeResponse[];
    total: number;
    hasMore: boolean;
  }> => {
    if (!state.isAuthenticated) {
      throw new Error('Not authenticated. Please authenticate first.');
    }

    try {
      const result = await PlandayApi.fetchEmployees(limit, offset);
      console.log(`✅ Fetched ${result.employees.length} employees (${offset}-${offset + limit} of ${result.total})`);
      
      return result;
    } catch (error) {
      console.error('❌ Failed to fetch employees:', error);
      const errorMessage = handleError(error);
      throw new Error(errorMessage);
    }
  }, [state.isAuthenticated, handleError]);

  /**
   * Fetch specific employees by IDs for verification
   */
  const fetchEmployeesByIds = useCallback(async (
    employeeIds: number[]
  ): Promise<PlandayEmployeeResponse[]> => {
    if (!state.isAuthenticated) {
      throw new Error('Not authenticated. Please authenticate first.');
    }

    try {
      const employees = await PlandayApi.fetchEmployeesByIds(employeeIds);
      console.log(`✅ Fetched ${employees.length} employees by IDs`);
      
      return employees;
    } catch (error) {
      console.error('❌ Failed to fetch employees by IDs:', error);
      const errorMessage = handleError(error);
      throw new Error(errorMessage);
    }
  }, [state.isAuthenticated, handleError]);

  /**
   * Test API connection and sync authentication state
   */
  const testConnection = useCallback(async (): Promise<boolean> => {
    try {
      const isConnected = await PlandayApi.testConnection();
      
      // Sync authentication state based on connection test result
      const apiAuthenticated = PlandayApi.isAuthenticated();
      if (state.isAuthenticated !== apiAuthenticated) {
        // Syncing authentication state
        
        updateState({ isAuthenticated: apiAuthenticated });
      }
      
      return isConnected;
    } catch (error) {
      console.error('Connection test failed:', error);
      
      // If connection test throws, assume authentication failed
      updateState({ 
        isAuthenticated: false,
        authError: 'Connection test failed. Please re-authenticate.' 
      });
      
      return false;
    }
  }, [state.isAuthenticated, updateState]);

  /**
   * Check if employees with specific email addresses already exist in Planday
   */
  const checkExistingEmployeesByEmail = useCallback(async (
    emailAddresses: string[]
  ): Promise<Map<string, PlandayEmployeeResponse>> => {
    if (!state.isAuthenticated) {
      throw new Error('Not authenticated. Please authenticate first.');
    }

    try {
      const existingEmployees = await PlandayApi.checkExistingEmployeesByEmail(emailAddresses);
      // Email duplicate check completed

      return existingEmployees;
    } catch (error) {
      console.error('❌ Failed to check existing employees by email:', error);
      const errorMessage = handleError(error);
      throw new Error(errorMessage);
    }
  }, [state.isAuthenticated, handleError]);

  /**
   * Check if employees with specific SSNs already exist in Planday.
   * Degrades gracefully (returns empty map) if the SSN scope is unavailable.
   */
  const checkExistingEmployeesBySsn = useCallback(async (
    ssnValues: string[]
  ): Promise<SsnExistenceCheckResult> => {
    if (!state.isAuthenticated) {
      throw new Error('Not authenticated. Please authenticate first.');
    }

    try {
      return await PlandayApi.checkExistingEmployeesBySsn(ssnValues);
    } catch (error) {
      // Don't block the upload flow if the SSN lookup can't run.
      console.warn('⚠️ Failed to check existing employees by SSN:', error);
      return { existing: new Map<string, PlandayEmployeeResponse>(), available: false };
    }
  }, [state.isAuthenticated]);

  /**
   * Bulk set pay rates for employees in employee groups
   */
  const bulkSetPayrates = useCallback(async (
    assignments: PayrateAssignment[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<PayrateSetResult[]> => {
    // Check authentication directly from API client (state might be stale after re-auth)
    if (!PlandayApi.isAuthenticated()) {
      throw new Error('Not authenticated. Please authenticate first.');
    }

    try {
      const results = await PlandayApi.bulkSetPayrates(assignments, onProgress);
      console.log(`✅ Bulk pay rates set: ${results.filter(r => r.success).length} successful, ${results.filter(r => !r.success).length} failed`);

      return results;
    } catch (error) {
      console.error('❌ Failed to set pay rates:', error);
      const errorMessage = handleError(error);
      throw new Error(errorMessage);
    }
  }, [handleError]);

  /**
   * Bulk assign supervisors to employees after creation
   */
  const bulkAssignSupervisors = useCallback(async (
    assignments: Array<{ employeeId: number; supervisorId: number; supervisorName: string }>,
    onProgress?: (completed: number, total: number) => void
  ): Promise<Array<{ employeeId: number; supervisorId: number; supervisorName: string; success: boolean; error?: string }>> => {
    // Check authentication directly from API client (state might be stale after re-auth)
    if (!PlandayApi.isAuthenticated()) {
      throw new Error('Not authenticated. Please authenticate first.');
    }

    try {
      const results = await PlandayApi.bulkAssignSupervisors(assignments, onProgress);
      console.log(`✅ Bulk supervisor assignments: ${results.filter(r => r.success).length} successful, ${results.filter(r => !r.success).length} failed`);

      return results;
    } catch (error) {
      console.error('❌ Failed to assign supervisors:', error);
      const errorMessage = handleError(error);
      throw new Error(errorMessage);
    }
  }, [handleError]);

  /**
   * Bulk assign fixed salaries to employees after creation
   */
  const bulkAssignFixedSalaries = useCallback(async (
    assignments: FixedSalaryAssignment[],
    onProgress?: (completed: number, total: number) => void
  ): Promise<FixedSalarySetResult[]> => {
    // Check authentication directly from API client (state might be stale after re-auth)
    if (!PlandayApi.isAuthenticated()) {
      throw new Error('Not authenticated. Please authenticate first.');
    }

    try {
      const results = await PlandayApi.bulkAssignFixedSalaries(assignments, onProgress);
      console.log(`✅ Bulk fixed salary assignments: ${results.filter(r => r.success).length} successful, ${results.filter(r => !r.success).length} failed`);

      return results;
    } catch (error) {
      console.error('❌ Failed to assign fixed salaries:', error);
      const errorMessage = handleError(error);
      throw new Error(errorMessage);
    }
  }, [handleError]);

  /**
   * Assign a contract rule to an employee (inline after creation)
   */
  const assignContractRule = useCallback(async (
    employeeId: number,
    contractRuleId: number
  ): Promise<void> => {
    if (!PlandayApi.isAuthenticated()) {
      throw new Error('Not authenticated. Please authenticate first.');
    }

    try {
      await PlandayApi.assignContractRule(employeeId, contractRuleId);
    } catch (error) {
      console.error(`❌ Failed to assign contract rule to employee ${employeeId}:`, error);
      throw error;
    }
  }, []);

  /**
   * Create a single employee
   */
  const createEmployee = useCallback(async (
    employee: PlandayEmployeeCreateRequest
  ): Promise<{ data: PlandayEmployeeResponse }> => {
    if (!PlandayApi.isAuthenticated()) {
      throw new Error('Not authenticated. Please authenticate first.');
    }
    return PlandayApi.createEmployee(employee);
  }, []);

  /**
   * Assign fixed salary to an employee (inline after creation)
   */
  const assignFixedSalary = useCallback(async (
    employeeId: number,
    salaryTypeId: number,
    hours: number,
    salary: number,
    validFrom: string
  ): Promise<void> => {
    if (!PlandayApi.isAuthenticated()) {
      throw new Error('Not authenticated. Please authenticate first.');
    }
    await PlandayApi.assignFixedSalary(employeeId, salaryTypeId, hours, salary, validFrom);
  }, []);

  /**
   * Set payrate for an employee in a specific group (inline after creation)
   */
  const setEmployeeGroupPayrate = useCallback(async (
    groupId: number,
    employeeId: number,
    rate: number,
    validFrom: string
  ): Promise<void> => {
    if (!PlandayApi.isAuthenticated()) {
      throw new Error('Not authenticated. Please authenticate first.');
    }
    await PlandayApi.setEmployeeGroupPayrate(groupId, {
      wageType: 'HourlyRate',
      rate,
      employeeIds: [employeeId],
      validFrom
    });
  }, []);

  /**
   * Assign supervisor to an employee (deferred until all employees created)
   */
  const assignSupervisorToEmployee = useCallback(async (
    employeeId: number,
    supervisorRecordId: number
  ): Promise<void> => {
    if (!PlandayApi.isAuthenticated()) {
      throw new Error('Not authenticated. Please authenticate first.');
    }
    await PlandayApi.assignSupervisorToEmployee(employeeId, supervisorRecordId);
  }, []);

  /**
   * Clear all error states
   */
  const clearErrors = useCallback(() => {
    updateState({
      authError: null,
      departmentsError: null,
      employeeGroupsError: null,
      employeeTypesError: null,
      uploadError: null,
    });
  }, [updateState]);

  /**
   * Check authentication status on mount
   */
  useEffect(() => {
    const isAuthenticated = PlandayApi.isAuthenticated();
    
    if (isAuthenticated && !state.isAuthenticated) {
      // Restore authentication state FIRST
      updateState({ isAuthenticated: true });
    }
  }, [state.isAuthenticated, updateState, state.departments?.length, state.employeeGroups?.length]);

  /**
   * Refresh data when authentication is restored
   */
  useEffect(() => {
    // Only run if we're authenticated and don't have complete data
    const needsData = state.isAuthenticated && 
                     ((!state.departments || state.departments.length === 0) || 
                      (!state.employeeGroups || state.employeeGroups.length === 0) || 
                      (!state.employeeTypes || state.employeeTypes.length === 0));
                     
    if (!needsData) return;
    
    const restoreData = async () => {
      try {
        // First, try to restore data from MappingService (faster than API call)
        if (MappingUtils.isInitialized()) {
          const cachedDepartments = MappingUtils.getDepartments();
          const cachedEmployeeGroups = MappingUtils.getEmployeeGroups();
          const cachedEmployeeTypes = MappingUtils.getEmployeeTypes();
          
          // Only update if we have all cached data sets
          if (cachedDepartments.length > 0 && cachedEmployeeGroups.length > 0 && cachedEmployeeTypes.length > 0) {
            updateState({
              departments: cachedDepartments,
              employeeGroups: cachedEmployeeGroups,
              employeeTypes: cachedEmployeeTypes
            });
            return;
          }
        }
        
        // If no cached data or incomplete data, fetch from API
        
        const [departments, employeeGroups, employeeTypes, fieldDefinitions, employeeSample] = await Promise.all([
          PlandayApi.getDepartments(),
          PlandayApi.getEmployeeGroups(),
          PlandayApi.getEmployeeTypes(),
          PlandayApi.getFieldDefinitions(),
          PlandayApi.fetchEmployeeSample(5)
        ]);

        // Fetch portal info separately (non-critical)
        let portalInfo = null;
        try {
          portalInfo = await PlandayApi.getPortalInfo();
          const { PhoneParser } = await import('../utils');
          PhoneParser.setPortalCountry(portalInfo.country);
        } catch (portalError) {
          console.warn('⚠️ Could not fetch portal info during restoration:', portalError);
        }

        // Discover and merge fields from employee sample before initializing services
        if (employeeSample.length > 0) {
          const discoveredFields = discoverFieldsFromEmployees(employeeSample);
          mergeDiscoveredFields(fieldDefinitions, discoveredFields);
        }

        // Initialize services
        MappingUtils.initialize(departments, employeeGroups, employeeTypes);
        ValidationService.initialize(fieldDefinitions);
        FieldDefinitionValidator.initialize(fieldDefinitions);
        
        updateState({
          departments,
          employeeGroups,
          employeeTypes,
          fieldDefinitions,
          portalInfo
        });
        
        // Data restoration completed successfully
        
      } catch (error) {
        console.error('❌ Failed to restore Planday data:', error);
        updateState({ 
          isAuthenticated: false,
          authError: `Failed to restore session data: ${error instanceof Error ? error.message : 'Unknown error'}. Please re-authenticate.`
        });
      }
    };
    
    restoreData();
    
  }, [state.isAuthenticated, state.departments?.length, state.employeeGroups?.length, state.employeeTypes?.length, updateState]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      // Cleanup is handled by the logout function
      // No automatic cleanup on unmount to preserve session
    };
  }, [instanceId]);

  const returnValue = {
    // State
    ...state,
    
    // Actions
    authenticate,
    logout,
    refreshDepartments,
    refreshEmployeeGroups,
    refreshEmployeeTypes,
    refreshSupervisors,
    refreshSkills,
    refreshSalaryTypes,
    refreshFieldDefinitions,
    refreshPortalInfo,
    refreshPlandayData,
    resyncPortalData,
    uploadEmployees,
    atomicUploadEmployees,
    fetchEmployees,
    fetchEmployeesByIds,
    checkExistingEmployeesByEmail,
    checkExistingEmployeesBySsn,
    bulkSetPayrates,
    bulkAssignSupervisors,
    bulkAssignFixedSalaries,
    assignContractRule,
    createEmployee,
    assignFixedSalary,
    setEmployeeGroupPayrate,
    assignSupervisorToEmployee,
    testConnection,
    clearErrors,

    // Diagnostic actions for debugging field inconsistencies
    diagnoseFieldInconsistencies: () => ValidationService.diagnoseFieldInconsistencies(),
  };

  return returnValue;
}; 