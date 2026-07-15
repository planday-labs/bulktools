/**
 * Mapping Service for Planday Name-to-ID Conversion
 * Handles intelligent mapping between human-readable names and Planday API IDs
 * Features:
 * - Bidirectional name ↔ ID mapping
 * - Fuzzy matching for typo detection
 * - Bulk error pattern detection
 * - Comma-separated value handling
 * - Case-insensitive matching
 * - Mixed name/ID input support
 */

import type {
  PlandayDepartment,
  PlandayEmployeeGroup,
  PlandayEmployeeType,
  PlandaySupervisor,
  PlandaySkill,
  PlandaySalaryType,
  PlandayContractRule,
  ValidationError,
  PlandayFieldDefinitionsSchema,
  PlandayEmployeeCreateRequest
} from '../types/planday';

import { normalizeDecimal } from '../utils/numericParser';

export interface MappingResult {
  ids: number[];
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

export interface ErrorPattern {
  field: 'departments' | 'employeeGroups' | 'employeeTypes' | 'supervisors';
  invalidName: string;
  count: number;
  rows: number[];
  suggestion?: string;
  confidence: number; // 0-1, how confident we are in the suggestion
  errorMessage?: string; // Custom error message (e.g., for ambiguous supervisor names)
}

export interface BulkCorrectionSummary {
  totalErrors: number;
  patterns: ErrorPattern[];
  affectedRows: number;
  canBulkFix: number; // Number of errors that have good suggestions
}

export interface CustomFieldConversionResult {
  convertedValue: any;
  errors: ValidationError[];
  warnings: string[];
}

export interface CustomFieldInfo {
  fieldName: string;
  fieldType: CustomFieldType;
  description?: string;
  isRequired: boolean;
  enumValues?: string[]; // For dropdown/select fields
  enumOptions?: Array<{ value: any; label: string }>; // For more complex enums with labels
}

export type CustomFieldType = 
  | 'optionalString'
  | 'optionalBoolean' 
  | 'optionalNumeric'
  | 'optionalDate'
  | 'optionalImage'
  | 'optionalEnum' // New type for dropdown/select fields
  | 'unknown';

/**
 * Core Mapping Service Class
 */
export class MappingService {
  // Bidirectional maps for fast lookups
  private departmentsByName: Map<string, number> = new Map();
  private departmentsById: Map<number, string> = new Map();
  private employeeGroupsByName: Map<string, number> = new Map();
  private employeeGroupsById: Map<number, string> = new Map();
  private employeeTypesByName: Map<string, number> = new Map();
  private employeeTypesById: Map<number, string> = new Map();
  // Supervisor maps - name can map to multiple IDs if duplicates exist
  private supervisorsByName: Map<string, number[]> = new Map();
  private supervisorsById: Map<number, string> = new Map();
  // Skill maps - for skill assignments
  private skillsByName: Map<string, number> = new Map();
  private skillsById: Map<number, string> = new Map();
  private timeLimitedSkills: Set<number> = new Set(); // Skills that require ValidFrom/ValidTo dates
  // Salary type maps - for fixed salary assignments
  private salaryTypesByName: Map<string, number> = new Map();
  private salaryTypesById: Map<number, string> = new Map();
  // Contract rule maps - for contracted hours
  private contractRulesByName: Map<string, number> = new Map();
  private contractRulesById: Map<number, string> = new Map();

  // Original data for reference (public for utility functions)
  public departments: PlandayDepartment[] = [];
  public employeeGroups: PlandayEmployeeGroup[] = [];
  public employeeTypes: PlandayEmployeeType[] = [];
  public supervisors: PlandaySupervisor[] = [];
  public skills: PlandaySkill[] = [];
  public salaryTypes: PlandaySalaryType[] = [];
  public contractRules: PlandayContractRule[] = [];

  constructor() {}

  /**
   * Initialize the service with Planday department, employee group, and employee type data
   */
  initialize(departments: PlandayDepartment[], employeeGroups: PlandayEmployeeGroup[], employeeTypes: PlandayEmployeeType[] = []): void {
    // Store the original data
    this.departments = departments;
    this.employeeGroups = employeeGroups;
    this.employeeTypes = employeeTypes;

    // Clear previous data
    this.departmentsByName.clear();
    this.departmentsById.clear();
    this.employeeGroupsByName.clear();
    this.employeeGroupsById.clear();
    this.employeeTypesByName.clear();
    this.employeeTypesById.clear();

    // Build lookup maps for departments
    departments.forEach(dept => {
      if (dept && dept.name) {
        const normalizedName = this.normalizeName(dept.name);
        this.departmentsByName.set(normalizedName, dept.id);
        this.departmentsById.set(dept.id, dept.name);
      }
    });

    // Build lookup maps for employee groups
    employeeGroups.forEach(group => {
      if (group && group.name) {
        const normalizedName = this.normalizeName(group.name);
        this.employeeGroupsByName.set(normalizedName, group.id);
        this.employeeGroupsById.set(group.id, group.name);
      }
    });

    // Build lookup maps for employee types
    employeeTypes.forEach(type => {
      if (type && type.name) {
        const normalizedName = this.normalizeName(type.name);
        this.employeeTypesByName.set(normalizedName, type.id);
        this.employeeTypesById.set(type.id, type.name);
      }
    });
  }

  /**
   * Set supervisors data (called separately after authentication)
   * Handles duplicate names by storing array of IDs per name
   */
  setSupervisors(supervisors: PlandaySupervisor[]): void {
    this.supervisors = supervisors;
    this.supervisorsByName.clear();
    this.supervisorsById.clear();

    supervisors.forEach(supervisor => {
      if (supervisor && supervisor.name) {
        const normalizedName = this.normalizeName(supervisor.name);

        // Handle duplicate names - store as array
        const existingIds = this.supervisorsByName.get(normalizedName) || [];
        existingIds.push(supervisor.id);
        this.supervisorsByName.set(normalizedName, existingIds);

        this.supervisorsById.set(supervisor.id, supervisor.name);
      }
    });

    console.log(`✅ Initialized ${supervisors.length} supervisors`);
  }

  /**
   * Set skills data (called separately after authentication)
   */
  setSkills(skills: PlandaySkill[]): void {
    this.skills = skills;
    this.skillsByName.clear();
    this.skillsById.clear();
    this.timeLimitedSkills.clear();

    skills.forEach(skill => {
      if (skill && skill.name) {
        const normalizedName = this.normalizeName(skill.name);
        this.skillsByName.set(normalizedName, skill.skillId);
        this.skillsById.set(skill.skillId, skill.name);

        // Track time-limited skills (require ValidFrom/ValidTo dates)
        if (skill.isTimeLimited) {
          this.timeLimitedSkills.add(skill.skillId);
        }
      }
    });

    const timeLimitedCount = this.timeLimitedSkills.size;
    const regularCount = skills.length - timeLimitedCount;
    console.log(`✅ Initialized ${skills.length} skills (${regularCount} regular, ${timeLimitedCount} time-limited)`);
  }

  /**
   * Check if a skill is time-limited (requires ValidFrom/ValidTo dates)
   */
  isSkillTimeLimited(skillId: number): boolean {
    return this.timeLimitedSkills.has(skillId);
  }

  /**
   * Get the name of a skill by ID
   */
  getSkillName(skillId: number): string | undefined {
    return this.skillsById.get(skillId);
  }

  /**
   * Get all available skills
   */
  getSkills(): PlandaySkill[] {
    return this.skills;
  }

  /**
   * Resolve skill name to ID
   */
  resolveSkill(input: string | number | undefined | null): MappingResult {
    const result: MappingResult = {
      ids: [],
      errors: [],
      warnings: [],
      suggestions: []
    };

    // Convert input to string to handle numbers passed from Excel
    const inputStr = input !== null && input !== undefined ? String(input) : '';

    if (!inputStr || inputStr.trim() === '') {
      return result;
    }

    const name = inputStr.trim();
    const normalizedName = this.normalizeName(name);

    // 1. Try numeric ID first
    const numericId = parseInt(name);
    if (!isNaN(numericId) && this.skillsById.has(numericId)) {
      result.ids.push(numericId);
      return result;
    }

    // 2. Try exact name match (case-insensitive)
    const matchingId = this.skillsByName.get(normalizedName);

    if (matchingId !== undefined) {
      result.ids.push(matchingId);
      return result;
    }

    // 3. No exact match - try fuzzy matching for typos
    const availableNames = Array.from(this.skillsByName.keys());
    const suggestion = this.findBestMatch(normalizedName, availableNames);

    if (suggestion.match && suggestion.confidence > 0.7) {
      const originalName = this.skillsById.get(this.skillsByName.get(suggestion.match)!) || suggestion.match;
      result.errors.push(`Skill "${name}" not found. Did you mean "${originalName}"?`);
    } else {
      result.errors.push(`Skill "${name}" not found in Planday.`);
    }

    return result;
  }

  /**
   * Set salary types data (called separately after authentication)
   */
  setSalaryTypes(salaryTypes: PlandaySalaryType[]): void {
    this.salaryTypes = salaryTypes;
    this.salaryTypesByName.clear();
    this.salaryTypesById.clear();

    salaryTypes.forEach(salaryType => {
      if (salaryType && salaryType.name) {
        const normalizedName = this.normalizeName(salaryType.name);
        this.salaryTypesByName.set(normalizedName, salaryType.id);
        this.salaryTypesById.set(salaryType.id, salaryType.name);
      }
    });

    console.log(`✅ Initialized ${salaryTypes.length} salary types`);
  }

  /**
   * Resolve salary type name to ID
   */
  resolveSalaryType(input: string | number | undefined | null): MappingResult {
    const result: MappingResult = {
      ids: [],
      errors: [],
      warnings: [],
      suggestions: []
    };

    // Convert input to string to handle numbers passed from Excel
    const inputStr = input !== null && input !== undefined ? String(input) : '';

    if (!inputStr || inputStr.trim() === '') {
      return result;
    }

    const name = inputStr.trim();
    const normalizedName = this.normalizeName(name);

    // 1. Try numeric ID first
    const numericId = parseInt(name);
    if (!isNaN(numericId) && this.salaryTypesById.has(numericId)) {
      result.ids.push(numericId);
      return result;
    }

    // 2. Try exact name match (case-insensitive)
    const matchingId = this.salaryTypesByName.get(normalizedName);

    if (matchingId !== undefined) {
      result.ids.push(matchingId);
      return result;
    }

    // 3. No exact match - try fuzzy matching for typos
    const availableNames = Array.from(this.salaryTypesByName.keys());
    const suggestion = this.findBestMatch(normalizedName, availableNames);

    if (suggestion.match && suggestion.confidence > 0.7) {
      const originalName = this.salaryTypesById.get(this.salaryTypesByName.get(suggestion.match)!);
      result.errors.push(`Salary type "${name}" not found. Did you mean "${originalName}"?`);
    } else {
      const availableSalaryTypes = this.salaryTypes.map(s => s.name).join(', ');
      result.errors.push(`Salary type "${name}" not found. Available types: ${availableSalaryTypes}`);
    }

    return result;
  }

  /**
   * Set contract rules data (called separately after authentication)
   */
  setContractRules(contractRules: PlandayContractRule[]): void {
    this.contractRules = contractRules;
    this.contractRulesByName.clear();
    this.contractRulesById.clear();

    contractRules.forEach(contractRule => {
      if (contractRule && contractRule.name) {
        const normalizedName = this.normalizeName(contractRule.name);
        this.contractRulesByName.set(normalizedName, contractRule.id);
        this.contractRulesById.set(contractRule.id, contractRule.name);
      }
    });

    console.log(`✅ Initialized ${contractRules.length} contract rules`);
  }

  /**
   * Resolve contract rule name to ID
   */
  resolveContractRule(input: string | number | undefined | null): MappingResult {
    const result: MappingResult = {
      ids: [],
      errors: [],
      warnings: [],
      suggestions: []
    };

    // Convert input to string to handle numbers passed from Excel
    const inputStr = input !== null && input !== undefined ? String(input) : '';

    if (!inputStr || inputStr.trim() === '') {
      return result;
    }

    const name = inputStr.trim();
    const normalizedName = this.normalizeName(name);

    // 1. Try numeric ID first
    const numericId = parseInt(name);
    if (!isNaN(numericId) && this.contractRulesById.has(numericId)) {
      result.ids.push(numericId);
      return result;
    }

    // 2. Try exact name match (case-insensitive)
    const matchingId = this.contractRulesByName.get(normalizedName);

    if (matchingId !== undefined) {
      result.ids.push(matchingId);
      return result;
    }

    // 3. No exact match - try fuzzy matching for typos
    const availableNames = Array.from(this.contractRulesByName.keys());
    const suggestion = this.findBestMatch(normalizedName, availableNames);

    if (suggestion.match && suggestion.confidence > 0.7) {
      const originalName = this.contractRulesById.get(this.contractRulesByName.get(suggestion.match)!);
      result.errors.push(`Contract rule "${name}" not found. Did you mean "${originalName}"?`);
    } else {
      const availableContractRules = this.contractRules.map(c => c.name).join(', ');
      result.errors.push(`Contract rule "${name}" not found. Available rules: ${availableContractRules}`);
    }

    return result;
  }

  /**
   * Normalize names for consistent matching
   */
  private normalizeName(name: string): string {
    return name
      .toString()
      .trim()
      .toLowerCase()
      // Remove extra spaces
      .replace(/\s+/g, ' ')
      // Remove special characters but keep spaces
      .replace(/[^\w\s]/g, '')
      .trim();
  }

  /**
   * Resolve single employee type name to ID (no comma separation)
   * Now uses field definitions as primary source with API fallback
   */
  resolveEmployeeType(input: string | number | undefined | null): MappingResult {
    const result: MappingResult = {
      ids: [],
      errors: [],
      warnings: [],
      suggestions: []
    };

    // Convert input to string to handle numbers passed from Excel
    const inputStr = input !== null && input !== undefined ? String(input) : '';

    if (!inputStr || inputStr.trim() === '') {
      return result;
    }

    const name = inputStr.trim();

    // 1. Try field definitions validation first (PRIMARY SOURCE)
    if (FieldDefinitionValidator.isEnumField('employeeTypeId')) {
      const validationResult = FieldDefinitionValidator.validateFieldValue('employeeTypeId', name);
      
      if (validationResult.isValid) {
        // Ensure the convertedValue is always a number for employeeTypeId
        const convertedId = typeof validationResult.convertedValue === 'string' 
          ? parseInt(validationResult.convertedValue, 10) 
          : validationResult.convertedValue;
        result.ids.push(convertedId);
        if (validationResult.suggestion) {
          result.warnings.push(validationResult.suggestion);
        }
        return result;
      } else {
        // Get available options from field definitions for better error messages
        const options = FieldDefinitionValidator.getFieldOptions('employeeTypeId');
        const availableNames = options.map(opt => opt.name);
        
        // Try fuzzy matching against field definition values
        const normalizedName = this.normalizeName(name);
        const normalizedOptions = availableNames.map(name => this.normalizeName(name));
        const suggestion = this.findBestMatch(normalizedName, normalizedOptions);
        
        if (suggestion.match && suggestion.confidence > 0.7) {
          const originalName = availableNames[normalizedOptions.indexOf(suggestion.match)];
          result.errors.push(`"${name}" not found. Did you mean "${originalName}"?`);
          result.suggestions.push(suggestion.match);
        } else if (suggestion.match && suggestion.confidence > 0.4) {
          const topMatches = this.getTopMatches(normalizedName, normalizedOptions, 3);
          const originalMatches = topMatches.map(match => availableNames[normalizedOptions.indexOf(match)]);
          result.errors.push(`"${name}" not found. Possible matches: ${originalMatches.join(', ')}`);
        } else {
          result.errors.push(`"${name}" not found in available employee types`);
        }
        
        return result;
      }
    }

    // 2. FALLBACK: Use API data if field definitions not available (LEGACY SUPPORT)
    console.warn('⚠️ Field definitions not available for employeeTypeId, using API fallback');
    
    const normalizedName = this.normalizeName(name);
    const availableNames = Array.from(this.employeeTypesByName.keys());

    // Try exact match (case-insensitive)
    const id = this.employeeTypesByName.get(normalizedName);
    if (id) {
      result.ids.push(id);
      result.warnings.push('Using API fallback for employee type validation');
      return result;
    }

    // Try numeric ID as fallback
    const numericId = parseInt(name);
    if (!isNaN(numericId) && this.employeeTypesById.has(numericId)) {
      result.ids.push(numericId);
      result.warnings.push(`Using numeric ID ${numericId} for "${name}" (API fallback)`);
      return result;
    }

    // Try fuzzy matching for typos
    const suggestion = this.findBestMatch(normalizedName, availableNames);
    if (suggestion.match && suggestion.confidence > 0.7) {
      result.errors.push(`"${name}" not found. Did you mean "${this.getOriginalEmployeeTypeName(suggestion.match)}"? (API fallback)`);
      result.suggestions.push(suggestion.match);
    } else if (suggestion.match && suggestion.confidence > 0.4) {
      result.errors.push(`"${name}" not found. Possible matches: ${this.getTopMatches(normalizedName, availableNames, 3).map(m => this.getOriginalEmployeeTypeName(m)).join(', ')} (API fallback)`);
    } else {
      result.errors.push(`"${name}" not found in available employee types (API fallback)`);
    }

    return result;
  }

  /**
   * Resolve supervisor name to ID with duplicate detection
   * - If 1 match → returns the supervisor ID
   * - If 0 matches → error with fuzzy suggestions
   * - If 2+ matches → error listing all matching IDs for user to choose
   */
  resolveSupervisor(input: string | number | undefined | null): MappingResult {
    const result: MappingResult = {
      ids: [],
      errors: [],
      warnings: [],
      suggestions: []
    };

    // Convert input to string to handle numbers passed from Excel
    const inputStr = input !== null && input !== undefined ? String(input) : '';

    if (!inputStr || inputStr.trim() === '') {
      return result;
    }

    const name = inputStr.trim();
    const normalizedName = this.normalizeName(name);

    // 1. Try numeric ID first
    const numericId = parseInt(name);
    if (!isNaN(numericId) && this.supervisorsById.has(numericId)) {
      result.ids.push(numericId);
      return result;
    }

    // 2. Try exact name match (case-insensitive)
    const matchingIds = this.supervisorsByName.get(normalizedName);

    if (matchingIds && matchingIds.length === 1) {
      // Single match - perfect!
      result.ids.push(matchingIds[0]);
      return result;
    }

    if (matchingIds && matchingIds.length > 1) {
      // Multiple supervisors with same name - error with IDs
      const idsWithNames = matchingIds.map(id => {
        const supervisorName = this.supervisorsById.get(id);
        return `${id} (${supervisorName})`;
      }).join(', ');

      result.errors.push(
        `Multiple supervisors named "${name}" found. Please use one of these IDs instead: ${idsWithNames}`
      );
      return result;
    }

    // 3. No exact match - try fuzzy matching for typos
    const availableNames = Array.from(this.supervisorsByName.keys());
    const suggestion = this.findBestMatch(normalizedName, availableNames);

    if (suggestion.match && suggestion.confidence > 0.7) {
      const originalName = this.getOriginalSupervisorName(suggestion.match);
      result.errors.push(`Supervisor "${name}" not found. Did you mean "${originalName}"?`);
      result.suggestions.push(originalName);
    } else if (suggestion.match && suggestion.confidence > 0.4) {
      const topMatches = this.getTopMatches(normalizedName, availableNames, 3)
        .map(m => this.getOriginalSupervisorName(m));
      result.errors.push(`Supervisor "${name}" not found. Possible matches: ${topMatches.join(', ')}`);
    } else {
      result.errors.push(`Supervisor "${name}" not found in available supervisors`);
    }

    return result;
  }

