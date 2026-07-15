

export interface PlandayApiCredentials {
  clientId: string;
  refreshToken: string;
}

export interface Employee {
  id: number;
  firstName: string;
  lastName: string;
  email?: string;
  departmentIds?: number[];
  employeeGroupIds?: number[];
  salaryIdentifier?: string | null;
  employeeTypeId?: number;
}

export interface IdName {
    id: number;
    name: string;
}

export interface Department extends IdName {}
export interface EmployeeGroup extends IdName {}
export interface EmployeeType extends IdName {}
export interface ContractRule extends IdName {}
export interface SalaryType extends IdName {}

export interface Skill {
    id: number;
    name: string;
}

export interface Supervisor {
    id: number; // This is the record ID, not employee ID
    employeeId: number;
    name: string;
}

export interface FieldDefinition {
    id: number | string;
    originalName: string; // API key (e.g. custom_123)
    description: string; // Display name
    type: 'Text' | 'Numeric' | 'Date' | 'Boolean' | 'Dropdown';
    dropdownOptions?: string[];
}

// Payload structures for Updates
export interface UpdateEmployeePayload {
    [key: string]: any;
}

export interface UpdateWageRatePayload {
    wageType: 'HourlyRate' | 'ShiftRate';
    rate: number;
    employeeIds: number[];
    validFrom?: string;
    salaryCode?: string;
}

export interface UpdateSalaryPayload {
    salaryTypeId: number;
    hours: number;
    salary: number;
    from: string;
    salaryCode?: string;
}

// Result status for specific update actions
export interface UpdateActionResult {
    success: boolean;
    message: string;
}

// Review Item
export interface EmployeeUpdateReview {
    employeeId: number;
    employeeName: string;
    changes: string[]; // Description of what will change
    payloads: {
        main?: UpdateEmployeePayload;
        departments?: { departments: number[], primaryDepartmentId: number | null };
        groups?: { employeeGroups: number[] };
        skills?: { skillIds: number[], userName?: string };
        contractRule?: number | null; // ID or null for unassign
        supervisor?: number | null; // RecordID or null
        pendingSupervisorName?: string; // Name to resolve after main updates
        fixedSalary?: { isDelete: boolean; data?: UpdateSalaryPayload };
        groupRates?: UpdateWageRatePayload[];
        username?: string;
    };
    status?: 'pending' | 'success' | 'error' | 'partial' | 'no_updates' | 'aborted';
    resultMessage?: string;
    
    // Detailed results for each step
    results?: {
        main?: UpdateActionResult;
        username?: UpdateActionResult;
        supervisor?: UpdateActionResult;
        contract?: UpdateActionResult;
        salary?: UpdateActionResult;
        rates?: UpdateActionResult;
    };

    // Pre-flight validation errors detected during parsing
    validationErrors?: {
        supervisor?: string;
        contract?: string;
    };
}

export interface DefinitionCollection {
    departments: Department[];
    employeeGroups: EmployeeGroup[];
    employeeTypes: EmployeeType[];
    contractRules: ContractRule[];
    salaryTypes: SalaryType[];
    skills: Skill[];
    supervisors: Supervisor[];
    customFields: FieldDefinition[];
    availableSystemFields: string[]; // List of system fields actually returned by the API
    countryCodes?: string[];
    requiredFields?: string[];
}