  /**
   * Get original supervisor name from normalized name
   */
  private getOriginalSupervisorName(normalizedName: string): string {
    const ids = this.supervisorsByName.get(normalizedName);
    if (ids && ids.length > 0) {
      return this.supervisorsById.get(ids[0]) || normalizedName;
    }
    return normalizedName;
  }

  /**
   * Resolve comma-separated names to IDs with comprehensive error handling
   */
  resolveNames(input: string | number | undefined | null, type: 'departments' | 'employeeGroups'): MappingResult {
    const result: MappingResult = {
      ids: [],
      errors: [],
      warnings: [],
      suggestions: []
    };

    // Convert input to string to handle numbers passed from Excel
    const inputStr = input !== null && input !== undefined ? String(input) : '';

    if (!inputStr || inputStr.trim() === '') {
      return result;
    }

    // Split comma-separated values and clean them
    const names = inputStr
      .split(',')
      .map(name => name.trim())
      .filter(name => name !== '');

    const mapping = type === 'departments' 
      ? this.departmentsByName 
      : this.employeeGroupsByName;

    const availableNames = Array.from(mapping.keys());
    const processedNames = new Set<string>(); // Track duplicates

    names.forEach(name => {
      // Skip if we've already processed this name (handle duplicates)
      const normalizedName = this.normalizeName(name);
      if (processedNames.has(normalizedName)) {
        result.warnings.push(`Duplicate entry "${name}" removed`);
        return;
      }
      processedNames.add(normalizedName);

      // 1. Try exact match (case-insensitive)
      const id = mapping.get(normalizedName);
      if (id) {
        result.ids.push(id);
        return;
      }

      // 2. Try numeric ID as fallback
      const numericId = parseInt(name);
      if (!isNaN(numericId) && this.isValidId(numericId, type)) {
        result.ids.push(numericId);
        result.warnings.push(`Using numeric ID ${numericId} for "${name}"`);
        return;
      }

      // 3. Try fuzzy matching for typos
      const suggestion = this.findBestMatch(normalizedName, availableNames);
      if (suggestion.match && suggestion.confidence > 0.7) {
        result.errors.push(`"${name}" not found. Did you mean "${this.getOriginalName(suggestion.match, type)}"?`);
        result.suggestions.push(suggestion.match);
      } else if (suggestion.match && suggestion.confidence > 0.4) {
        result.errors.push(`"${name}" not found. Possible matches: ${this.getTopMatches(normalizedName, availableNames, 3).map(m => this.getOriginalName(m, type)).join(', ')}`);
      } else {
        result.errors.push(`"${name}" not found in available ${type}`);
      }
    });

    return result;
  }

  /**
   * Check if a numeric ID is valid for the given type
   */
  private isValidId(id: number, type: 'departments' | 'employeeGroups'): boolean {
    return type === 'departments' 
      ? this.departmentsById.has(id)
      : this.employeeGroupsById.has(id);
  }

  /**
   * Get original employee type name from normalized name
   */
  private getOriginalEmployeeTypeName(normalizedName: string): string {
    const id = this.employeeTypesByName.get(normalizedName);
    if (id) {
      return this.employeeTypesById.get(id) || normalizedName;
    }
    return normalizedName;
  }

  /**
   * Get original name from normalized name
   */
  private getOriginalName(normalizedName: string, type: 'departments' | 'employeeGroups'): string {
    const mapping = type === 'departments' 
      ? this.departmentsByName 
      : this.employeeGroupsByName;
    
    const id = mapping.get(normalizedName);
    if (id) {
      return type === 'departments'
        ? this.departmentsById.get(id) || normalizedName
        : this.employeeGroupsById.get(id) || normalizedName;
    }
    return normalizedName;
  }

  /**
   * Find best fuzzy match using Levenshtein distance
   */
  private findBestMatch(input: string, candidates: string[]): { match: string | null; confidence: number } {
    if (candidates.length === 0) {
      return { match: null, confidence: 0 };
    }

         let bestMatch = null;
     let bestConfidence = 0;

     for (const candidate of candidates) {
       const distance = this.levenshteinDistance(input, candidate);
       const maxLength = Math.max(input.length, candidate.length);
       const confidence = 1 - (distance / maxLength);

       if (confidence > bestConfidence) {
         bestMatch = candidate;
         bestConfidence = confidence;
       }
     }

    return {
      match: bestMatch,
      confidence: bestConfidence
    };
  }

  /**
   * Get top N fuzzy matches
   */
  private getTopMatches(input: string, candidates: string[], limit: number = 3): string[] {
    return candidates
      .map(candidate => ({
        name: candidate,
        confidence: 1 - (this.levenshteinDistance(input, candidate) / Math.max(input.length, candidate.length))
      }))
      .filter(match => match.confidence > 0.3)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit)
      .map(match => match.name);
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,     // deletion
          matrix[j - 1][i] + 1,     // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Detect common error patterns across an entire dataset
   */
  detectCommonErrors(employees: any[]): BulkCorrectionSummary {
    const errorPatterns = new Map<string, ErrorPattern>();
    let totalErrors = 0;
    let affectedRows = 0;

    // Build a map of employee names from the current Excel data
    // This allows supervisor assignments to reference employees being created in the same batch
    const excelEmployeesByName = new Map<string, number[]>(); // name -> array of row indices (for duplicate detection)
    employees.forEach((emp, idx) => {
      const firstName = emp.firstName?.toString()?.trim() || '';
      const lastName = emp.lastName?.toString()?.trim() || '';
      if (firstName || lastName) {
        const fullName = this.normalizeName(`${firstName} ${lastName}`.trim());
        const existing = excelEmployeesByName.get(fullName) || [];
        existing.push(idx);
        excelEmployeesByName.set(fullName, existing);
      }
    });

    employees.forEach((employee, rowIndex) => {
      // Handle departments and employee groups (comma-separated)
      const commaFields: Array<'departments' | 'employeeGroups'> = ['departments', 'employeeGroups'];
      commaFields.forEach((field) => {
        if (!employee[field]) return;

        const result = this.resolveNames(employee[field], field);
        if (result.errors.length > 0) {
          affectedRows++;
          totalErrors += result.errors.length;

          // Extract the invalid names from error messages
          const names = employee[field].split(',').map((s: string) => s.trim());
          names.forEach((name: string) => {
            const normalizedName = this.normalizeName(name);
            const mapping = field === 'departments' 
              ? this.departmentsByName 
              : this.employeeGroupsByName;

            if (!mapping.has(normalizedName) && !this.isValidId(parseInt(name), field)) {
              const key = `${field}:${normalizedName}`;
              const pattern: ErrorPattern = errorPatterns.get(key) || {
                field,
                invalidName: name,
                count: 0,
                rows: [],
                confidence: 0
              };

              pattern.count++;
              pattern.rows.push(rowIndex + 1); // 1-based row numbers

              // Get fuzzy match suggestion
              const availableNames = Array.from(mapping.keys());
              const suggestion = this.findBestMatch(normalizedName, availableNames);
              if (suggestion.match && suggestion.confidence > 0.4) {
                pattern.suggestion = this.getOriginalName(suggestion.match, field);
                pattern.confidence = suggestion.confidence;
              }

              errorPatterns.set(key, pattern);
            }
          });
        }
      });

      // Handle employee type (single value, no comma separation)
      if (employee.employeeTypeId) {
        const result = this.resolveEmployeeType(employee.employeeTypeId);
        if (result.errors.length > 0) {
          affectedRows++;
          totalErrors += result.errors.length;

          const name = employee.employeeTypeId.toString().trim();
          const normalizedName = this.normalizeName(name);

          if (!this.employeeTypesByName.has(normalizedName) && !this.employeeTypesById.has(parseInt(name))) {
            const key = `employeeTypes:${normalizedName}`;
            const pattern: ErrorPattern = errorPatterns.get(key) || {
              field: 'employeeTypes' as const,
              invalidName: name,
              count: 0,
              rows: [],
              confidence: 0
            };

            pattern.count++;
            pattern.rows.push(rowIndex + 1); // 1-based row numbers

            // Get fuzzy match suggestion
            const availableNames = Array.from(this.employeeTypesByName.keys());
            const suggestion = this.findBestMatch(normalizedName, availableNames);
            if (suggestion.match && suggestion.confidence > 0.4) {
              pattern.suggestion = this.getOriginalEmployeeTypeName(suggestion.match);
              pattern.confidence = suggestion.confidence;
            }

            errorPatterns.set(key, pattern);
          }
        }
      }

      // Handle supervisor (single value) - check Planday AND Excel data for validity
      if (employee.supervisorId) {
        const supervisorValue = employee.supervisorId?.toString()?.trim();
        if (supervisorValue) {
          const normalizedSupervisorName = this.normalizeName(supervisorValue);

          // First check Planday
          const plandayResult = this.resolveSupervisor(supervisorValue);
          const plandayIds = this.supervisorsByName.get(normalizedSupervisorName) || [];

          // Then check Excel data
          const excelMatches = excelEmployeesByName.get(normalizedSupervisorName) || [];

          // Determine the validation result
          let hasError = false;
          let errorMessage = '';
          let isAmbiguous = false;

          // Count total matches across Planday and Excel
          const totalPlandayMatches = plandayIds.length;
          const totalExcelMatches = excelMatches.length;
          const totalMatches = totalPlandayMatches + totalExcelMatches;

          if (totalMatches === 0) {
            // Not found anywhere
            hasError = true;
            errorMessage = `Supervisor not found: '${supervisorValue}' - not in Planday or current upload`;
          } else if (totalMatches > 1) {
            // Ambiguous - multiple matches across Planday and/or Excel
            hasError = true;
            isAmbiguous = true;
            const sources: string[] = [];
            if (totalPlandayMatches > 0) sources.push(`${totalPlandayMatches} in Planday`);
            if (totalExcelMatches > 0) sources.push(`${totalExcelMatches} in current upload`);
            errorMessage = `Multiple people named '${supervisorValue}' found (${sources.join(', ')}). Please use a unique identifier.`;
          }
          // If exactly 1 match (either in Planday or Excel), it's valid - no error

          if (hasError) {
            affectedRows++;
            totalErrors++;

            const key = `supervisors:${normalizedSupervisorName}`;
            const pattern: ErrorPattern = errorPatterns.get(key) || {
              field: 'supervisors',
              invalidName: supervisorValue,
              count: 0,
              rows: [],
              confidence: 0,
              errorMessage: errorMessage
            };

            pattern.count++;
            pattern.rows.push(rowIndex + 1); // 1-based row numbers

            if (isAmbiguous) {
              pattern.suggestion = undefined; // No suggestion for ambiguous names
              pattern.confidence = 0; // Cannot auto-fix
              pattern.errorMessage = errorMessage;
            } else if (plandayResult.suggestions.length > 0) {
              // Not found but has fuzzy suggestions from Planday
              pattern.suggestion = plandayResult.suggestions[0];
              pattern.confidence = 0.8;
            }

            errorPatterns.set(key, pattern);
          }
        }
      }
    });

    const patterns = Array.from(errorPatterns.values())
      .sort((a, b) => b.count - a.count); // Sort by frequency

    const canBulkFix = patterns
      .filter(pattern => pattern.confidence > 0.7)
      .reduce((sum, pattern) => sum + pattern.count, 0);

    return {
      totalErrors,
      patterns,
      affectedRows,
      canBulkFix
    };
  }

  /**
   * Apply bulk correction to dataset
   */
  applyBulkCorrection(
    employees: any[],
    pattern: ErrorPattern,
    newValue: string
  ): any[] {
    return employees.map(employee => {
      // Map the pattern field to the actual employee field name
      let actualFieldName: string;
      if (pattern.field === 'employeeTypes') {
        actualFieldName = 'employeeTypeId';
      } else if (pattern.field === 'supervisors') {
        actualFieldName = 'supervisorId';
      } else {
        actualFieldName = pattern.field;
      }

      const fieldValue = employee[actualFieldName];

      if (!fieldValue) {
        return employee;
      }

      // Convert to string for comparison
      const fieldValueStr = String(fieldValue);
      const invalidNameLower = pattern.invalidName.toLowerCase();

      // Check if this employee has the invalid value
      const hasInvalidValue =
        pattern.field === 'employeeTypes' || pattern.field === 'supervisors'
          ? fieldValueStr.toLowerCase() === invalidNameLower
          : fieldValueStr.toLowerCase().includes(invalidNameLower);

      if (!hasInvalidValue) {
        return employee;
      }

      let updatedValue: string;

      // Handle single value fields (employeeTypes, supervisors) vs comma-separated (departments, employeeGroups)
      if (pattern.field === 'employeeTypes' || pattern.field === 'supervisors') {
        // Single values - direct replacement
        updatedValue = fieldValueStr.toLowerCase() === invalidNameLower ? newValue : fieldValueStr;
      } else {
        // Handle comma-separated values for departments and employee groups
        updatedValue = fieldValueStr
          .split(',')
          .map((item: string) => item.trim())
          .map((item: string) =>
            item.toLowerCase() === invalidNameLower ? newValue : item
          )
          .join(', ');
      }

      return {
        ...employee,
        [actualFieldName]: updatedValue,
        _bulkCorrected: {
          ...employee._bulkCorrected,
          [actualFieldName]: [...(employee._bulkCorrected?.[actualFieldName] || []), {
            from: pattern.invalidName,
            to: newValue,
            timestamp: new Date()
          }]
        }
      };
    });
  }

  /**
   * Get available names for a field type
   */
  getAvailableNames(type: 'departments' | 'employeeGroups'): string[] {
    return type === 'departments'
      ? Array.from(this.departmentsById.values())
      : Array.from(this.employeeGroupsById.values());
  }

  /**
   * Get available options with IDs for reference
   * Uses field definitions for employee types when available
   */
  getAvailableOptions(type: 'departments' | 'employeeGroups' | 'employeeTypes' | 'supervisors'): Array<{id: number, name: string}> {
    let result: Array<{id: number, name: string}>;

    if (type === 'departments') {
      result = this.departments.map(d => ({id: d.id, name: d.name}));
    } else if (type === 'employeeGroups') {
      result = this.employeeGroups.map(g => ({id: g.id, name: g.name}));
    } else if (type === 'employeeTypes') {
      // Try field definitions first (PRIMARY SOURCE)
      if (FieldDefinitionValidator.isEnumField('employeeTypeId')) {
        result = FieldDefinitionValidator.getFieldOptions('employeeTypeId');
        // Using field definitions for employee type options
      } else {
        // Fallback to API data
        result = this.employeeTypes.map(t => ({id: t.id, name: t.name}));
        console.warn('⚠️ Field definitions not available for employeeTypeId, using API fallback for options');
      }
    } else if (type === 'supervisors') {
      result = this.supervisors.map(s => ({id: s.id, name: s.name}));
    } else {
      result = [];
    }

    return result;
  }

  /**
   * Validate and convert employee data for Planday API
   */
  async validateAndConvert(employee: any): Promise<{
    isValid: boolean;
    converted: any;
    errors: ValidationError[];
  }> {
    const errors: ValidationError[] = [];
    const converted = { ...employee };

    // Handle date fields conversion using new DateParser (hiredFrom, birthDate)
    // Only parse dates if user has resolved ambiguity or if no ambiguous dates exist
    const dateFields = ['hiredFrom', 'birthDate'];
    for (const field of dateFields) {
      if (employee[field] && employee[field].toString().trim() !== '') {
        const dateStr = employee[field].toString().trim();
        
        // Check if this date value looks like a date
        if (DateParser.couldBeDate(dateStr)) {
          // Check if this specific date is ambiguous
          const ambiguousDates = DateParser.findAmbiguousDates([dateStr]);
          
          if (ambiguousDates.length > 0) {
            // This date is ambiguous and user hasn't selected format yet
            // Keep original value and don't convert yet
            converted[field] = dateStr;
            console.log(`📅 Preserving ambiguous date "${dateStr}" for user format selection`);
          } else {
            // Date is unambiguous or user has already set format preference
            const convertedDate = DateParser.parseToISO(dateStr);
            
            if (convertedDate) {
              converted[field] = convertedDate;
            } else {
              errors.push({
                field: field as any,
                value: dateStr,
                message: `Invalid date format. Supported: YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYYMMDD, named months, etc.`,
                rowIndex: employee.rowIndex || 0,
                severity: 'error'
              });
            }
          }
        } else {
          // Value doesn't look like a date 
          errors.push({
            field: field as any,
            value: dateStr,
            message: `Value "${dateStr}" doesn't appear to be a valid date. Supported: YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYYMMDD, named months, etc.`,
            rowIndex: employee.rowIndex || 0,
            severity: 'error'
          });
        }
      }
    }

    // Handle departments - NEW: Individual field approach
    const assignedDepartments: string[] = [];
    const departmentIds: number[] = [];
    let primaryDepartmentId: number | null = null;

    // Process individual department fields

    // Scan for individual department fields (departments.Kitchen, departments.Bar, etc.)
    Object.keys(employee).forEach(fieldName => {
      if (fieldName.startsWith('departments.') && employee[fieldName]) {
        const departmentName = fieldName.replace('departments.', '');
        const value = employee[fieldName]?.toString()?.trim();

        // Any non-empty value means assign this department
        if (value && value !== '' && value.toLowerCase() !== 'no' && value.toLowerCase() !== 'false') {
          assignedDepartments.push(departmentName);

          // Convert department name to ID
          const deptId = this.departmentsByName.get(this.normalizeName(departmentName));
          if (deptId) {
            departmentIds.push(deptId);

            // Check if this department should be primary (marked with "xx" or "XX")
            if (value.toLowerCase() === 'xx') {
              primaryDepartmentId = deptId;
            }
          } else {
            errors.push({
              field: fieldName as any,
              value: departmentName,
              message: `Department "${departmentName}" not found in portal`,
              rowIndex: employee.rowIndex || 0,
              severity: 'error'
            });
          }
        }
      }
    });
    
    // Set converted departments array and comma-separated editable field
    if (departmentIds.length > 0) {
      converted.departments = assignedDepartments.join(', '); // Store as comma-separated names for editing
      converted.__departmentsIds = departmentIds; // Store IDs separately for API payload

      // Set primary department only if explicitly marked with "xx"
      if (primaryDepartmentId) {
        converted.primaryDepartmentId = primaryDepartmentId;
      }
    } else {
      // Always create editable field, even if empty
      converted.departments = '';
      converted.__departmentsIds = [];
      // Every employee must have at least one department (required by Planday),
      // even when no department column was mapped at all.
      errors.push({
        field: 'departments' as any,
        value: '',
        message: 'At least one department must be assigned to each employee',
        rowIndex: employee.rowIndex || 0,
        severity: 'error'
      });
    }

    // Handle employee groups - NEW: Individual field approach with hourly rate support
    const assignedEmployeeGroups: string[] = [];
    const employeeGroupIds: number[] = [];
    const employeeGroupPayrates: Array<{ groupId: number; groupName: string; hourlyRate: number }> = [];

    // Scan for individual employee group fields (employeeGroups.Reception, employeeGroups.Waiter, etc.)
    Object.keys(employee).forEach(fieldName => {
      if (fieldName.startsWith('employeeGroups.') && employee[fieldName]) {
        const groupName = fieldName.replace('employeeGroups.', '');
        const value = employee[fieldName]?.toString()?.trim();

        // Any non-empty value means assign this employee group
        if (value && value !== '' && value.toLowerCase() !== 'no' && value.toLowerCase() !== 'false') {
          assignedEmployeeGroups.push(groupName);

          // Convert employee group name to ID
          const groupId = this.employeeGroupsByName.get(this.normalizeName(groupName));
          if (groupId) {
            employeeGroupIds.push(groupId);

            // Check if value is numeric (indicates hourly rate)
            // "X", "x", "yes", "true" = assignment only, numeric value = hourly rate
            const lowerValue = value.toLowerCase();
            if (lowerValue !== 'x' && lowerValue !== 'yes' && lowerValue !== 'true') {
              const numericValue = normalizeDecimal(value);
              if (!isNaN(numericValue)) {
                if (numericValue > 0) {
                  // Store as hourly rate
                  employeeGroupPayrates.push({
                    groupId,
                    groupName,
                    hourlyRate: numericValue
                  });
                } else if (numericValue < 0) {
                  // Negative rate is invalid
                  errors.push({
                    field: fieldName as any,
                    value: value,
                    message: `Hourly rate for "${groupName}" must be positive (got ${value})`,
                    rowIndex: employee.rowIndex || 0,
                    severity: 'error'
                  });
                }
                // numericValue === 0 means assign without rate (like "X")
              }
            }
          } else {
            errors.push({
              field: fieldName as any,
              value: groupName,
              message: `Employee group "${groupName}" not found in portal`,
              rowIndex: employee.rowIndex || 0,
              severity: 'error'
            });
          }
        }
      }
    });

    // Set converted employee groups array and comma-separated editable field
    if (employeeGroupIds.length > 0) {
      converted.employeeGroups = assignedEmployeeGroups.join(', '); // Store as comma-separated names for editing
      converted.__employeeGroupsIds = employeeGroupIds; // Store IDs separately for API payload
    } else {
      // Always create editable field, even if empty
      converted.employeeGroups = '';
      converted.__employeeGroupsIds = [];
    }

    // Store payrate data for post-creation API calls
    if (employeeGroupPayrates.length > 0) {
      converted.__employeeGroupPayrates = employeeGroupPayrates;
    }

    // Handle skills - Individual field approach (skills.Bartending, skills.Cooking, etc.)
    const assignedSkills: string[] = [];
    const skillIds: number[] = [];

    // Scan for individual skill fields
    Object.keys(employee).forEach(fieldName => {
      if (fieldName.startsWith('skills.') && employee[fieldName]) {
        const skillName = fieldName.replace('skills.', '');
        const value = employee[fieldName]?.toString()?.trim();

        // Any non-empty value (X, x, yes, true) means assign this skill
        if (value && value !== '' && value.toLowerCase() !== 'no' && value.toLowerCase() !== 'false') {
          assignedSkills.push(skillName);

          // Convert skill name to ID
          const skillId = this.skillsByName.get(this.normalizeName(skillName));
          if (skillId) {
            skillIds.push(skillId);
          } else {
            errors.push({
              field: fieldName as any,
              value: skillName,
              message: `Skill "${skillName}" not found in portal`,
              rowIndex: employee.rowIndex || 0,
              severity: 'error'
            });
          }
        }
      }
    });

    // Set converted skills array
    if (skillIds.length > 0) {
      converted.skillIds = skillIds; // Store IDs for API payload (skillIds is sent directly in employee creation)
      converted.skills = assignedSkills.join(', '); // Store as comma-separated names for display
    }

    // Handle wageValidFrom date field (for payrate API, not employee creation)
    if (employee.wageValidFrom && employee.wageValidFrom.toString().trim() !== '') {
      const dateStr = employee.wageValidFrom.toString().trim();

      if (DateParser.couldBeDate(dateStr)) {
        const convertedDate = DateParser.parseToISO(dateStr);

        if (convertedDate) {
          converted.wageValidFrom = convertedDate;
        } else {
          errors.push({
            field: 'wageValidFrom' as any,
            value: dateStr,
            message: `Invalid wage valid from date format. Use YYYY-MM-DD format.`,
            rowIndex: employee.rowIndex || 0,
            severity: 'error'
          });
        }
      } else {
        errors.push({
          field: 'wageValidFrom' as any,
          value: dateStr,
          message: `"${dateStr}" doesn't appear to be a valid date. Use YYYY-MM-DD format.`,
          rowIndex: employee.rowIndex || 0,
          severity: 'error'
        });
      }
    }

    // Handle employee type (single value)
    if (employee.employeeTypeId) {
      // Convert to string to handle numeric IDs
      const employeeTypeStr = employee.employeeTypeId.toString().trim();
      const typeResult = this.resolveEmployeeType(employeeTypeStr);
      if (typeResult.errors.length > 0) {
        errors.push({
          field: 'employeeTypeId',
          value: employee.employeeTypeId,
          message: typeResult.errors.join(', '),
          rowIndex: employee.rowIndex || 0,
          severity: 'error'
        });
      }
      // Set the ID if we found a match - ensure it's always a number
      if (typeResult.ids.length > 0) {
        const resolvedId = typeResult.ids[0];
        const numericId = typeof resolvedId === 'string' ? parseInt(resolvedId, 10) : resolvedId;
        // Store numeric ID internally for API payload (same pattern as departments/employeeGroups)
        (converted as any).__employeeTypeId = numericId;
        // Store human-readable name for UI display
        const typeName = this.employeeTypesById.get(numericId);
        converted.employeeTypeId = typeName || String(numericId);
      }
    }

    // Handle supervisorId - store name for deferred resolution after all employees created
    // NOTE: supervisorId must be assigned via PUT after employee creation (not accepted in POST)
    // IMPORTANT: We do NOT resolve supervisor name to ID here because the supervisor might be
    // a new employee being created in the same batch (marked with isSupervisor: X).
    // The supervisor list will be refreshed AFTER all employees are created, then names resolved to IDs.
    if (employee.supervisorId) {
      const supervisorStr = employee.supervisorId.toString().trim();
      if (supervisorStr !== '') {
        // Store the raw supervisor name for deferred resolution
        // The name will be resolved to an ID after all employees are created and supervisor list is refreshed
        converted.__supervisorAssignment = {
          supervisorName: supervisorStr,
          supervisorId: null // Will be resolved after employee creation
        };
        // Keep original value for display in UI
        converted.supervisorId = supervisorStr;
      }
    }

    // Handle isSupervisor - convert to boolean
    if (employee.isSupervisor !== undefined && employee.isSupervisor !== null && employee.isSupervisor !== '') {
      const isSupervisorStr = employee.isSupervisor.toString().toLowerCase().trim();
      if (['true', 'yes', '1', 'y', 'x'].includes(isSupervisorStr)) {
        converted.isSupervisor = true;
      } else if (['false', 'no', '0', 'n', ''].includes(isSupervisorStr)) {
        converted.isSupervisor = false;
      } else {
        errors.push({
          field: 'isSupervisor',
          value: employee.isSupervisor,
          message: `Invalid value "${employee.isSupervisor}". Use true/false, yes/no, 1/0, or x for yes.`,
          rowIndex: employee.rowIndex || 0,
          severity: 'error'
        });
      }
    }

    // Handle Fixed Salary fields (all-or-nothing validation)
    // Three fields: salaryPeriod (type), salaryHours, salaryAmount
    const salaryPeriod = employee.salaryPeriod?.toString()?.trim() || '';
    const salaryHoursStr = employee.salaryHours?.toString()?.trim() || '';
    const salaryAmountStr = employee.salaryAmount?.toString()?.trim() || '';

    // Count how many salary fields are filled
    const salaryFieldsFilled = [salaryPeriod, salaryHoursStr, salaryAmountStr].filter(v => v !== '').length;

    if (salaryFieldsFilled > 0 && salaryFieldsFilled < 3) {
      // Partial salary info - error
      const missingFields = [];
      if (!salaryPeriod) missingFields.push('Fixed Salary - Period');
      if (!salaryHoursStr) missingFields.push('Fixed Salary - Expected working hours');
      if (!salaryAmountStr) missingFields.push('Fixed Salary - Amount');

      errors.push({
        field: 'fixedSalary',
        value: `Period: ${salaryPeriod || '(empty)'}, Hours: ${salaryHoursStr || '(empty)'}, Amount: ${salaryAmountStr || '(empty)'}`,
        message: `Fixed salary requires all 3 fields or none. Missing: ${missingFields.join(', ')}`,
        rowIndex: employee.rowIndex || 0,
        severity: 'error'
      });
    } else if (salaryFieldsFilled === 3) {
      // All fields filled - validate values
      let salaryValid = true;

      // Validate salary period (type)
      const salaryTypeResult = this.resolveSalaryType(salaryPeriod);
      if (salaryTypeResult.errors.length > 0) {
        errors.push({
          field: 'salaryPeriod',
          value: salaryPeriod,
          message: salaryTypeResult.errors.join(', '),
          rowIndex: employee.rowIndex || 0,
          severity: 'error'
        });
        salaryValid = false;
      }

      // Validate hours is a number (supports both , and . as decimal separators)
      const salaryHours = normalizeDecimal(salaryHoursStr);
      if (isNaN(salaryHours) || salaryHours <= 0) {
        errors.push({
          field: 'salaryHours',
          value: salaryHoursStr,
          message: 'Expected working hours must be a positive number',
          rowIndex: employee.rowIndex || 0,
          severity: 'error'
        });
        salaryValid = false;
      }

      // Validate amount is a number (supports both , and . as decimal separators)
      const salaryAmount = normalizeDecimal(salaryAmountStr);
      if (isNaN(salaryAmount) || salaryAmount < 0) {
        errors.push({
          field: 'salaryAmount',
          value: salaryAmountStr,
          message: 'Salary amount must be a non-negative number',
          rowIndex: employee.rowIndex || 0,
          severity: 'error'
        });
        salaryValid = false;
      }

      // If all valid, store for assignment after creation
      if (salaryValid && salaryTypeResult.ids.length === 1) {
        const salaryTypeName = this.salaryTypesById.get(salaryTypeResult.ids[0]) || salaryPeriod;
        converted.__fixedSalaryAssignment = {
          salaryTypeId: salaryTypeResult.ids[0],
          salaryTypeName: salaryTypeName,
          hours: salaryHours,
          salary: salaryAmount
        };
        // Keep display values for UI
        converted.salaryPeriod = salaryTypeName;
        converted.salaryHours = salaryHours;
        converted.salaryAmount = salaryAmount;
      }
    }

    // Handle Contract Rule (optional single field)
    const contractRuleStr = employee.contractRule?.toString()?.trim() || '';
    if (contractRuleStr !== '') {
      const contractRuleResult = this.resolveContractRule(contractRuleStr);

      if (contractRuleResult.errors.length > 0) {
        errors.push({
          field: 'contractRule',
          value: contractRuleStr,
          message: contractRuleResult.errors[0],
          rowIndex: employee.rowIndex || 0,
          severity: 'error'
        });
      } else if (contractRuleResult.ids.length === 1) {
        // Store for assignment after creation
        const contractRuleName = this.contractRulesById.get(contractRuleResult.ids[0]) || contractRuleStr;
        converted.__contractRuleAssignment = {
          contractRuleId: contractRuleResult.ids[0],
          contractRuleName: contractRuleName
        };
        // Keep display value for UI
        converted.contractRule = contractRuleName;
      }
    }

    // Handle phone numbers with country code extraction
    // Convert cellPhone to string and check if it's not empty
    const cellPhoneStr = employee.cellPhone?.toString()?.trim() || '';
    if (cellPhoneStr !== '') {
      // Simplified phone parsing - user must specify country code
      const countryCode = employee.cellPhoneCountryCode?.toString()?.trim() || '';
      
      if (countryCode) {
        try {
          const { PhoneParser } = await import('../utils');
          const parseResult = PhoneParser.parsePhoneNumberWithCountry(cellPhoneStr, countryCode);
          
          if (parseResult.isValid && parseResult.phoneNumber && parseResult.countryCode) {
            // Set the parsed phone number and country information
            converted.cellPhone = parseResult.phoneNumber;
            converted.cellPhoneCountryCode = parseResult.countryCode;
            if (parseResult.countryId) {
              converted.cellPhoneCountryId = parseResult.countryId;
            }
          } else {
            // Keep original value if parsing failed - validation will catch this
            converted.cellPhone = cellPhoneStr;
            converted.cellPhoneCountryCode = countryCode;
          }
        } catch (error) {
          console.warn('⚠️ Error parsing phone number:', error);
          // Fallback to original values
          converted.cellPhone = cellPhoneStr;
          converted.cellPhoneCountryCode = countryCode;
        }
      } else {
        // No country code provided - keep original phone number
        converted.cellPhone = cellPhoneStr;
      }
    }

    // Auto-populate userName from email
    // userName is required for Planday API employee creation (used as login)
    // Always use the current email value (in case user corrected it)
    if (converted.email) {
      converted.userName = converted.email;
    }

    // Handle custom field type conversion using ValidationService
    const customFieldResult = ValidationService.convertAllCustomFields(employee, employee.rowIndex || 0);
    
    // Apply converted custom field values
    Object.assign(converted, customFieldResult.convertedFields);
    
    // Add any custom field conversion errors
    errors.push(...customFieldResult.errors);
    
    // Log warnings for custom field conversions
    if (customFieldResult.warnings.length > 0) {
      console.warn(`⚠️ Custom field warnings for employee at row ${employee.rowIndex || 0}:`, customFieldResult.warnings);
    }
    
    // Log only if there are errors or warnings for debugging
    if (customFieldResult.errors.length > 0 || customFieldResult.warnings.length > 0) {
      console.warn(`🔧 Custom field issues for row ${employee.rowIndex || 0}:`, {
        errors: customFieldResult.errors.length,
        warnings: customFieldResult.warnings.length
      });
    }

    return {
      isValid: errors.length === 0,
      converted,
      errors
    };
  }

  /**
   * Generate Excel template with available names
   */
  generateTemplate(): {
    headers: string[];
    examples: string[][];
    instructions: Record<string, string>;
  } {
    return {
      headers: [
        'firstName',
        'lastName', 
        'email',
        'departments',
        'employeeGroups',
        'hiredFrom'
      ],
      examples: [],
      instructions: {
        departments: `Available departments: ${this.getAvailableNames('departments').join(', ')}`,
        employeeGroups: `Available employee groups: ${this.getAvailableNames('employeeGroups').join(', ')}`,
        general: 'Use comma-separated names for multiple departments/groups. Example: "Kitchen,Bar" or "Chef,Manager"'
      }
    };
  }

  /**
   * Generate a comprehensive Excel template based on portal fields
   * Orders fields logically: required first, then optional, then custom
   */
  static generatePortalTemplate(options?: { includeSupervisorColumns?: boolean; includeFixedSalaryColumns?: boolean }): {
    headers: string[];
    examples: string[][];
    instructions: Record<string, string>;
    fieldOrder: Array<{ field: string; displayName: string; isRequired: boolean; isCustom: boolean; description?: string; isComplexSubField?: boolean }>;
    fieldDescriptions: Record<string, {
      description: string;
      required: boolean;
      fieldType: string;
      options: string;
      guidance: string;
    }>;
  } {
    const { includeSupervisorColumns = false, includeFixedSalaryColumns = false } = options || {};

    // Get flattened field information including complex object sub-fields
    const allAvailableFields = ValidationService.getAllAvailableFields();

    // Template generation using complex object flattening

    // Build ordered field list using flattened fields with logical ordering
    const fieldOrder: Array<{ field: string; displayName: string; isRequired: boolean; isCustom: boolean; description?: string; isComplexSubField?: boolean }> = [];
    const processedFields = new Set<string>();

    // Fields to exclude from templates because they are auto-populated or deprecated
    const excludedFields = [
      'phone', 'phoneCountryCode', 'primaryDepartmentId', // phone/phoneCountryCode fields removed (only cellPhone/cellPhoneCountryCode supported), primaryDepartmentId is set via "xx" in department columns
      'cellPhoneCountryPrefix', // unsupported for bulk upload
      'contractRulesRuleId', // internal reference, not user-settable
      'countryId',           // internal ID, not useful for bulk import
      'description',         // not a standard employee field for creation
      'isPublic',            // internal flag
      'subdivisionId',       // internal reference
      'securityGroups',      // managed separately, not via bulk upload
      'dateTimeCreated',     // read-only system timestamp
      'dateTimeModified',    // read-only system timestamp
      'hiredDate',           // duplicate of hiredFrom; only hiredFrom should be shown
    ];

    // Exclude supervisor fields if not requested
    if (!includeSupervisorColumns) {
      excludedFields.push('supervisorId', 'isSupervisor');
    }

    // Exclude fixed salary fields if not requested
    if (!includeFixedSalaryColumns) {
      excludedFields.push('salaryPeriod', 'salaryHours', 'salaryAmount');
    }
    
    // Create field map for easy lookup
    const fieldMap = new Map<string, any>();
    allAvailableFields.forEach(field => {
      fieldMap.set(field.field, field);
    });
    
    // Column group order shared with the in-app review table (see getFieldGroupRank):
    // 1. HR -> 2. Custom -> 3. Supervisor -> 4. Contract Rule -> 5. wageValidFrom ->
    // 6. Fixed Salary -> 7. Skills -> 8. Departments -> 9. Employee Groups.

    // Curated order for the HR group (personal/employment fields). Supervisor,
    // contract rule, wageValidFrom and fixed-salary fields are emitted as their
    // own ordered groups below rather than interleaved here.
    const hrFieldOrder = [
      'firstName',
      'lastName',
      'email',
      'cellPhone',
      'cellPhoneCountryCode',
      'employeeTypeId',
      'hiredFrom',
      'gender',
      'birthDate',
      'street1',
      'city',
      'zip',
      'jobTitle',
      'ssn',
      'payrollId'
    ];

    const supervisorFields = ['supervisorId', 'isSupervisor'];
    const fixedSalaryFields = ['salaryPeriod', 'salaryHours', 'salaryAmount'];

    // Add a single named standard field (if present and not excluded/already added)
    const addNamedField = (fieldName: string) => {
      const field = fieldMap.get(fieldName);
      if (field && !excludedFields.includes(field.field) && !processedFields.has(field.field)) {
        fieldOrder.push({
          field: field.field,
          displayName: field.displayName,
          isRequired: field.isRequired,
          isCustom: field.isCustom,
          description: field.description,
          isComplexSubField: field.isComplexSubField
        });
        processedFields.add(field.field);
      }
    };

    // Add a dynamic category of standard fields, sorted by display name
    const addFieldCategory = (filterFn: (field: any) => boolean) => {
      allAvailableFields
        .filter(field => !field.isCustom && !processedFields.has(field.field) && !excludedFields.includes(field.field))
        .filter(filterFn)
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .forEach(field => {
          fieldOrder.push({
            field: field.field,
            displayName: field.displayName,
            isRequired: field.isRequired,
            isCustom: false,
            isComplexSubField: field.isComplexSubField
          });
          processedFields.add(field.field);
        });
    };

    // 1. HR fields — curated order first, then any remaining standard fields that
    //    don't belong to one of the dedicated groups below (alphabetical).
    hrFieldOrder.forEach(addNamedField);
    addFieldCategory(f =>
      !f.field.startsWith('skills.') &&
      !f.field.startsWith('departments.') &&
      !f.field.startsWith('employeeGroups.') &&
      !supervisorFields.includes(f.field) &&
      !fixedSalaryFields.includes(f.field) &&
      f.field !== 'contractRule' &&
      f.field !== 'wageValidFrom'
    );

    // 2. Custom fields (right after the standard HR fields)
    allAvailableFields
      .filter(field => field.isCustom && !processedFields.has(field.field))
      .forEach(field => {
        fieldOrder.push({
          field: field.field,
          displayName: field.displayName,
          isRequired: field.isRequired,
          isCustom: true,
          description: field.description,
          isComplexSubField: false
        });
        processedFields.add(field.field);
      });

    // 3. Supervisor fields
    supervisorFields.forEach(addNamedField);

    // 4. Contract Rule
    addNamedField('contractRule');

    // 5. wageValidFrom (between Contract Rule and Fixed Salary)
    addNamedField('wageValidFrom');

    // 6. Fixed Salary fields
    fixedSalaryFields.forEach(addNamedField);

    // 7. Skills (fields starting with "skills.") — placed just before
    //    Departments/Employee Groups so portals with hundreds of skills don't
    //    push the commonly scanned columns far to the right.
    addFieldCategory(f => f.field.startsWith('skills.'));

    // 8. Departments (fields starting with "departments.")
    addFieldCategory(f => f.field.startsWith('departments.'));

    // 9. Employee Groups (fields starting with "employeeGroups.")
    //    Hourly rates are entered via this column, not a separate hourlyRate column.
    addFieldCategory(f => f.field.startsWith('employeeGroups.'));

    // Generate headers (only include relevant fields)
    const headers = fieldOrder.map(f => f.displayName);
    
    // Create empty template with just headers - no sample data
    const examples: string[][] = [];
    
    // Generate instructions dynamically based on actual fields
    const instructions: Record<string, string> = {
      general: 'Fill in employee data. Required fields must be completed. Use the exact department and employee group names from your Planday portal.',
    };
    
    // Add field-specific instructions
    fieldOrder.forEach(field => {
      if (field.isCustom && field.description) {
        // Enhanced custom field instructions with enum options
        let instruction = field.description;
        
        // Add enum options if available for custom fields
        try {
          if (FieldDefinitionValidator.isEnumField(field.field)) {
            const enumOptions = FieldDefinitionValidator.getFieldOptions(field.field);
            if (enumOptions.length > 0) {
              const optionsList = enumOptions.map(opt => opt.name).join(', ');
              instruction += `. Available options: ${optionsList}`;
            }
          }
        } catch {
          // Keep original description if enum detection fails
        }
        
        instructions[field.field] = instruction;
      } else {
        // Standard field instructions
        switch (field.field) {
          case 'firstName':
            instructions[field.field] = 'Employee\'s first name (required)';
            break;
          case 'lastName':
            instructions[field.field] = 'Employee\'s last name (required)';
            break;
          case 'email':
            instructions[field.field] = 'Email address that will be used for login (required, must be unique)';
            break;
          case 'employeeTypeId':
            // Use field definitions for employee type options
            try {
              const employeeTypeOptions = FieldDefinitionValidator.getFieldOptions('employeeTypeId');
              if (employeeTypeOptions.length > 0) {
                const optionsList = employeeTypeOptions.map(opt => opt.name).join(', ');
                instructions[field.field] = `Employee type from your portal. Available: ${optionsList}`;
              } else {
                instructions[field.field] = 'Employee type ID (use values from your Planday portal)';
              }
            } catch {
              instructions[field.field] = 'Employee type ID (use values from your Planday portal)';
            }
            break;
          case 'cellPhoneCountryCode':
            // Use field definitions for country code options
            try {
              const countryOptions = FieldDefinitionValidator.getFieldOptions('cellPhoneCountryCode');
              if (countryOptions.length > 0) {
                const exampleCodes = countryOptions.slice(0, 8).map(opt => opt.name).join(', ');
                instructions[field.field] = `Country code (ISO 3166-1 alpha-2). Examples: ${exampleCodes}`;
              } else {
                instructions[field.field] = 'Country code (ISO 3166-1 alpha-2, e.g., DK, SE, NO, UK)';
              }
            } catch {
              instructions[field.field] = 'Country code (ISO 3166-1 alpha-2, e.g., DK, SE, NO, UK)';
            }
            break;
          case 'gender':
            // Use field definitions for gender options
            try {
              const genderOptions = FieldDefinitionValidator.getFieldOptions('gender');
              if (genderOptions.length > 0) {
                const optionsList = genderOptions.map(opt => opt.name).join(', ');
                instructions[field.field] = `Gender. Available: ${optionsList}`;
              } else {
                instructions[field.field] = 'Gender (Male/Female)';
              }
            } catch {
              instructions[field.field] = 'Gender (Male/Female)';
            }
            break;
          case 'cellPhone':
            instructions[field.field] = 'Mobile phone number (optional)';
            break;
          case 'hiredFrom':
            instructions[field.field] = 'Hire date in YYYY-MM-DD format (e.g., 2024-01-15)';
            break;
          case 'birthDate':
            instructions[field.field] = 'Birth date in YYYY-MM-DD format (e.g., 1990-03-15)';
            break;
          case 'street1':
            instructions[field.field] = 'Street address';
            break;
          case 'city':
            instructions[field.field] = 'City';
            break;
          case 'zip':
            instructions[field.field] = 'ZIP/Postal code';
            break;
          case 'jobTitle':
            instructions[field.field] = 'Job title or position';
            break;
          case 'employeeId':
            instructions[field.field] = 'Internal employee ID (if applicable)';
            break;
          case 'payrollId':
            instructions[field.field] = 'Payroll system ID (if applicable)';
            break;
          case 'ssn':
            instructions[field.field] = 'Social Security Number (if required by your portal)';
            break;

          case 'wageValidFrom':
            instructions[field.field] = 'Date when hourly pay rates and fixed salaries take effect (YYYY-MM-DD format).';
            break;
          case 'contractRule':
            // List available contract rules from the portal
            if (mappingService.contractRules.length > 0) {
              const contractRuleNames = mappingService.contractRules.map(cr => cr.name).join(', ');
              instructions[field.field] = `Contract rule defining contracted hours. Available: ${contractRuleNames}`;
            } else {
              instructions[field.field] = 'Contract rule name (e.g., 37 hours/week). Use values from your Planday portal.';
            }
            break;
          case 'salaryPeriod':
            // List available salary types from the portal
            if (mappingService.salaryTypes.length > 0) {
              const salaryTypeNames = mappingService.salaryTypes.map(st => st.name).join(', ');
              instructions[field.field] = `Fixed salary period type. Available: ${salaryTypeNames}`;
            } else {
              instructions[field.field] = 'Salary period type (e.g., Monthly, Weekly). Use values from your Planday portal.';
            }
            break;
          case 'salaryHours':
            instructions[field.field] = 'Expected working hours for the salary period (e.g., 160 for monthly). Required if salaryPeriod is specified.';
            break;
          case 'salaryAmount':
            instructions[field.field] = 'Fixed salary amount for the period (e.g., 30000). Required if salaryPeriod is specified.';
            break;
          case 'supervisorId':
            instructions[field.field] = 'Supervisor name or ID to assign to this employee. The supervisor must already exist in Planday.';
            break;
          case 'isSupervisor':
            instructions[field.field] = 'Set to "Yes", "X", or "true" to make this employee a supervisor. Leave empty if not a supervisor.';
            break;
          default:
            // Handle individual department, employee group, and skill fields
            if (field.field.startsWith('departments.')) {
              const departmentName = field.field.replace('departments.', '');
              instructions[field.field] = `Check this column if employee works in ${departmentName} department. Use "X" or "Yes" to assign, or "XX" to assign AND set as primary department. Leave empty to skip.`;
            } else if (field.field.startsWith('employeeGroups.')) {
              const groupName = field.field.replace('employeeGroups.', '');
              instructions[field.field] = `Assign to ${groupName} group: Use "X" to assign without rate, or enter hourly rate (e.g., 15.50) to assign with pay rate. Leave empty to skip.`;
            } else if (field.field.startsWith('skills.')) {
              const skillName = field.field.replace('skills.', '');
              instructions[field.field] = `Mark with "X" to assign skill '${skillName}' to this employee. Leave empty to skip.`;
            } else if (field.isComplexSubField && field.field.includes('.')) {
              // Handle complex object sub-fields
              const [parentField, subField] = field.field.split('.');
              if (parentField === 'bankAccount') {
                if (subField === 'accountNumber') {
                  instructions[field.field] = 'Bank account number';
                } else if (subField === 'registrationNumber') {
                  instructions[field.field] = 'Bank registration number';
                } else {
                  instructions[field.field] = `Bank account ${subField}`;
                }
              } else {
                instructions[field.field] = `${parentField} ${subField}`;
              }
            } else {
              // Check if this field has enum options from field definitions
              try {
                if (FieldDefinitionValidator.isEnumField(field.field)) {
                  const enumOptions = FieldDefinitionValidator.getFieldOptions(field.field);
                  if (enumOptions.length > 0) {
                    const optionsList = enumOptions.slice(0, 10).map(opt => opt.name).join(', ');
                    instructions[field.field] = `Select from available options: ${optionsList}`;
                  } else {
                    instructions[field.field] = `Enter appropriate value for ${field.field}`;
                  }
                } else {
                  instructions[field.field] = `Enter appropriate value for ${field.field}`;
                }
              } catch {
                instructions[field.field] = `Enter appropriate value for ${field.field}`;
              }
            }
        }
      }
    });

    // Build fieldDescriptions for the Descriptions sheet
    const fieldDescriptions: Record<string, {
      description: string;
      required: boolean;
      fieldType: string;
      options: string;
      guidance: string;
    }> = {};

    // Helper to determine field type for standard fields
    const getStandardFieldType = (fieldName: string): string => {
      // Date fields
      if (['hiredFrom', 'birthDate', 'wageValidFrom'].includes(fieldName)) return 'Date';
      // Number fields
      if (['salaryHours', 'salaryAmount'].includes(fieldName)) return 'Number';
      // Dropdown fields
      if (['cellPhoneCountryCode', 'employeeTypeId', 'gender', 'contractRule', 'salaryPeriod'].includes(fieldName)) return 'Dropdown';
      // Checkbox fields
      if (fieldName === 'isSupervisor') return 'Checkbox (X)';
      // Phone field
      if (fieldName === 'cellPhone') return 'Text (phone number)';
      // Complex sub-field categories
      if (fieldName.startsWith('departments.')) return 'Checkbox (X/XX)';
      if (fieldName.startsWith('employeeGroups.')) return 'Hourly Rate';
      if (fieldName.startsWith('skills.')) return 'Checkbox (X)';
      if (fieldName.startsWith('hourlyRate.')) return 'Number';
      if (fieldName.startsWith('bankAccount.')) return 'Text';
      // Default text fields
      return 'Text';
    };

    fieldOrder.forEach(field => {
      let description = '';
      let fieldType = '';
      let optionsStr = '';
      let guidance = '';

      if (field.isCustom) {
        // Custom field - use existing utilities
        description = field.description || 'Custom field';
        try {
          const customType = ValidationService.getCustomFieldType(field.field);
          // Show booleans as "Checkbox (X)" consistent with skills/departments
          fieldType = customType === 'optionalBoolean'
            ? 'Checkbox (X)'
            : ValidationService.getFieldTypeDisplayName(customType);

          // Get guidance - use standard checkbox text for booleans
          if (customType === 'optionalBoolean') {
            guidance = 'X to assign. Leave empty to skip.';
          } else {
            const hints = ValidationService.getConversionHints(customType, field.field);
            guidance = hints.join('. ');
          }

          // Get dropdown options for enum fields
          if (FieldDefinitionValidator.isEnumField(field.field)) {
            const enumOptions = FieldDefinitionValidator.getFieldOptions(field.field);
            if (enumOptions.length > 0) {
              optionsStr = enumOptions.map(opt => opt.name).join(', ');
            }
          }
        } catch {
          fieldType = 'Text';
          guidance = 'Enter appropriate value';
        }
      } else {
        // Standard field
        fieldType = getStandardFieldType(field.field);
        description = instructions[field.field] || '';

        // Build options and guidance per field
        switch (field.field) {
          case 'firstName':
            description = "Employee's first name";
            guidance = 'e.g., John';
            break;
          case 'lastName':
            description = "Employee's last name";
            guidance = 'e.g., Smith';
            break;
          case 'email':
            description = 'Email address used for Planday login (must be unique)';
            guidance = 'e.g., john.smith@example.com';
            break;
          case 'cellPhone':
            description = 'Mobile phone number';
            guidance = 'e.g., 12345678 (digits only, no country code prefix)';
            break;
          case 'cellPhoneCountryCode':
            description = 'Country code for cell phone (ISO 3166-1 alpha-2)';
            try {
              const countryOpts = FieldDefinitionValidator.getFieldOptions('cellPhoneCountryCode');
              if (countryOpts.length > 0) {
                optionsStr = countryOpts.slice(0, 15).map(opt => opt.name).join(', ') +
                  (countryOpts.length > 15 ? ` (+${countryOpts.length - 15} more)` : '');
              }
            } catch { /* keep empty */ }
            guidance = 'e.g., DK, SE, NO, UK, US';
            break;
          case 'employeeTypeId':
            description = 'Employee type classification';
            try {
              const empTypeOpts = FieldDefinitionValidator.getFieldOptions('employeeTypeId');
              if (empTypeOpts.length > 0) {
                optionsStr = empTypeOpts.map(opt => opt.name).join(', ');
              }
            } catch { /* keep empty */ }
            guidance = 'Use exact name from dropdown options';
            break;
          case 'contractRule':
            description = 'Contract rule defining contracted hours per period';
            if (mappingService.contractRules.length > 0) {
              optionsStr = mappingService.contractRules.map(cr => cr.name).join(', ');
            }
            guidance = 'Use exact name from your portal';
            break;
          case 'hiredFrom':
            description = 'Date the employee was/will be hired';
            guidance = 'Recommended: YYYY-MM-DD (e.g., 2024-01-15). Other common formats are also accepted.';
            break;
          case 'wageValidFrom':
            description = 'Date when hourly rates and fixed salaries take effect';
            guidance = 'Recommended: YYYY-MM-DD (e.g., 2024-01-15). Other common formats are also accepted.';
            break;
          case 'salaryPeriod':
            description = 'Fixed salary period type';
            if (mappingService.salaryTypes.length > 0) {
              optionsStr = mappingService.salaryTypes.map(st => st.name).join(', ');
            }
            guidance = 'Use exact name from your portal';
            break;
          case 'salaryHours':
            description = 'Expected working hours for the salary period';
            guidance = 'e.g., 160 for monthly, 37.5 or 37,5 for weekly. Both . and , accepted as decimal separator.';
            break;
          case 'salaryAmount':
            description = 'Fixed salary amount for the period';
            guidance = 'e.g., 30000 or 30000,50 (numeric value, no currency symbol). Both . and , accepted as decimal separator.';
            break;
          case 'supervisorId':
            description = 'Supervisor to assign (must already exist in Planday)';
            guidance = "Enter EXACT name of supervisor";
            break;
          case 'isSupervisor':
            description = 'Whether this employee should be a supervisor';
            guidance = 'X to assign. Leave empty to skip.';
            break;
          case 'gender':
            description = 'Employee gender';
            try {
              const genderOpts = FieldDefinitionValidator.getFieldOptions('gender');
              if (genderOpts.length > 0) {
                optionsStr = genderOpts.map(opt => opt.name).join(', ');
              }
            } catch { /* keep empty */ }
            guidance = 'Use exact value from dropdown options';
            break;
          case 'birthDate':
            description = 'Employee date of birth';
            guidance = 'Recommended: YYYY-MM-DD (e.g., 1990-03-15). Other common formats are also accepted.';
            break;
          case 'street1':
            description = 'Street address';
            guidance = 'e.g., 123 Main Street';
            break;
          case 'city':
            description = 'City of residence';
            guidance = 'e.g., Copenhagen';
            break;
          case 'zip':
            description = 'ZIP or postal code';
            guidance = 'e.g., 1000';
            break;
          case 'jobTitle':
            description = 'Job title or position';
            guidance = 'e.g., Bartender, Chef, Manager';
            break;
          case 'ssn':
            description = 'Social Security Number';
            guidance = 'Format depends on country. Enter as text.';
            break;
          case 'payrollId':
            description = 'ID in external payroll system';
            guidance = 'e.g., EMP-001 (alphanumeric)';
            break;
          default:
            // Handle sub-field categories
            if (field.field.startsWith('departments.')) {
              const deptName = field.field.replace('departments.', '');
              description = `Assign to "${deptName}" department`;
              guidance = 'X = assign, XX = assign as primary department. Leave empty to skip.';
            } else if (field.field.startsWith('employeeGroups.')) {
              const groupName = field.field.replace('employeeGroups.', '');
              description = `Assign to "${groupName}" employee group`;
              guidance = 'X = assign without rate, or enter hourly rate (e.g., 15.50 or 15,50). Both . and , accepted. Leave empty to skip.';
            } else if (field.field.startsWith('skills.')) {
              const skillName = field.field.replace('skills.', '');
              description = `Assign "${skillName}" skill`;
              guidance = 'X to assign. Leave empty to skip.';
            } else if (field.field.startsWith('hourlyRate.')) {
              const rateName = field.field.replace('hourlyRate.', '');
              description = `Hourly rate for "${rateName}"`;
              guidance = 'Numeric value (e.g., 15.50 or 15,50). Both . and , accepted as decimal separator. Leave empty to skip.';
            } else if (field.isComplexSubField && field.field.includes('.')) {
              const [parentField, subField] = field.field.split('.');
              if (parentField === 'bankAccount') {
                if (subField === 'accountNumber') {
                  description = 'Bank account number';
                  guidance = 'Enter account number as text';
                } else if (subField === 'registrationNumber') {
                  description = 'Bank registration number';
                  guidance = 'Enter registration number as text';
                } else {
                  description = `Bank account ${subField}`;
                  guidance = 'Enter value as text';
                }
              } else {
                description = `${parentField} - ${subField}`;
                guidance = 'Enter appropriate value';
              }
            } else {
              // Fallback: try to get enum options for unknown standard fields
              try {
                if (FieldDefinitionValidator.isEnumField(field.field)) {
                  const enumOptions = FieldDefinitionValidator.getFieldOptions(field.field);
                  if (enumOptions.length > 0) {
                    optionsStr = enumOptions.slice(0, 10).map(opt => opt.name).join(', ');
                    fieldType = 'Dropdown';
                  }
                }
              } catch { /* keep defaults */ }
              if (!description) description = instructions[field.field] || `Value for ${field.displayName}`;
              if (!guidance) guidance = 'Enter appropriate value';
            }
        }
      }

      // Append options to fieldType display if present
      let fieldTypeDisplay = fieldType;
      if (optionsStr) {
        fieldTypeDisplay += ` — Options: ${optionsStr}`;
      }

      fieldDescriptions[field.field] = {
        description,
        required: field.isRequired,
        fieldType: fieldTypeDisplay,
        options: optionsStr,
        guidance
      };
    });

    return {
      headers,
      examples,
      instructions,
      fieldOrder,
      fieldDescriptions
    };
  }

  // Removed unused date validation methods - now handled by DateParser class

  // Removed convertDateToISO and convert8DigitDate methods - now handled by DateParser class

  /**
   * Create a clean payload for Planday API from converted employee data
   * This ensures consistency between preview and actual upload
   * Handles conversion of flattened complex object sub-fields back to nested objects
   * Includes comprehensive validation to catch type mismatches before API submission
   */
  static createApiPayload(converted: any): PlandayEmployeeCreateRequest {
    const cleanPayload: any = {};
    const complexObjects: Record<string, any> = {};
    
    // Define internal fields that should be excluded from the API payload
    const internalFields = new Set([
      'rowIndex', 'originalData', '__internal_id', '_id', '_bulkCorrected',
      '__departmentsIds', '__employeeGroupsIds', '__employeeTypeId', // Internal ID fields for API payload
      '__employeeGroupPayrates', 'wageValidFrom', // Payrate fields (handled separately after employee creation)
      '__supervisorAssignment', 'supervisorId', // Supervisor assignment (must be PUT after employee creation, not POST)
      '__fixedSalaryAssignment', 'salaryPeriod', 'salaryHours', 'salaryAmount', // Fixed salary (PUT after employee creation)
      '__contractRuleAssignment', 'contractRule', // Contract rule (PUT after employee creation)
      'skills', // Skills display field (individual skill fields like skills.Bartending)
      'skillIds', // Will be handled specially below to filter out time-limited skills
      '__timeLimitedSkillIds' // Internal field for time-limited skills that couldn't be assigned
    ]);
    
    // Include all fields from the converted employee, excluding internal ones
    Object.entries(converted).forEach(([key, value]) => {
      // Skip internal fields, individual department/employee group/skill fields, and undefined/empty values
      if (!internalFields.has(key) &&
          !key.startsWith('departments.') &&
          !key.startsWith('employeeGroups.') &&
          !key.startsWith('skills.') &&
          value != null && value !== '') {
        // Handle complex object sub-fields (e.g., "bankAccount.accountNumber")
        if (key.includes('.') && ValidationService.isComplexObjectSubField(key)) {
          const [parentField, subField] = key.split('.');
          
          // Initialize parent object if it doesn't exist
          if (!complexObjects[parentField]) {
            complexObjects[parentField] = {};
          }
          
          // Add sub-field to parent object
          complexObjects[parentField][subField] = value;
        } else {
          // Handle regular fields
          // For array fields, only include if they have elements
          if (Array.isArray(value)) {
            if (value.length > 0) {
              cleanPayload[key] = value;
            }
          } else {
            cleanPayload[key] = value;
          }
        }
      }
    });
    
    // Add constructed complex objects to payload
    Object.entries(complexObjects).forEach(([parentField, nestedObject]) => {
      // Only include complex objects that have at least one populated sub-field
      if (Object.keys(nestedObject).length > 0) {
        cleanPayload[parentField] = nestedObject;
      }
    });
    
    // Special handling: Use internal ID fields for departments and employee groups
    if (converted.__departmentsIds && Array.isArray(converted.__departmentsIds) && converted.__departmentsIds.length > 0) {
      cleanPayload.departments = converted.__departmentsIds;
    }
    if (converted.__employeeGroupsIds && Array.isArray(converted.__employeeGroupsIds) && converted.__employeeGroupsIds.length > 0) {
      cleanPayload.employeeGroups = converted.__employeeGroupsIds;
    }
    // Special handling: Use internal numeric ID for employeeTypeId (display field stores name)
    if ((converted as any).__employeeTypeId != null) {
      cleanPayload.employeeTypeId = (converted as any).__employeeTypeId;
    }

    // Convert primaryDepartmentId from name to ID if it's a string
    if (cleanPayload.primaryDepartmentId && typeof cleanPayload.primaryDepartmentId === 'string') {
      const departments = MappingUtils.getDepartments();
      const deptName = cleanPayload.primaryDepartmentId.trim().toLowerCase();
      const matchingDept = departments.find(d => d.name.toLowerCase() === deptName);
      if (matchingDept) {
        cleanPayload.primaryDepartmentId = matchingDept.id;
      } else {
        // Remove invalid primaryDepartmentId - Planday API expects a numeric ID
        console.warn(`⚠️ primaryDepartmentId "${cleanPayload.primaryDepartmentId}" not found in departments list, removing from payload`);
        delete cleanPayload.primaryDepartmentId;
      }
    }

    // NOTE: supervisorId is excluded from POST payload - must be assigned via PUT after employee creation
    // The __supervisorAssignment internal field stores the data for later processing

    // Convert isSupervisor to boolean if it's a string
    if (cleanPayload.isSupervisor !== undefined && typeof cleanPayload.isSupervisor === 'string') {
      const val = cleanPayload.isSupervisor.toLowerCase().trim();
      if (['true', 'yes', '1', 'y', 'x'].includes(val)) {
        cleanPayload.isSupervisor = true;
      } else if (['false', 'no', '0', 'n', ''].includes(val)) {
        cleanPayload.isSupervisor = false;
      } else {
        // Unknown value - remove it
        console.warn(`⚠️ isSupervisor unknown value "${cleanPayload.isSupervisor}", removing from payload`);
        delete cleanPayload.isSupervisor;
      }
    }

    // Handle skillIds - filter out time-limited skills (they require ValidFrom/ValidTo dates)
    if (converted.skillIds && Array.isArray(converted.skillIds) && converted.skillIds.length > 0) {
      const regularSkillIds: number[] = [];
      const timeLimitedSkillIds: number[] = [];

      converted.skillIds.forEach((skillId: number) => {
        if (mappingService.isSkillTimeLimited(skillId)) {
          timeLimitedSkillIds.push(skillId);
        } else {
          regularSkillIds.push(skillId);
        }
      });

      // Only include non-time-limited skills in the payload
      if (regularSkillIds.length > 0) {
        cleanPayload.skillIds = regularSkillIds;
      }

      // Store time-limited skills for warning display (this won't be sent to API)
      if (timeLimitedSkillIds.length > 0) {
        const timeLimitedNames = timeLimitedSkillIds.map(id => mappingService.getSkillName(id) || `ID:${id}`);
        console.warn(`⚠️ Skipping ${timeLimitedSkillIds.length} time-limited skills (require manual assignment): ${timeLimitedNames.join(', ')}`);
        // Store in converted object for the warning message (not in cleanPayload)
        converted.__timeLimitedSkillIds = timeLimitedSkillIds;
      }
    }

    // Ensure required fields have defaults if needed
    // userName is required for API - always use the current email value (in case user corrected it)
    if (cleanPayload.email) {
      cleanPayload.userName = cleanPayload.email;
    }
    
    // Ensure we have a default gender if not provided
    if (!cleanPayload.gender) {
      cleanPayload.gender = 'Male';
    }
    
    // ✅ CRITICAL PAYLOAD VALIDATION - Catch type mismatches before API submission
    this.validatePayloadTypes(cleanPayload);
    
    return cleanPayload as PlandayEmployeeCreateRequest;
  }

  /**
   * Validate API payload types against field definitions
   * Throws error if critical type mismatches are found (like string employeeTypeId)
   */
  private static validatePayloadTypes(payload: any): void {
    const validationErrors: string[] = [];
    
    // Critical validation: employeeTypeId must be numeric if present
    if (payload.employeeTypeId !== undefined) {
      if (typeof payload.employeeTypeId === 'string') {
        // This should NEVER happen after proper conversion
        validationErrors.push(`❌ CRITICAL: employeeTypeId is string "${payload.employeeTypeId}" but API expects numeric ID. This indicates a conversion failure.`);
      } else if (!Number.isInteger(payload.employeeTypeId)) {
        validationErrors.push(`❌ CRITICAL: employeeTypeId "${payload.employeeTypeId}" is not a valid integer.`);
      }
    }
    
    // Validate array fields contain only numbers (departments, employeeGroups)
    ['departments', 'employeeGroups'].forEach(field => {
      if (payload[field] && Array.isArray(payload[field])) {
        const invalidIds = payload[field].filter((id: any) => !Number.isInteger(id));
        if (invalidIds.length > 0) {
          validationErrors.push(`❌ CRITICAL: ${field} contains non-numeric IDs: ${invalidIds.join(', ')}. API expects numeric IDs only.`);
        }
      }
    });
    
    // Validate field definitions constraints if available
    if (FieldDefinitionValidator.isEnumField('employeeTypeId') && payload.employeeTypeId !== undefined) {
      const validation = FieldDefinitionValidator.validateFieldValue('employeeTypeId', payload.employeeTypeId);
      if (!validation.isValid) {
        validationErrors.push(`❌ CRITICAL: employeeTypeId "${payload.employeeTypeId}" failed field definition validation: ${validation.error}`);
      }
    }
    
    // Throw error if any critical validation failures found
    if (validationErrors.length > 0) {
      const errorMessage = [
        '🛑 PAYLOAD VALIDATION FAILED - Upload aborted to prevent API errors:',
        ...validationErrors,
        '',
        '💡 This indicates a bug in the conversion logic that should be reported.',
        '📋 Payload that failed validation:',
        JSON.stringify(payload, null, 2)
      ].join('\n');
      
      console.error(errorMessage);
      throw new Error(`Payload validation failed: ${validationErrors.join('; ')}`);
    }
    

  }


}

/**
 * Singleton instance of the mapping service
 */
export const mappingService = new MappingService();

/**
 * Canonical column group order, shared by the Excel template
 * (MappingService.generatePortalTemplate) and the in-app review table
 * (FinalPreviewStep) so both surfaces present columns in the same group order.
 *
 * Lower rank = further left. Order:
 *   1. HR / standard fields
 *   2. Custom fields (custom_*)
 *   3. Supervisor fields
 *   4. Contract Rule
 *   5. wageValidFrom
 *   6. Fixed Salary fields
 *   7. Skills
 *   8. Departments
 *   9. Employee Groups
 *
 * Works for both the template's individual sub-fields (e.g. "skills.Bartending")
 * and the review table's consolidated columns (e.g. "skills").
 */
export function getFieldGroupRank(field: string): number {
  if (field.startsWith('employeeGroups.') || field === 'employeeGroups') return 9;
  if (field.startsWith('departments.') || field === 'departments') return 8;
  if (field.startsWith('skills.') || field === 'skills') return 7;
  if (field === 'salaryPeriod' || field === 'salaryHours' || field === 'salaryAmount') return 6;
  if (field === 'wageValidFrom') return 5;
  if (field === 'contractRule') return 4;
  if (field === 'supervisorId' || field === 'isSupervisor') return 3;
  if (field.startsWith('custom_')) return 2;
  return 1; // HR / standard fields
}

/**
 * Convenience functions for common operations
 */
export const MappingUtils = {
  /**
   * Initialize with Planday data
   */
  initialize(departments: PlandayDepartment[], employeeGroups: PlandayEmployeeGroup[], employeeTypes: PlandayEmployeeType[] = []): void {
    mappingService.initialize(departments, employeeGroups, employeeTypes);
  },

  /**
   * Resolve names to IDs
   */
  resolveNames(input: string, type: 'departments' | 'employeeGroups'): MappingResult {
    return mappingService.resolveNames(input, type);
  },

  /**
   * Detect common errors for bulk correction
   */
  detectCommonErrors(employees: any[]): BulkCorrectionSummary {
    return mappingService.detectCommonErrors(employees);
  },

  /**
   * Apply bulk corrections
   */
  applyBulkCorrection(employees: any[], pattern: ErrorPattern, newValue: string): any[] {
    return mappingService.applyBulkCorrection(employees, pattern, newValue);
  },

  /**
   * Validate and convert employee data
   */
  async validateEmployee(employee: any) {
    return await mappingService.validateAndConvert(employee);
  },

  /**
   * Get available options for dropdowns
   */
  getAvailableOptions(type: 'departments' | 'employeeGroups' | 'employeeTypes' | 'supervisors') {
    return mappingService.getAvailableOptions(type);
  },

  /**
   * Get stored departments data
   */
  getDepartments(): PlandayDepartment[] {
    return [...mappingService.departments];
  },

  /**
   * Get stored employee groups data
   */
  getEmployeeGroups(): PlandayEmployeeGroup[] {
    return [...mappingService.employeeGroups];
  },

  /**
   * Get stored employee types data
   */
  getEmployeeTypes(): PlandayEmployeeType[] {
    return [...mappingService.employeeTypes];
  },

  /**
   * Set supervisors data (called after authentication)
   */
  setSupervisors(supervisors: PlandaySupervisor[]): void {
    mappingService.setSupervisors(supervisors);
  },

  /**
   * Get stored supervisors data
   */
  getSupervisors(): PlandaySupervisor[] {
    return [...mappingService.supervisors];
  },

  /**
   * Resolve supervisor name to ID
   */
  resolveSupervisor(input: string): MappingResult {
    return mappingService.resolveSupervisor(input);
  },

  /**
   * Set skills data (called after authentication)
   */
  setSkills(skills: PlandaySkill[]): void {
    mappingService.setSkills(skills);
  },

  /**
   * Get stored skills data
   */
  getSkills(): PlandaySkill[] {
    return [...mappingService.skills];
  },

  /**
   * Resolve skill name to ID
   */
  resolveSkill(input: string): MappingResult {
    return mappingService.resolveSkill(input);
  },

  /**
   * Set salary types data (called after authentication)
   */
  setSalaryTypes(salaryTypes: PlandaySalaryType[]): void {
    mappingService.setSalaryTypes(salaryTypes);
  },

  /**
   * Get stored salary types data
   */
  getSalaryTypes(): PlandaySalaryType[] {
    return [...mappingService.salaryTypes];
  },

  /**
   * Resolve salary type name to ID
   */
  resolveSalaryType(input: string): MappingResult {
    return mappingService.resolveSalaryType(input);
  },

  /**
   * Set contract rules data (called after authentication)
   */
  setContractRules(contractRules: PlandayContractRule[]): void {
    mappingService.setContractRules(contractRules);
  },

  /**
   * Get stored contract rules data
   */
  getContractRules(): PlandayContractRule[] {
    return [...mappingService.contractRules];
  },

  /**
   * Resolve contract rule name to ID
   */
  resolveContractRule(input: string): MappingResult {
    return mappingService.resolveContractRule(input);
  },

  /**
   * Check if the service has been initialized with data
   */
  isInitialized(): boolean {
    return mappingService.departments.length > 0 && mappingService.employeeGroups.length > 0;
  },

  /**
   * Generate template
   */
  generateTemplate() {
    return mappingService.generateTemplate();
  },

  /**
   * Create a clean payload for Planday API from converted employee data
   * This ensures consistency between preview and actual upload
   */
  createApiPayload(converted: any): PlandayEmployeeCreateRequest {
    return MappingService.createApiPayload(converted);
  }
};

/**
 * Validation Service
 * Handles dynamic validation based on Planday field definitions
 */
export class ValidationService {
  private static fieldDefinitions: PlandayFieldDefinitionsSchema | null = null;
  private static hasLoggedRequiredFields: boolean = false;

  /**
   * Initialize validation service with field definitions
   */
  static initialize(fieldDefinitions: PlandayFieldDefinitionsSchema): void {
    this.fieldDefinitions = fieldDefinitions;
    this.hasLoggedRequiredFields = false;
    
    if (!this.hasLoggedRequiredFields) {
      // ValidationService initialized with field definitions
      this.hasLoggedRequiredFields = true;
    }
  }

  /**
   * Detect and flatten complex object fields into user-friendly sub-fields
   * Converts complex objects like bankAccount into separate mappable fields
   * Now also generates dynamic fields for departments and employee groups
   */
  static getComplexObjectSubFields(): Array<{ 
    parentField: string; 
    subField: string; 
    displayName: string; 
    fullFieldPath: string;
    isRequired: boolean;
  }> {
    if (!this.fieldDefinitions) {
      return [];
    }

    const subFields: Array<{ 
      parentField: string; 
      subField: string; 
      displayName: string; 
      fullFieldPath: string;
      isRequired: boolean;
    }> = [];

    // EXISTING: Check each field in the schema for static complex objects (like bankAccount)
    Object.entries(this.fieldDefinitions.properties).forEach(([fieldName, fieldConfig]) => {
      if (fieldConfig && typeof fieldConfig === 'object') {
        let objectConfig = fieldConfig;
        
        // If the field has a $ref, resolve it from definitions
        if (fieldConfig.$ref && this.fieldDefinitions?.definitions) {
          const refName = fieldConfig.$ref.replace('#/definitions/', '');
          const resolvedConfig = this.fieldDefinitions.definitions[refName];
          if (resolvedConfig && typeof resolvedConfig === 'object') {
            objectConfig = resolvedConfig;
          }
        }
        
        // Check if this is a complex object field (has nested properties)
        if (objectConfig.type === 'object' && objectConfig.properties) {
          // Extract sub-fields from the object
          Object.entries(objectConfig.properties).forEach(([subFieldName, _subFieldConfig]) => {
            const displayName = this.generateSubFieldDisplayName(fieldName, subFieldName);
            const fullFieldPath = `${fieldName}.${subFieldName}`;
            
            subFields.push({
              parentField: fieldName,
              subField: subFieldName,
              displayName,
              fullFieldPath,
              isRequired: this.isRequired(fieldName) // Inherit parent's required status
            });
          });
        }
      }
    });

    // NEW: Generate dynamic department fields from portal data
    if (mappingService.departments.length > 0) {
      mappingService.departments.forEach(dept => {
        subFields.push({
          parentField: 'departments',
          subField: dept.name,
          displayName: `Department: ${dept.name}`,
          fullFieldPath: `departments.${dept.name}`,
          isRequired: false // Individual department assignments are optional
        });
      });
    }

    // NEW: Generate dynamic employee group fields from portal data
    if (mappingService.employeeGroups.length > 0) {
      mappingService.employeeGroups.forEach(group => {
        subFields.push({
          parentField: 'employeeGroups',
          subField: group.name,
          displayName: `Employee Group: ${group.name}`,
          fullFieldPath: `employeeGroups.${group.name}`,
          isRequired: false // Individual employee group assignments are optional
        });
      });
    }

    // NEW: Generate dynamic skill fields from portal data
    if (mappingService.skills.length > 0) {
      mappingService.skills.forEach(skill => {
        subFields.push({
          parentField: 'skills',
          subField: skill.name,
          displayName: `Skill: ${skill.name} (x)`,
          fullFieldPath: `skills.${skill.name}`,
          isRequired: false // Individual skill assignments are optional
        });
      });
    }

    return subFields;
  }

  /**
   * Generate user-friendly display names for sub-fields
   */
  private static generateSubFieldDisplayName(parentField: string, subField: string): string {
    // Convert camelCase to Title Case
    const formatFieldName = (name: string): string => {
      return name
        .replace(/([A-Z])/g, ' $1') // Add space before capitals
        .replace(/^./, str => str.toUpperCase()) // Capitalize first letter
        .trim();
    };

    const parentTitle = formatFieldName(parentField);
    const subTitle = formatFieldName(subField);

    return `${parentTitle} - ${subTitle}`;
  }

  /**
   * Check if a field path represents a complex object sub-field
   */
  static isComplexObjectSubField(fieldPath: string): boolean {
    return fieldPath.includes('.') && this.getComplexObjectSubFields().some(
      sub => sub.fullFieldPath === fieldPath
    );
  }

  /**
   * Get all available fields including flattened complex object sub-fields
   * This replaces complex objects with their individual sub-fields for better UX
   * Excludes read-only fields and auto-populated fields from mapping UI
   */
  static getAllAvailableFields(): Array<{ 
    field: string; 
    displayName: string; 
    isRequired: boolean; 
    isCustom: boolean; 
    isComplexSubField: boolean;
    description?: string;
  }> {
    if (!this.fieldDefinitions) {
      return [];
    }

    const fields: Array<{ 
      field: string; 
      displayName: string; 
      isRequired: boolean; 
      isCustom: boolean; 
      isComplexSubField: boolean;
      description?: string;
    }> = [];

    const complexSubFields = this.getComplexObjectSubFields();
    const complexParentFields = new Set(complexSubFields.map(sub => sub.parentField));
    
    // Fields to exclude from mapping UI because they are auto-populated, read-only, or deprecated
    // primaryDepartmentId is set via "xx" marker in department columns, not direct mapping
    const excludedFields = [
      'phone', 'phoneCountryCode', 'primaryDepartmentId',
      'cellPhoneCountryPrefix', // unsupported for bulk upload
      'contractRulesRuleId', // internal reference, not user-settable
      'countryId',           // internal ID, not useful for bulk import
      'description',         // not a standard employee field for creation
      'isPublic',            // internal flag
      'subdivisionId',       // internal reference
      'securityGroups',      // managed separately, not via bulk upload
      'dateTimeCreated',     // read-only system timestamp
      'dateTimeModified',    // read-only system timestamp
      'hiredDate',           // duplicate of hiredFrom; only hiredFrom should be shown
    ];

    // Add standard fields (excluding complex object parents and hardcoded excluded fields)
    // Note: We allow read-only fields during bulk import since users should be able to set initial values
    Object.keys(this.fieldDefinitions.properties)
      .filter(field =>
        !field.startsWith('custom_') &&
        !complexParentFields.has(field) &&
        !excludedFields.includes(field)
        // Removed !this.isReadOnly(field) - allow read-only fields during bulk import
      )
      .forEach(field => {
        fields.push({
          field,
          displayName: field,
          isRequired: this.isRequired(field),
          isCustom: false,
          isComplexSubField: false
        });
      });

    // Add complex object sub-fields instead of parent objects (allow read-only during bulk import)
    complexSubFields.forEach(subField => {
      if (!excludedFields.includes(subField.fullFieldPath)) {
        fields.push({
          field: subField.fullFieldPath,
          displayName: subField.displayName,
          isRequired: subField.isRequired,
          isCustom: false,
          isComplexSubField: true
        });
      }
    });

    // Add custom fields (getCustomFields() already excludes read-only custom fields)
    this.getCustomFields().forEach(customField => {
      fields.push({
        field: customField.name,
        displayName: customField.description || customField.name,
        isRequired: this.isRequired(customField.name),
        isCustom: true,
        isComplexSubField: false,
        description: customField.description
      });
    });

    // Add special bulk upload fields not always included in Planday field definitions API
    fields.push({
      field: 'wageValidFrom',
      displayName: 'Wage Valid From',
      isRequired: false,
      isCustom: false,
      isComplexSubField: false,
      description: 'Date when hourly pay rates and fixed salaries take effect (YYYY-MM-DD)'
    });

    // Add supervisor fields - valid API fields but may not be in field definitions schema
    const existingFieldNames = new Set(fields.map(f => f.field));
    if (!existingFieldNames.has('supervisorId')) {
      fields.push({
        field: 'supervisorId',
        displayName: 'Supervisor',
        isRequired: false,
        isCustom: false,
        isComplexSubField: false,
        description: 'Assigns a supervisor to this employee (enter supervisor name or ID)'
      });
    }
    if (!existingFieldNames.has('isSupervisor')) {
      fields.push({
        field: 'isSupervisor',
        displayName: 'Is Supervisor',
        isRequired: false,
        isCustom: false,
        isComplexSubField: false,
        description: 'Makes this employee a supervisor (true/false, yes/no, or x)'
      });
    }

    // Add fixed salary fields - valid API fields but not in field definitions schema
    if (!existingFieldNames.has('salaryPeriod')) {
      fields.push({
        field: 'salaryPeriod',
        displayName: 'Fixed Salary - Period',
        isRequired: false,
        isCustom: false,
        isComplexSubField: false,
        description: 'Salary period type (e.g., Monthly, Weekly). Requires all 3 salary fields.'
      });
    }
    if (!existingFieldNames.has('salaryHours')) {
      fields.push({
        field: 'salaryHours',
        displayName: 'Fixed Salary - Expected Hours',
        isRequired: false,
        isCustom: false,
        isComplexSubField: false,
        description: 'Expected working hours for the salary period. Requires all 3 salary fields.'
      });
    }
    if (!existingFieldNames.has('salaryAmount')) {
      fields.push({
        field: 'salaryAmount',
        displayName: 'Fixed Salary - Amount',
        isRequired: false,
        isCustom: false,
        isComplexSubField: false,
        description: 'Salary amount for the period. Requires all 3 salary fields.'
      });
    }

    // Add contract rule field - valid API field but not in field definitions schema
    if (!existingFieldNames.has('contractRule')) {
      fields.push({
        field: 'contractRule',
        displayName: 'Contract Rule',
        isRequired: false,
        isCustom: false,
        isComplexSubField: false,
        description: 'Contract rule defining contracted hours (e.g., 37 hours/week). Enter the contract rule name.'
      });
    }

    // Add core system fields that are always required but may not be in field definitions
    if (!existingFieldNames.has('firstName')) {
      fields.push({
        field: 'firstName',
        displayName: 'firstName',
        isRequired: true,
        isCustom: false,
        isComplexSubField: false,
        description: 'Employee first name (required)'
      });
    }
    if (!existingFieldNames.has('lastName')) {
      fields.push({
        field: 'lastName',
        displayName: 'lastName',
        isRequired: true,
        isCustom: false,
        isComplexSubField: false,
        description: 'Employee last name (required)'
      });
    }

    return fields.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /**
   * Get required fields for the current portal
   * Note: email is always required for ALL portals to create employees,
   * even if the API field definitions don't mark them as required
   * Note: departments are now handled via individual department fields, not the parent field
   */
  static getRequiredFields(): string[] {
    if (!this.fieldDefinitions) {
      console.warn('⚠️ Field definitions not loaded, using fallback required fields');
      return ['firstName', 'lastName', 'email']; // Safe fallback with business-critical fields (departments handled individually now)
    }
    
    // Start with fields marked as required by the API (defensive: handle missing required array)
    const apiRequiredFields = [...(this.fieldDefinitions.required || [])];
    
    // Always ensure email is marked as required
    // This is business-critical for creating employees in ANY Planday portal (userName is auto-populated from email)
    const businessCriticalFields = ['email'];
    
    for (const field of businessCriticalFields) {
      if (!apiRequiredFields.includes(field)) {
        // Force-marking business-critical field as required
        apiRequiredFields.push(field);
      }
    }
    
    // Remove departments from required fields since we now use individual department fields
    const filteredFields = apiRequiredFields.filter(field => field !== 'departments' && field !== 'employeeGroups');
    
    if (!this.hasLoggedRequiredFields) {
      this.hasLoggedRequiredFields = true;
    }
    
    return filteredFields;
  }

  /**
   * Get read-only fields that cannot be modified
   */
  static getReadOnlyFields(): string[] {
    if (!this.fieldDefinitions) {
      return [];
    }
    return this.fieldDefinitions.readOnly || [];
  }

  /**
   * Get unique fields that must be unique across employees
   */
  static getUniqueFields(): string[] {
    if (!this.fieldDefinitions) {
      return [];
    }
    return this.fieldDefinitions.unique || [];
  }

  /**
   * Check if a field is required
   */
  static isRequired(fieldName: string): boolean {
    return this.getRequiredFields().includes(fieldName);
  }

  /**
   * Check if a field is read-only
   */
  static isReadOnly(fieldName: string): boolean {
    return this.getReadOnlyFields().includes(fieldName);
  }

  /**
   * Check if a field must be unique
   */
  static isUnique(fieldName: string): boolean {
    return this.getUniqueFields().includes(fieldName);
  }

  /**
   * Get custom fields with their descriptions
   * Includes read-only fields since they can be set during bulk import (initial employee creation)
   */
  static getCustomFields(): Array<{ name: string; description: string }> {
    if (!this.fieldDefinitions) {
      console.warn('⚠️ Field definitions not loaded, custom fields unavailable');
      return [];
    }

    const customFields: Array<{ name: string; description: string }> = [];
    
    for (const [fieldName, fieldConfig] of Object.entries(this.fieldDefinitions.properties)) {
      // Use Planday's actual custom field convention: fields starting with 'custom_'
      if (fieldName.startsWith('custom_')) {
        // Allow read-only custom fields during bulk import since users should be able to set initial values
        customFields.push({
          name: fieldName,
          description: fieldConfig.description || fieldName
        });
      }
    }

    return customFields;
  }

  /**
   * Get custom fields with their type information
   * Includes read-only fields since they can be set during bulk import (initial employee creation)
   */
  static getCustomFieldsWithTypes(): CustomFieldInfo[] {
    if (!this.fieldDefinitions) {
      return [];
    }

    const customFields: CustomFieldInfo[] = [];
    
    for (const [fieldName, fieldConfig] of Object.entries(this.fieldDefinitions.properties)) {
      if (fieldName.startsWith('custom_')) {
        const fieldType = this.detectCustomFieldType(fieldConfig.$ref, fieldConfig);
        
        // Allow read-only custom fields during bulk import since users should be able to set initial values
        // Extract enum values for dropdown fields
        let enumValues: string[] | undefined;
        let enumOptions: Array<{ value: any; label: string }> | undefined;
        
        if (fieldType === 'optionalEnum') {
          const extracted = this.extractEnumValues(fieldConfig);
          enumValues = extracted.values;
          enumOptions = extracted.options;
        }
        
        customFields.push({
          fieldName,
          fieldType,
          description: fieldConfig.description,
          isRequired: (this.fieldDefinitions.required || []).includes(fieldName),
          enumValues,
          enumOptions
        });
      }
    }

    return customFields;
  }

  /**
   * Detect field type from $ref value and field configuration
   * Enhanced to handle enum/dropdown fields and custom definitions
   */
  private static detectCustomFieldType(ref?: string, fieldConfig?: any): CustomFieldType {
    if (!ref) {
      return 'unknown';
    }
    
    // Check if field has enum values directly (dropdown/select field)
    if (fieldConfig && (fieldConfig.enum || fieldConfig.values || 
        (fieldConfig.anyOf && fieldConfig.anyOf.some((option: any) => option.enum || option.values)))) {
      return 'optionalEnum';
    }
    
    // Check if it's a custom definition (like #/definitions/optionalCustom196907)
    if (ref.startsWith('#/definitions/optionalCustom') && this.fieldDefinitions) {
      const definitionKey = ref.replace('#/definitions/', '');
      const definition = this.fieldDefinitions.definitions[definitionKey];
      
      if (definition) {
        // Check if the definition contains enum values
        if (definition.enum || definition.values || 
            (definition.anyOf && definition.anyOf.some((option: any) => option.enum || option.values))) {
          return 'optionalEnum';
        }
      }
    }
    
    switch (ref) {
      case '#/definitions/optionalString':
        return 'optionalString';
      case '#/definitions/optionalBoolean':
        return 'optionalBoolean';
      case '#/definitions/optionalNumeric':
        return 'optionalNumeric';
      case '#/definitions/optionalDate':
        return 'optionalDate';
      case '#/definitions/optionalImage':
        return 'optionalImage';
      
      // Additional common patterns that might indicate active fields
      case '#/definitions/string':
        return 'optionalString'; // Treat required string as optional string for bulk upload
      case '#/definitions/numeric':
      case '#/definitions/number':
        return 'optionalNumeric';
      case '#/definitions/boolean':
        return 'optionalBoolean';
      case '#/definitions/date':
        return 'optionalDate';
        
      default:
        return 'unknown';
    }
  }

  /**
   * Convert and validate a custom field value
   */
  static convertCustomFieldValue(
    fieldName: string, 
    value: any, 
    rowIndex: number = 0
  ): CustomFieldConversionResult {
    const result: CustomFieldConversionResult = {
      convertedValue: value,
      errors: [],
      warnings: []
    };

    // Handle empty/null values
    if (value === null || value === undefined || value === '') {
      result.convertedValue = null;
      return result;
    }

    // Get field type
    const fieldInfo = this.getCustomFieldInfo(fieldName);
    if (!fieldInfo) {
      result.warnings.push(`Custom field "${fieldName}" not found in field definitions`);
      return result;
    }

    // Convert based on type
    try {
      switch (fieldInfo.fieldType) {
        case 'optionalString':
          result.convertedValue = this.convertToString(value);
          break;
          
        case 'optionalBoolean':
          result.convertedValue = this.convertToBoolean(value, fieldName, rowIndex, result);
          break;
          
        case 'optionalNumeric':
          result.convertedValue = this.convertToNumber(value, fieldName, rowIndex, result);
          break;
          
        case 'optionalDate':
          result.convertedValue = this.convertToDate(value, fieldName, rowIndex, result);
          break;
          
        case 'optionalEnum':
          result.convertedValue = this.convertToEnum(value, fieldName, rowIndex, result, fieldInfo);
          break;
          
        case 'optionalImage':
          // Images not supported for bulk upload
          result.convertedValue = null;
          result.warnings.push(`Image field "${fieldName}" is not supported for bulk upload - value ignored`);
          break;
          
        default:
          // Unknown type - pass through as string with warning
          result.convertedValue = String(value);
          result.warnings.push(`Unknown custom field type for "${fieldName}" - treating as string`);
      }
    } catch (error) {
      result.errors.push({
        field: fieldName,
        value: value,
        message: `Failed to convert custom field "${fieldName}": ${error instanceof Error ? error.message : 'Unknown error'}`,
        rowIndex,
        severity: 'error'
      });
      result.convertedValue = null;
    }

    return result;
  }

  /**
   * Convert and validate all custom fields in an employee record
   */
  static convertAllCustomFields(employee: any, rowIndex: number = 0): {
    convertedFields: Record<string, any>;
    errors: ValidationError[];
    warnings: string[];
  } {
    const convertedFields: Record<string, any> = {};
    const allErrors: ValidationError[] = [];
    const allWarnings: string[] = [];

    // Process all custom fields in the employee record
    Object.keys(employee).forEach(fieldName => {
      if (fieldName.startsWith('custom_')) {
        const conversionResult = this.convertCustomFieldValue(fieldName, employee[fieldName], rowIndex);
        
        convertedFields[fieldName] = conversionResult.convertedValue;
        allErrors.push(...conversionResult.errors);
        allWarnings.push(...conversionResult.warnings);
      }
    });

    return {
      convertedFields,
      errors: allErrors,
      warnings: allWarnings
    };
  }

  /**
   * Get field type information for a specific custom field
   */
  private static getCustomFieldInfo(fieldName: string): CustomFieldInfo | null {
    if (!this.fieldDefinitions || !fieldName.startsWith('custom_')) {
      return null;
    }

    const fieldConfig = this.fieldDefinitions.properties[fieldName];
    if (!fieldConfig) {
      return null;
    }

    const fieldType = this.detectCustomFieldType(fieldConfig.$ref, fieldConfig);
    
    // Extract enum values for dropdown fields
    let enumValues: string[] | undefined;
    let enumOptions: Array<{ value: any; label: string }> | undefined;
    
    if (fieldType === 'optionalEnum') {
      const extracted = this.extractEnumValues(fieldConfig);
      enumValues = extracted.values;
      enumOptions = extracted.options;
    }

    return {
      fieldName,
      fieldType,
      description: fieldConfig.description,
      isRequired: (this.fieldDefinitions.required || []).includes(fieldName),
      enumValues,
      enumOptions
    };
  }

  /**
   * Get the detected type for a custom field by field name (public accessor)
   */
  static getCustomFieldType(fieldName: string): CustomFieldType {
    const info = this.getCustomFieldInfo(fieldName);
    return info ? info.fieldType : 'unknown';
  }

  /**
   * Convert value to string
   */
  private static convertToString(value: any): string {
    return String(value).trim();
  }

  /**
   * Convert value to boolean with flexible parsing
   */
  private static convertToBoolean(
    value: any, 
    fieldName: string, 
    rowIndex: number,
    result: CustomFieldConversionResult
  ): boolean | null {
    const strValue = String(value).toLowerCase().trim();
    
    // True values
    if (['true', '1', 'yes', 'y', 'on', 'enabled', 'active'].includes(strValue)) {
      return true;
    }
    
    // False values  
    if (['false', '0', 'no', 'n', 'off', 'disabled', 'inactive'].includes(strValue)) {
      return false;
    }
    
    // Invalid boolean value
    result.errors.push({
      field: fieldName,
      value: value,
      message: `Invalid boolean value "${value}" for custom field "${fieldName}". Use: true/false, 1/0, yes/no, y/n, on/off, enabled/disabled, active/inactive`,
      rowIndex,
      severity: 'error'
    });
    
    return null;
  }

  /**
   * Convert value to number with validation
   */
  private static convertToNumber(
    value: any, 
    fieldName: string, 
    rowIndex: number,
    result: CustomFieldConversionResult
  ): number | null {
    // Handle string numbers with potential formatting (supports both , and . as decimal separators)
    const numValue = normalizeDecimal(value);
    
    if (isNaN(numValue)) {
      result.errors.push({
        field: fieldName,
        value: value,
        message: `Invalid numeric value "${value}" for custom field "${fieldName}". Must be a valid number`,
        rowIndex,
        severity: 'error'
      });
      return null;
    }
    
    // Check for reasonable numeric range (avoid extremely large numbers that might be data entry errors)
    if (!isFinite(numValue)) {
      result.errors.push({
        field: fieldName,
        value: value,
        message: `Numeric value "${value}" for custom field "${fieldName}" is too large or infinite`,
        rowIndex,
        severity: 'error'
      });
      return null;
    }
    
    return numValue;
  }

  /**
   * Convert value to ISO date format
   */
  private static convertToDate(
    value: any, 
    fieldName: string, 
    rowIndex: number,
    result: CustomFieldConversionResult
  ): string | null {
    const dateStr = String(value).trim();
    
    // Use existing DateParser logic
    if (!DateParser.couldBeDate(dateStr)) {
      result.errors.push({
        field: fieldName,
        value: value,
        message: `Value "${value}" for custom field "${fieldName}" doesn't appear to be a valid date. Supported formats: YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYYMMDD, named months, etc.`,
        rowIndex,
        severity: 'error'
      });
      return null;
    }
    
    // Check for ambiguous dates
    const ambiguousDates = DateParser.findAmbiguousDates([dateStr]);
    if (ambiguousDates.length > 0) {
      result.errors.push({
        field: fieldName,
        value: value,
        message: `Ambiguous date format "${value}" for custom field "${fieldName}". Please resolve date format ambiguity first`,
        rowIndex,
        severity: 'error'
      });
      return null;
    }
    
    // Convert to ISO format
    const convertedDate = DateParser.parseToISO(dateStr);
    if (!convertedDate) {
      result.errors.push({
        field: fieldName,
        value: value,
        message: `Invalid date format "${value}" for custom field "${fieldName}". Supported formats: YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, MM/DD/YYYY, YYYYMMDD, named months, etc.`,
        rowIndex,
        severity: 'error'
      });
      return null;
    }
    
    return convertedDate;
  }

  /**
   * Convert value to enum with validation against allowed options
   */
  private static convertToEnum(
    value: any, 
    fieldName: string, 
    rowIndex: number,
    result: CustomFieldConversionResult,
    fieldInfo: CustomFieldInfo
  ): any {
    const strValue = String(value).trim();
    
    if (!fieldInfo.enumValues || fieldInfo.enumValues.length === 0) {
      result.warnings.push(`No enum values found for dropdown field "${fieldName}" - treating as string`);
      return strValue;
    }
    
    // Check for exact match (case-sensitive first)
    if (fieldInfo.enumValues.includes(strValue)) {
      return strValue;
    }
    
    // Check for case-insensitive match
    const lowerValue = strValue.toLowerCase();
    const caseInsensitiveMatch = fieldInfo.enumValues.find(enumValue => 
      String(enumValue).toLowerCase() === lowerValue
    );
    
    if (caseInsensitiveMatch) {
      result.warnings.push(`Found case-insensitive match for "${strValue}" → "${caseInsensitiveMatch}" in field "${fieldName}"`);
      return caseInsensitiveMatch;
    }
    
    // Check if it's a numeric value that matches enum options
    if (fieldInfo.enumOptions) {
      const numericValue = normalizeDecimal(strValue);
      if (!isNaN(numericValue)) {
        const numericMatch = fieldInfo.enumOptions.find(option => option.value === numericValue);
        if (numericMatch) {
          return numericMatch.value;
        }
      }
      
      // Check if input matches any label
      const labelMatch = fieldInfo.enumOptions.find(option => 
        String(option.label).toLowerCase() === lowerValue
      );
      if (labelMatch) {
        result.warnings.push(`Found label match for "${strValue}" → "${labelMatch.value}" (${labelMatch.label}) in field "${fieldName}"`);
        return labelMatch.value;
      }
    }
    
    // No match found - this is an error
    const availableValues = fieldInfo.enumOptions 
      ? fieldInfo.enumOptions.map(opt => `${opt.value} (${opt.label})`).join(', ')
      : fieldInfo.enumValues.join(', ');
      
    result.errors.push({
      field: fieldName,
      value: value,
      message: `Invalid value "${strValue}" for dropdown field "${fieldName}". Must be one of: ${availableValues}`,
      rowIndex,
      severity: 'error'
    });
    
    return null;
  }

  /**
   * Extract enum values from field configuration
   * Handles both simple enum arrays, complex anyOf structures, and custom definitions
   */
  private static extractEnumValues(fieldConfig: any): {
    values: string[];
    options: Array<{ value: any; label: string }>;
  } {
    const values: string[] = [];
    const options: Array<{ value: any; label: string }> = [];
    
    let configToCheck = fieldConfig;
    
    // If the field references a custom definition, look it up in definitions
    if (fieldConfig.$ref && fieldConfig.$ref.startsWith('#/definitions/optionalCustom') && this.fieldDefinitions) {
      const definitionKey = fieldConfig.$ref.replace('#/definitions/', '');
      const definition = this.fieldDefinitions.definitions[definitionKey];
      
      if (definition) {
        configToCheck = definition;
      }
    }
    
    // Direct enum/values properties
    if (configToCheck.enum) {
      values.push(...configToCheck.enum);
      configToCheck.enum.forEach((value: any) => {
        options.push({ value, label: String(value) });
      });
    }
    
    if (configToCheck.values) {
      values.push(...configToCheck.values);
      configToCheck.values.forEach((value: any) => {
        options.push({ value, label: String(value) });
      });
    }
    
    // anyOf structure (like employeeType with enum and values)
    if (configToCheck.anyOf && Array.isArray(configToCheck.anyOf)) {
      configToCheck.anyOf.forEach((option: any) => {
        if (option.enum) {
          values.push(...option.enum);
          
          // If there are corresponding values/labels, use them
          if (option.values && option.values.length === option.enum.length) {
            option.enum.forEach((enumValue: any, index: number) => {
              options.push({ 
                value: enumValue, 
                label: option.values[index] || String(enumValue) 
              });
            });
          } else {
            // No labels, use enum values as labels
            option.enum.forEach((enumValue: any) => {
              options.push({ value: enumValue, label: String(enumValue) });
            });
          }
        }
        
        if (option.values) {
          values.push(...option.values);
          option.values.forEach((value: any) => {
            if (!options.some(opt => opt.value === value)) {
              options.push({ value, label: String(value) });
            }
          });
        }
      });
    }
    
    // Remove duplicates
    const uniqueValues = [...new Set(values)];
    const uniqueOptions = options.filter((option, index, self) => 
      index === self.findIndex(opt => opt.value === option.value)
    );
    
    return {
      values: uniqueValues,
      options: uniqueOptions
    };
  }

  /**
   * Get human-readable type name for UI display
   */
  static getFieldTypeDisplayName(fieldType: CustomFieldType): string {
    switch (fieldType) {
      case 'optionalString':
        return 'Text';
      case 'optionalBoolean':
        return 'Yes/No (Boolean)';
      case 'optionalNumeric':
        return 'Number';
      case 'optionalDate':
        return 'Date';
      case 'optionalEnum':
        return 'Dropdown/Select';
      case 'optionalImage':
        return 'Image (not supported)';
      default:
        return 'Unknown';
    }
  }

  /**
   * Get user-friendly conversion hints for a field type
   * Enhanced to include enum options from field definitions when available
   */
  static getConversionHints(fieldType: CustomFieldType, fieldName?: string): string[] {
    switch (fieldType) {
      case 'optionalString':
        return ['Any text value'];
        
      case 'optionalBoolean':
        return [
          'Use: true/false, 1/0, yes/no, y/n',
          'Also: on/off, enabled/disabled, active/inactive'
        ];
        
      case 'optionalNumeric':
        return [
          'Use numeric values (integers or decimals)',
          'Both . and , accepted as decimal separator (e.g., 15.50 or 15,50)'
        ];
        
      case 'optionalDate':
        return [
          'Supported formats: YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY',
          'Also: YYYY/MM/DD, YYYYMMDD, named months'
        ];
        
      case 'optionalEnum': {
        // Enhanced enum hints with actual field definition options
        const baseHints = [
          'Must use one of the predefined dropdown options',
          'Case-insensitive matching supported'
        ];

        // Add specific enum options if field name is provided and field definitions are available
        if (fieldName) {
          try {
            const enumOptions = FieldDefinitionValidator.getFieldOptions(fieldName);
            if (enumOptions.length > 0) {
              const optionsText = enumOptions.slice(0, 6).map(opt => opt.name).join(', ');
              const moreText = enumOptions.length > 6 ? ` (+${enumOptions.length - 6} more)` : '';
              baseHints.push(`Options: ${optionsText}${moreText}`);
            }
          } catch {
            // Fall back to base hints if field definitions not available
          }
        }

        return baseHints;
      }

      case 'optionalImage':
        return ['Image uploads not supported in bulk import'];
        
      default:
        return ['Unknown field type - will be treated as text'];
    }
  }

  /**
   * Validate required fields for an employee
   */
  static validateRequiredFields(employee: any, rowIndex: number = 0): ValidationError[] {
    const errors: ValidationError[] = [];
    const requiredFields = this.getRequiredFields();

    for (const fieldName of requiredFields) {
      const value = employee[fieldName];
      if (!value || (typeof value === 'string' && value.trim() === '')) {
        errors.push({
          field: fieldName,
          value: value,
          message: `${fieldName} is required by your Planday portal`,
          rowIndex,
          severity: 'error'
        });
      }
    }

    // Conditional requirement: cellPhoneCountryCode is required when cellPhone is provided
    const cellPhone = employee.cellPhone?.toString()?.trim() || '';
    const cellPhoneCountryCode = employee.cellPhoneCountryCode?.toString()?.trim() || '';
    
    if (cellPhone && !cellPhoneCountryCode) {
      errors.push({
        field: 'cellPhoneCountryCode',
        value: cellPhoneCountryCode,
        message: 'cellPhoneCountryCode is required when cellPhone is provided. Specify country like "DK", "SE", "Denmark", "Sweden"',
        rowIndex,
        severity: 'error'
      });
    }

    return errors;
  }

  /**
   * Validate unique fields across all employees
   */
  static validateUniqueFields(employees: any[]): ValidationError[] {
    const errors: ValidationError[] = [];
    // Always enforce email and ssn uniqueness in-file, even if the portal schema
    // doesn't flag them as unique. ssn compares exact-string (no normalization),
    // unlike the lowercase+trim applied to email and schema-driven unique fields.
    const uniqueFields = new Set<string>([...this.getUniqueFields(), 'email', 'ssn']);

    for (const fieldName of uniqueFields) {
      const valueMap = new Map<string, number[]>();
      const isSsn = fieldName === 'ssn';

      // Collect all values for this field
      employees.forEach((employee, index) => {
        const rawValue = employee[fieldName];
        if (rawValue === null || rawValue === undefined) return;
        const stringValue = String(rawValue);
        if (stringValue.trim() === '') return;
        // SSN must match character-sensitive (e.g. "123-45-6789" !== "123456789").
        const key = isSsn ? stringValue : stringValue.trim().toLowerCase();
        const indices = valueMap.get(key) || [];
        indices.push(index);
        valueMap.set(key, indices);
      });

      // Check for duplicates
      for (const [_value, indices] of valueMap.entries()) {
        if (indices.length > 1) {
          indices.forEach(index => {
            errors.push({
              field: fieldName,
              value: employees[index][fieldName],
              message: `${fieldName} must be unique across all employees (duplicate found in rows ${indices.map(i => i + 1).join(', ')})`,
              rowIndex: index,
              severity: 'error'
            });
          });
        }
      }
    }

    return errors;
  }

  /**
   * Validate employees against existing Planday employees to check for duplicates
   */
  static validateExistingEmployees(
    employees: any[], 
    existingEmployees: Map<string, any>
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    
    employees.forEach((employee, index) => {
      const email = employee.email;
      if (email && email.trim() !== '') {
        const normalizedEmail = email.toLowerCase().trim();
        const existingEmployee = existingEmployees.get(normalizedEmail);

        if (existingEmployee) {
          errors.push({
            field: 'email',
            value: email,
            message: `Employee with email "${email}" already exists in Planday (ID: ${existingEmployee.id}, Name: ${existingEmployee.firstName} ${existingEmployee.lastName})`,
            rowIndex: index,
            severity: 'error'
          });
        }
      }
    });

    return errors;
  }

  /**
   * Validate employees against existing Planday SSNs to check for duplicates.
   * SSN is matched character-sensitive (no normalization), mirroring the in-file rule.
   */
  static validateExistingEmployeesBySsn(
    employees: any[],
    existingSsnEmployees: Map<string, any>
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (existingSsnEmployees.size === 0) {
      return errors;
    }

    employees.forEach((employee, index) => {
      const ssn = employee.ssn;
      if (ssn === null || ssn === undefined) return;
      const ssnValue = String(ssn);
      if (ssnValue.trim() === '') return;

      const existingEmployee = existingSsnEmployees.get(ssnValue);
      if (existingEmployee) {
        errors.push({
          field: 'ssn',
          value: ssn,
          message: `Employee with SSN "${ssnValue}" already exists in Planday (ID: ${existingEmployee.id}, Name: ${existingEmployee.firstName} ${existingEmployee.lastName})`,
          rowIndex: index,
          severity: 'error'
        });
      }
    });

    return errors;
  }

  /**
   * Validate country code and suggest correct ISO codes
   * Now uses field definitions as primary source, falls back to hardcoded values
   */
  static validateCountryCode(input: string): { isValidCountryCode: boolean; suggestedCode?: string } {
    const normalizedInput = input.toUpperCase().trim();
    
    // First try field definitions for cellPhoneCountryCode or phoneCountryCode
    try {
      const cellPhoneResult = FieldDefinitionValidator.validateFieldValue('cellPhoneCountryCode', normalizedInput);
      if (cellPhoneResult.isValid) {
        // Country code validation successful (removed verbose logging)
        return { isValidCountryCode: true };
      }
      
      // Check if field definitions provide a suggestion
      if (cellPhoneResult.suggestion) {
        console.log(`📋 Country code "${normalizedInput}" suggestion from field definitions: ${cellPhoneResult.suggestion}`);
        return { 
          isValidCountryCode: false, 
          suggestedCode: cellPhoneResult.suggestion 
        };
      }
    } catch (error) {
      console.warn('⚠️ Field definitions not available for country code validation, falling back to hardcoded values:', error);
    }
    
    // Fallback to hardcoded validation (backward compatibility)
    // Common ISO 3166-1 alpha-2 country codes
    const validCodes = new Set([
      'DK', 'SE', 'NO', 'FI', 'IS', // Nordic countries
      'UK', 'GB', 'IE', 'FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'LU', 'AT', 'CH', // Western Europe
      'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'SI', 'EE', 'LV', 'LT', // Eastern Europe
      'US', 'CA', 'MX', 'BR', 'AR', 'CL', 'PE', 'CO', 'VE', // Americas
      'AU', 'NZ', 'JP', 'CN', 'IN', 'KR', 'SG', 'MY', 'TH', 'VN', 'PH', 'ID', // Asia-Pacific
      'ZA', 'EG', 'MA', 'NG', 'KE', 'GH', 'TN', // Africa
      'RU', 'TR', 'UA', 'BY', 'MD', 'GE', 'AM', 'AZ', // Eastern Europe/Asia
    ]);
    
    // If it's already a valid code, return true
    if (validCodes.has(normalizedInput)) {
      // Country code validation successful (removed verbose logging)
      return { isValidCountryCode: true };
    }
    
    // Country name to ISO code mapping (fallback)
    const countryNameMapping: Record<string, string> = {
      // Nordic countries
      'DENMARK': 'DK', 'SWEDEN': 'SE', 'NORWAY': 'NO', 'FINLAND': 'FI', 'ICELAND': 'IS',
      
      // Common European countries
      'UNITED KINGDOM': 'GB', 'ENGLAND': 'GB', 'SCOTLAND': 'GB', 'WALES': 'GB',
      'IRELAND': 'IE', 'FRANCE': 'FR', 'GERMANY': 'DE', 'ITALY': 'IT', 'SPAIN': 'ES',
      'PORTUGAL': 'PT', 'NETHERLANDS': 'NL', 'HOLLAND': 'NL', 'BELGIUM': 'BE',
      'AUSTRIA': 'AT', 'SWITZERLAND': 'CH',
      
      // Other common countries
      'UNITED STATES': 'US', 'USA': 'US', 'AMERICA': 'US', 'CANADA': 'CA',
      'AUSTRALIA': 'AU', 'NEW ZEALAND': 'NZ', 'JAPAN': 'JP', 'CHINA': 'CN',
      'INDIA': 'IN', 'SOUTH KOREA': 'KR', 'KOREA': 'KR', 'RUSSIA': 'RU', 'TURKEY': 'TR',
      'POLAND': 'PL', 'CZECH REPUBLIC': 'CZ', 'HUNGARY': 'HU', 'ROMANIA': 'RO',
      'BULGARIA': 'BG', 'CROATIA': 'HR', 'SLOVENIA': 'SI', 'ESTONIA': 'EE',
      'LATVIA': 'LV', 'LITHUANIA': 'LT',
    };
    
    // Try to find a suggestion from fallback mapping
    const suggestedCode = countryNameMapping[normalizedInput];
    
    console.log(`❌ Country code "${normalizedInput}" not found in field definitions or hardcoded fallback${suggestedCode ? `, suggesting: ${suggestedCode}` : ''}`);
    
    return {
      isValidCountryCode: false,
      suggestedCode
    };
  }

  /**
   * Validate country code fields for an employee
   * Enhanced to use field definition country codes in error messages
   */
  static validateCountryCodeFields(employee: any, rowIndex: number = 0): ValidationError[] {
    const errors: ValidationError[] = [];
    
    // Get available country codes from field definitions for better error messages
    const getCountryCodeExamples = (): string => {
      try {
        const countryOptions = FieldDefinitionValidator.getFieldOptions('cellPhoneCountryCode');
        if (countryOptions.length > 0) {
          // Take first 4 country codes as examples
          const examples = countryOptions.slice(0, 4).map(opt => opt.name).join(', ');
          return `e.g. ${examples}`;
        }
      } catch (error) {
        console.warn('Could not get country code examples from field definitions:', error);
      }
      // Fallback to hardcoded examples
      return 'e.g. DK, SE, NO, UK';
    };
    
    const countryCodeExamples = getCountryCodeExamples();
    
    // Validate phoneCountryCode field
    const phoneCountryCodeStr = employee.phoneCountryCode?.toString()?.trim() || '';
    if (phoneCountryCodeStr !== '') {
      const { isValidCountryCode, suggestedCode } = this.validateCountryCode(phoneCountryCodeStr);
      
      if (!isValidCountryCode) {
        if (suggestedCode) {
          errors.push({
            field: 'phoneCountryCode',
            value: phoneCountryCodeStr,
            message: `"${phoneCountryCodeStr}" should be ISO country code "${suggestedCode}" (${countryCodeExamples})`,
            rowIndex,
            severity: 'error'
          });
        } else {
          errors.push({
            field: 'phoneCountryCode',
            value: phoneCountryCodeStr,
            message: `"${phoneCountryCodeStr}" is not a valid ISO country code (${countryCodeExamples})`,
            rowIndex,
            severity: 'error'
          });
        }
      }
    }

    // Validate cellPhoneCountryCode field  
    const cellPhoneCountryCodeStr = employee.cellPhoneCountryCode?.toString()?.trim() || '';
    if (cellPhoneCountryCodeStr !== '') {
      const { isValidCountryCode, suggestedCode } = this.validateCountryCode(cellPhoneCountryCodeStr);
      
      if (!isValidCountryCode) {
        if (suggestedCode) {
          errors.push({
            field: 'cellPhoneCountryCode',
            value: cellPhoneCountryCodeStr,
            message: `"${cellPhoneCountryCodeStr}" should be ISO country code "${suggestedCode}" (${countryCodeExamples})`,
            rowIndex,
            severity: 'error'
          });
        } else {
          errors.push({
            field: 'cellPhoneCountryCode',
            value: cellPhoneCountryCodeStr,
            message: `"${cellPhoneCountryCodeStr}" is not a valid ISO country code (${countryCodeExamples})`,
            rowIndex,
            severity: 'error'
          });
        }
      }
    }

    return errors;
  }

  /**
   * Get field definitions status
   */
  static getStatus(): {
    isLoaded: boolean;
    portalId: number | null;
    requiredFieldsCount: number;
    customFieldsCount: number;
  } {
    return {
      isLoaded: !!this.fieldDefinitions,
      portalId: this.fieldDefinitions?.portalId || null,
      requiredFieldsCount: this.fieldDefinitions?.required?.length || 0,
      customFieldsCount: this.getCustomFields().length,
    };
  }

  /**
   * Get all field names available from the API
   */
  static getAllFieldNames(): string[] {
    if (!this.fieldDefinitions) {
      return [];
    }
    return Object.keys(this.fieldDefinitions.properties);
  }

  /**
   * Diagnostic method to analyze field classification
   * Call this method to get detailed information about how fields are being classified
   */
  static diagnoseFieldInconsistencies(): {
    isLoaded: boolean;
    fieldClassification: {
      totalApiFields: number;
      standardFields: string[];
      customFields: string[];
      requiredFieldOverrides: string[];
    };
    fieldMapping: {
      apiField: string;
      classification: string;
      isRequired: boolean;
      isCustom: boolean;
      notes: string;
    }[];
  } {
    if (!this.fieldDefinitions) {
      return {
        isLoaded: false,
        fieldClassification: {
          totalApiFields: 0,
          standardFields: [],
          customFields: [],
          requiredFieldOverrides: []
        },
        fieldMapping: []
      };
    }

    const apiFieldNames = Object.keys(this.fieldDefinitions.properties);
    const standardFields = apiFieldNames.filter(field => !field.startsWith('custom_'));
    const customFieldsFromApi = apiFieldNames.filter(field => field.startsWith('custom_'));

    // Check for required field overrides (defensive: handle missing required array)
    const apiRequiredFields = this.fieldDefinitions.required || [];
    const processedRequiredFields = this.getRequiredFields();
    const requiredFieldOverrides = processedRequiredFields.filter(
      (field: string) => !apiRequiredFields.includes(field)
    );

    // Create field mapping analysis
    const fieldMapping = apiFieldNames.map(apiField => ({
      apiField,
      classification: apiField.startsWith('custom_') ? 'Custom Field' : 'Standard Field',
      isRequired: this.isRequired(apiField),
      isCustom: apiField.startsWith('custom_'),
      notes: apiField.startsWith('custom_') 
        ? 'Custom field identified by custom_ prefix'
        : 'Standard Planday field'
    }));

    console.log('🔍 Field Classification Analysis:', {
      portalId: this.fieldDefinitions.portalId,
      totalApiFields: apiFieldNames.length,
      standardFieldsCount: standardFields.length,
      customFieldsCount: customFieldsFromApi.length,
      requiredFieldOverrides,
      customFieldsDetected: this.getCustomFields().length
    });

    return {
      isLoaded: true,
      fieldClassification: {
        totalApiFields: apiFieldNames.length,
        standardFields,
        customFields: customFieldsFromApi,
        requiredFieldOverrides
      },
      fieldMapping
    };
  }

  /**
   * Get all fields that are of type optionalDate (both standard and custom fields)
   * Used for global date format detection across the entire dataset
   */
  static getAllDateFields(): string[] {
    if (!this.fieldDefinitions) {
      // Fallback to known standard date fields if field definitions not loaded
      return ['hiredFrom', 'birthDate'];
    }

    const dateFields: string[] = [];

    // Check standard fields for optionalDate type
    for (const [fieldName, fieldConfig] of Object.entries(this.fieldDefinitions.properties)) {
      if (!fieldName.startsWith('custom_')) {
        // Check if the field is of type optionalDate
        if (fieldConfig.$ref === '#/definitions/optionalDate') {
          dateFields.push(fieldName);
        }
      }
    }

    // Check custom fields for optionalDate type
    const customFields = this.getCustomFieldsWithTypes();
    customFields.forEach(customField => {
      if (customField.fieldType === 'optionalDate') {
        dateFields.push(customField.fieldName);
      }
    });

    return dateFields;
  }
}

/**
 * Field Definition Validator
 * Enhanced validation utility for extracting enum values from field definitions
 * Handles both custom fields and standard fields (employee types, country codes)
 */
export class FieldDefinitionValidator {
  private static fieldDefinitions: PlandayFieldDefinitionsSchema | null = null;

  /**
   * Initialize with field definitions from ValidationService
   */
  static initialize(fieldDefinitions: PlandayFieldDefinitionsSchema): void {
    this.fieldDefinitions = fieldDefinitions;
  }

  /**
   * Extract enum values for any field (not just custom fields)
   * Supports employee types, country codes, custom dropdown fields, and complex object sub-fields
   */
  static getFieldEnumValues(fieldName: string): { ids: any[], values: string[] } | null {
    if (!this.fieldDefinitions) {
      console.warn(`⚠️ Field definitions not loaded, cannot get enum values for "${fieldName}"`);
      return null;
    }

    let fieldConfig: any;
    
    // Handle complex object sub-fields (e.g., "bankAccount.accountNumber")
    if (fieldName.includes('.')) {
      const parts = fieldName.split('.');
      let currentConfig = this.fieldDefinitions.properties[parts[0]];
      
      if (!currentConfig) {
        console.warn(`⚠️ Parent field "${parts[0]}" not found in field definitions`);
        return null;
      }
      
      // Navigate through each part of the dotted path
      for (let i = 1; i < parts.length; i++) {
        // Resolve $ref if present
        if (currentConfig.$ref && this.fieldDefinitions.definitions) {
          const refName = currentConfig.$ref.replace('#/definitions/', '');
          currentConfig = this.fieldDefinitions.definitions[refName];
          if (!currentConfig) {
            console.warn(`⚠️ Definition "${refName}" not found for field path "${fieldName}"`);
            return null;
          }
        }
        
        // Navigate to the next property
        if (currentConfig.properties && currentConfig.properties[parts[i]]) {
          currentConfig = currentConfig.properties[parts[i]];
        } else {
          // Sub-field not found, return null silently (no warning for missing sub-fields)
          return null;
        }
      }
      
      fieldConfig = currentConfig;
    } else {
      // Handle simple field names (existing logic)
      fieldConfig = this.fieldDefinitions.properties[fieldName];
      if (!fieldConfig) {
        console.warn(`⚠️ Field "${fieldName}" not found in field definitions`);
        return null;
      }
    }

    // Handle direct reference to definitions (most common pattern)
    if (fieldConfig.$ref) {
      return this.extractEnumFromDefinition(fieldConfig.$ref);
    }

    // Handle direct enum in field config (rare)
    if (fieldConfig.enum || fieldConfig.values || fieldConfig.anyOf) {
      return this.extractEnumFromConfig(fieldConfig);
    }

    return null;
  }

  /**
   * Validate any field value against field definitions
   */
  static validateFieldValue(fieldName: string, value: any): {
    isValid: boolean;
    convertedValue?: any;
    error?: string;
    suggestion?: string;
  } {
    const enumData = this.getFieldEnumValues(fieldName);
    
    if (!enumData) {
      // No enum validation available - accept any value
      return { isValid: true, convertedValue: value };
    }

    const strValue = String(value).trim();
    
    // Check for exact ID match (for numeric enums like employee types)
    if (enumData.ids.includes(value) || enumData.ids.includes(Number(value))) {
      return { isValid: true, convertedValue: value };
    }

    // Check for exact value match and return corresponding ID if available
    const valueIndex = enumData.values.indexOf(strValue);
    if (valueIndex !== -1) {
      // For ID/value pairs (like employee types), return the corresponding ID
      if (enumData.ids.length === enumData.values.length) {
        return { isValid: true, convertedValue: enumData.ids[valueIndex] };
      }
      // For value-only enums (like country codes), return the value
      return { isValid: true, convertedValue: strValue };
    }

    // Check for case-insensitive value match
    const lowerValue = strValue.toLowerCase();
    const caseInsensitiveIndex = enumData.values.findIndex(enumValue => 
      String(enumValue).toLowerCase() === lowerValue
    );
    
    if (caseInsensitiveIndex !== -1) {
      const matchedValue = enumData.values[caseInsensitiveIndex];
      // For ID/value pairs, return the corresponding ID
      if (enumData.ids.length === enumData.values.length) {
        return { 
          isValid: true, 
          convertedValue: enumData.ids[caseInsensitiveIndex],
          suggestion: `Case-insensitive match: "${strValue}" → "${matchedValue}" (ID: ${enumData.ids[caseInsensitiveIndex]})`
        };
      }
      // For value-only enums, return the corrected value
      return { 
        isValid: true, 
        convertedValue: matchedValue,
        suggestion: `Case-insensitive match: "${strValue}" → "${matchedValue}"`
      };
    }

    // No match found
    const availableValues = enumData.values.length <= 10 
      ? enumData.values.join(', ')
      : `${enumData.values.slice(0, 10).join(', ')}, ... (${enumData.values.length} total)`;
      
    return {
      isValid: false,
      error: `Invalid value "${strValue}" for field "${fieldName}". Must be one of: ${availableValues}`
    };
  }

  /**
   * Get display options for dropdowns in UI
   */
  static getFieldOptions(fieldName: string): Array<{ id: any, name: string }> {
    const enumData = this.getFieldEnumValues(fieldName);
    
    if (!enumData) {
      return [];
    }

    // If we have both IDs and values (like employee types), create ID/name pairs
    if (enumData.ids.length === enumData.values.length) {
      return enumData.ids.map((id, index) => ({
        id,
        name: String(enumData.values[index])
      }));
    }

    // If we only have values (like country codes), use value as both ID and name
    return enumData.values.map(value => ({
      id: value,
      name: String(value)
    }));
  }

  /**
   * Check if field has enum constraints
   */
  static isEnumField(fieldName: string): boolean {
    return this.getFieldEnumValues(fieldName) !== null;
  }

  /**
   * Extract enum values from a definition reference
   */
  private static extractEnumFromDefinition(ref: string): { ids: any[], values: string[] } | null {
    if (!this.fieldDefinitions) return null;

    const definitionKey = ref.replace('#/definitions/', '');
    const definition = this.fieldDefinitions.definitions[definitionKey];
    
    if (!definition) {
      console.warn(`⚠️ Definition "${definitionKey}" not found`);
      return null;
    }

    return this.extractEnumFromConfig(definition);
  }

  /**
   * Extract enum values from field configuration
   * Handles both simple enums and complex anyOf structures
   */
  private static extractEnumFromConfig(config: any): { ids: any[], values: string[] } | null {
    const ids: any[] = [];
    const values: string[] = [];

    // Direct enum/values properties
    if (config.enum) {
      ids.push(...config.enum);
    }
    
    if (config.values) {
      values.push(...config.values);
    }

    // anyOf structure (like employeeType with enum and values)
    if (config.anyOf && Array.isArray(config.anyOf)) {
      config.anyOf.forEach((option: any) => {
        if (option.enum) {
          ids.push(...option.enum);
        }
        
        if (option.values) {
          values.push(...option.values);
        }
      });
    }

    // If we have no enum data, return null
    if (ids.length === 0 && values.length === 0) {
      return null;
    }

    // If we only have IDs but no values, use IDs as values too
    if (ids.length > 0 && values.length === 0) {
      values.push(...ids.map(id => String(id)));
    }

    // If we only have values but no IDs, use values as IDs too
    if (values.length > 0 && ids.length === 0) {
      ids.push(...values);
    }

    return {
      ids: [...new Set(ids)], // Remove duplicates
      values: [...new Set(values)] // Remove duplicates
    };
  }
}

/**
 * Comprehensive Date Parser for Excel Import
 * Handles all common date formats with smart auto-detection
 * Only operates on fields mapped to date fields
 * Asks user only when truly ambiguous
 */
export class DateParser {
  private static userDateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | null = null;
  
  /**
   * Set user's preferred date format for ambiguous cases
   */
  static setUserDateFormat(format: 'DD/MM/YYYY' | 'MM/DD/YYYY'): void {
    this.userDateFormat = format;
    console.log(`📅 User date format set to: ${format}`);
  }
  
  /**
   * Reset user date format (for new uploads)
   */
  static resetUserDateFormat(): void {
    this.userDateFormat = null;
  }
  
  /**
   * Check if a value could be a date in any supported format
   */
  static couldBeDate(value: string): boolean {
    const trimmed = value.trim();
    
    // All supported date patterns
    const patterns = [
      /^\d{4}-\d{1,2}-\d{1,2}$/,          // YYYY-MM-DD, YYYY-M-D
      /^\d{4}\/\d{1,2}\/\d{1,2}$/,        // YYYY/MM/DD, YYYY/M/D
      /^\d{4}\.\d{1,2}\.\d{1,2}$/,        // YYYY.MM.DD, YYYY.M.D
      /^\d{1,2}\/\d{1,2}\/\d{4}$/,        // MM/DD/YYYY, M/D/YYYY, DD/MM/YYYY, D/M/YYYY
      /^\d{1,2}-\d{1,2}-\d{4}$/,          // MM-DD-YYYY, M-D-YYYY, DD-MM-YYYY, D-M-YYYY
      /^\d{1,2}\.\d{1,2}\.\d{4}$/,        // MM.DD.YYYY, M.D.YYYY, DD.MM.YYYY, D.M.YYYY
      /^\d{1,2}\/\d{1,2}\/\d{2}$/,        // MM/DD/YY, M/D/YY, DD/MM/YY, D/M/YY
      /^\d{1,2}-\d{1,2}-\d{2}$/,          // MM-DD-YY, M-D-YY, DD-MM-YY, D-M-YY
      /^\d{1,2}\.\d{1,2}\.\d{2}$/,        // MM.DD.YY, M.D.YY, DD.MM.YY, D.M.YY
      /^\d{8}$/,                          // YYYYMMDD, DDMMYYYY, MMDDYYYY
      /^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}$/i, // 24 Jun 1974
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}$/i, // Jun 24, 1974
    ];
    
    return patterns.some(pattern => pattern.test(trimmed));
  }
  
  /**
   * Detect if a date format can be auto-determined by scanning for unambiguous dates
   * Returns detected format or null if ambiguous
   */
  static detectDateFormat(dateValues: string[]): 'DD/MM/YYYY' | 'MM/DD/YYYY' | null {
    for (const dateStr of dateValues) {
      const trimmed = dateStr.trim();
      
      // Check slash-separated dates for auto-detection
      const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
      if (slashMatch) {
        const [, first, second] = slashMatch;
        const firstNum = parseInt(first, 10);
        const secondNum = parseInt(second, 10);
        
        // If first number > 12, must be DD/MM format
        if (firstNum > 12) {
          return 'DD/MM/YYYY';
        }
        // If second number > 12, must be MM/DD format
        else if (secondNum > 12) {
          return 'MM/DD/YYYY';
        }
      }
      
      // Check dash-separated dates for auto-detection
      const dashMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
      if (dashMatch) {
        const [, first, second] = dashMatch;
        const firstNum = parseInt(first, 10);
        const secondNum = parseInt(second, 10);
        
        if (firstNum > 12) {
          return 'DD/MM/YYYY';
        } else if (secondNum > 12) {
          return 'MM/DD/YYYY';
        }
      }
      
      // Check dot-separated dates for auto-detection
      const dotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
      if (dotMatch) {
        const [, first, second] = dotMatch;
        const firstNum = parseInt(first, 10);
        const secondNum = parseInt(second, 10);
        
        if (firstNum > 12) {
          return 'DD/MM/YYYY';
        } else if (secondNum > 12) {
          return 'MM/DD/YYYY';
        }
      }
    }
    
    return null; // Could not auto-detect
  }
  
  /**
   * Find ambiguous dates that need user clarification
   * Returns array of sample ambiguous date values
   */
  static findAmbiguousDates(dateValues: string[]): string[] {
    const ambiguous = new Set<string>();
    
    for (const dateStr of dateValues) {
      const trimmed = dateStr.trim();
      
      // Check 8-digit dates for ambiguity
      if (/^\d{8}$/.test(trimmed)) {
        const validFormats = this.getValid8DigitFormats(trimmed);
        if (validFormats.length > 1) {
          // Check if the different interpretations actually give different dates
          const dates = validFormats.map(f => `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`);
          const uniqueDates = new Set(dates);
          if (uniqueDates.size > 1) {
            ambiguous.add(trimmed);
          }
        }
      }
      
      // Check slash/dash/dot separated dates where both numbers <= 12
      const separatorMatch = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
      if (separatorMatch) {
        const [, first, second] = separatorMatch;
        const firstNum = parseInt(first, 10);
        const secondNum = parseInt(second, 10);
        
        // Only ambiguous if both are <= 12 and different
        if (firstNum <= 12 && secondNum <= 12 && firstNum !== secondNum) {
          ambiguous.add(trimmed);
        }
      }
    }
    
    return Array.from(ambiguous).slice(0, 5); // Max 5 samples
  }
  
  /**
   * Parse a date string to ISO format (YYYY-MM-DD)
   * Uses smart detection and user preferences
   */
  static parseToISO(dateStr: string): string | null {
    const trimmed = dateStr.trim();
    
    if (!trimmed) return null;
    
    // Already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    
    // Handle YYYY-M-D format (pad to YYYY-MM-DD)
    const yyyyMdMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (yyyyMdMatch) {
      const [, year, month, day] = yyyyMdMatch;
      const paddedMonth = month.padStart(2, '0');
      const paddedDay = day.padStart(2, '0');
      
      if (this.isValidDateParts(parseInt(year), parseInt(month), parseInt(day))) {
        return `${year}-${paddedMonth}-${paddedDay}`;
      }
    }
    
    // Handle 8-digit formats
    if (/^\d{8}$/.test(trimmed)) {
      return this.parse8DigitDate(trimmed);
    }
    
    // Handle YYYY/MM/DD and YYYY.MM.DD formats (unambiguous)
    const yyyyFirstMatch = trimmed.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
    if (yyyyFirstMatch) {
      const [, year, month, day] = yyyyFirstMatch;
      const paddedMonth = month.padStart(2, '0');
      const paddedDay = day.padStart(2, '0');
      
      if (this.isValidDateParts(parseInt(year), parseInt(month), parseInt(day))) {
        return `${year}-${paddedMonth}-${paddedDay}`;
      }
    }
    
    // Handle separator-based dates (DD/MM/YYYY, MM/DD/YYYY, etc.)
    const separatorMatch = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
    if (separatorMatch) {
      return this.parseSeparatorDate(separatorMatch);
    }
    
    // Handle named month formats via Date constructor
    try {
      const date = new Date(trimmed + ' UTC');
      if (!isNaN(date.getTime())) {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    } catch {
      // Fallback failed
    }

    return null;
  }

  /**
   * Parse separator-based dates with smart detection
   */
  private static parseSeparatorDate(match: RegExpMatchArray): string | null {
    const [, first, second, year] = match;
    const firstNum = parseInt(first, 10);
    const secondNum = parseInt(second, 10);
    
    // Convert 2-digit years to 4-digit
    let fullYear = year;
    if (year.length === 2) {
      const yearNum = parseInt(year, 10);
      // Assume 00-30 means 2000-2030, 31-99 means 1931-1999
      fullYear = (yearNum <= 30 ? 2000 + yearNum : 1900 + yearNum).toString();
    }
    
    let day: string, month: string;
    
    // Auto-detection logic
    if (firstNum > 12) {
      // Must be DD/MM format
      day = first;
      month = second;
    } else if (secondNum > 12) {
      // Must be MM/DD format
      month = first;
      day = second;
    } else {
      // Ambiguous - use user preference or default
      if (this.userDateFormat === 'MM/DD/YYYY') {
        month = first;
        day = second;
      } else {
        // Default to DD/MM (European convention)
        day = first;
        month = second;
      }
    }
    
    const paddedDay = day.padStart(2, '0');
    const paddedMonth = month.padStart(2, '0');
    
    if (this.isValidDateParts(parseInt(fullYear), parseInt(month), parseInt(day))) {
      return `${fullYear}-${paddedMonth}-${paddedDay}`;
    }
    
    return null;
  }
  
  /**
   * Parse 8-digit date with intelligent format detection
   */
  private static parse8DigitDate(dateStr: string): string | null {
    const validFormats = this.getValid8DigitFormats(dateStr);
    
    if (validFormats.length === 0) {
      return null;
    }
    
    // If only one valid format, use it
    if (validFormats.length === 1) {
      const { year, month, day, format } = validFormats[0];
      const paddedMonth = String(month).padStart(2, '0');
      const paddedDay = String(day).padStart(2, '0');
      console.log(`📅 Detected 8-digit date format ${format}: "${dateStr}" → "${year}-${paddedMonth}-${paddedDay}"`);
      return `${year}-${paddedMonth}-${paddedDay}`;
    }
    
    // Multiple valid formats - use user preference or priority order
    if (this.userDateFormat === 'DD/MM/YYYY') {
      // Prefer DDMMYYYY format
      const ddmmyyyy = validFormats.find(f => f.format === 'DDMMYYYY');
      if (ddmmyyyy) {
        const { year, month, day } = ddmmyyyy;
        const paddedMonth = String(month).padStart(2, '0');
        const paddedDay = String(day).padStart(2, '0');
        console.log(`📅 User prefers DD/MM, using DDMMYYYY: "${dateStr}" → "${year}-${paddedMonth}-${paddedDay}"`);
        return `${year}-${paddedMonth}-${paddedDay}`;
      }
    }
    
    // Default priority: YYYYMMDD > DDMMYYYY > MMDDYYYY > YYYYDDMM
    const formatPriority = ['YYYYMMDD', 'DDMMYYYY', 'MMDDYYYY', 'YYYYDDMM'];
    
    for (const priorityFormat of formatPriority) {
      const match = validFormats.find(f => f.format === priorityFormat);
      if (match) {
        const { year, month, day, format } = match;
        const paddedMonth = String(month).padStart(2, '0');
        const paddedDay = String(day).padStart(2, '0');
        console.log(`📅 Multiple valid formats for "${dateStr}", chose ${format}: → "${year}-${paddedMonth}-${paddedDay}"`);
        return `${year}-${paddedMonth}-${paddedDay}`;
      }
    }
    
    return null;
  }
  
  /**
   * Get all valid 8-digit date format interpretations
   */
  private static getValid8DigitFormats(dateStr: string): Array<{ year: number; month: number; day: number; format: string }> {
    const validFormats: Array<{ year: number; month: number; day: number; format: string }> = [];
    
    // Try YYYYMMDD
    const year1 = parseInt(dateStr.substring(0, 4), 10);
    const month1 = parseInt(dateStr.substring(4, 6), 10);
    const day1 = parseInt(dateStr.substring(6, 8), 10);
    if (this.isValidDateParts(year1, month1, day1)) {
      validFormats.push({ year: year1, month: month1, day: day1, format: 'YYYYMMDD' });
    }
    
    // Try DDMMYYYY
    const day2 = parseInt(dateStr.substring(0, 2), 10);
    const month2 = parseInt(dateStr.substring(2, 4), 10);
    const year2 = parseInt(dateStr.substring(4, 8), 10);
    if (this.isValidDateParts(year2, month2, day2)) {
      validFormats.push({ year: year2, month: month2, day: day2, format: 'DDMMYYYY' });
    }
    
    // Try MMDDYYYY
    const month3 = parseInt(dateStr.substring(0, 2), 10);
    const day3 = parseInt(dateStr.substring(2, 4), 10);
    const year3 = parseInt(dateStr.substring(4, 8), 10);
    if (this.isValidDateParts(year3, month3, day3)) {
      validFormats.push({ year: year3, month: month3, day: day3, format: 'MMDDYYYY' });
    }
    
    // Try YYYYDDMM
    const year4 = parseInt(dateStr.substring(0, 4), 10);
    const day4 = parseInt(dateStr.substring(4, 6), 10);
    const month4 = parseInt(dateStr.substring(6, 8), 10);
    if (this.isValidDateParts(year4, month4, day4)) {
      validFormats.push({ year: year4, month: month4, day: day4, format: 'YYYYDDMM' });
    }
    
    return validFormats;
  }
  
  /**
   * Validate date parts are reasonable
   */
  private static isValidDateParts(year: number, month: number, day: number): boolean {
    return year >= 1900 && year <= 2100 && 
           month >= 1 && month <= 12 && 
           day >= 1 && day <= 31;
  }
} 