/**
 * Auto-detection Rules for Column Mapping
 * Based on common Excel column names that map to Planday fields
 * 
 * Each key represents a Planday field name, and the array contains
 * common Excel column header variations that should map to that field.
 * 
 * Rules are applied with the following priority:
 * 1. Exact field name matches (case-insensitive)
 * 2. Pattern-based fuzzy matching using these rules
 * 3. Custom field matching (handled separately)
 */
export const AUTO_MAPPING_RULES = {
  firstName: [
    'first name', 'first', 'forename', 'given name', 'fname', 'firstname',
    'prenom', 'vorname', 'fornavn', 'etunimi'
  ],
  lastName: [
    'last name', 'last', 'surname', 'family name', 'lname', 'lastname',
    'nom', 'nachname', 'efternavn', 'sukunimi'
  ],
  email: [
    'email', 'username', 'login', 'user email', 'e-mail', 'mail',
    'email address', 'login email', 'work email', 'email/username', 'emailusername'
  ],
  cellPhoneCountryCode: [
    'mobile country code', 'cell country code', 'phone country code',  // Phone-specific (most important)
    'country code mobile', 'country code cell', 'phone country',       // Alternative orderings
    'country code', 'iso country', 'iso code', 'country iso',          // Generic country code patterns
    'land', 'pais', 'pays'                                             // International
  ],
  cellPhone: [
    'mobile', 'cell phone', 'cell', 'mobile phone', 'cellular',
    'mobile number', 'cell number', 'gsm'
  ],
  hiredFrom: [
    'hire date', 'start date', 'employment date', 'date hired',
    'start of employment', 'employment start', 'join date',
    'hired from', 'hiredate', 'startdate', 'hired date', 'start or hired date'
  ],
  birthDate: [
    'birth date', 'date of birth', 'birthday', 'born', 'dob',
    'birth day', 'date born', 'Birth Date (YYYY-MM-DD)'
  ],
  street1: [
    'address', 'street', 'street address', 'address line 1',
    'street1', 'home address', 'residential address', 'street 1'
  ],
  city: [
    'city', 'town', 'municipality', 'place', 'location'
  ],
  zip: [
    'zip', 'zip code', 'postal code', 'postcode', 'zip-code',
    'postal', 'post code'
  ],
  gender: [
    'gender', 'sex', 'male/female', 'm/f'
  ],
  ssn: [
    'ssn', 'social security', 'social security number', 'social',
    'national id', 'personal number', 'cpr', 'tax id', 'taxid'
  ],
  salaryIdentifier: [
    'salary identifier', 'salary id', 'salaryid', 'salary number',
    'payroll identifier', 'pay id', 'payroll id', 'payid', 'payrollid',
    'payroll number', 'employee id', 'emp id', 'employeeid', 'staff id', 'worker id'
  ],
  jobTitle: [
    'job title', 'title', 'position', 'role', 'job role',
    'job position', 'position title', 'work title', 'function',
    'designation', 'rank', 'post'
  ],
  payrollId: [
    'payroll identifier', 'pay id', 'payroll id', 'payid', 'payrollid',
    'payroll number', 'employee number', 'emp number', 'staff number', 'worker number'
  ],
  // departments and employeeGroups removed - now using individual fields like departments.Kitchen, employeeGroups.Waiter
  employeeTypeId: [
    'employee type', 'employment type', 'type', 'job type',
    'position type', 'contract type', 'employment status',
    'worker type', 'staff type', 'employment category'
  ],
  wageValidFrom: [
    'wage valid from', 'salary valid from', 'rate valid from',
    'pay rate valid from', 'hourly rate valid from', 'rate from',
    'rate start date', 'wage start date', 'pay start date',
    'valid from date', 'effective date', 'pay effective date',
    'wage effective date', 'rate effective', 'pay from'
  ],
  supervisorId: [
    'supervisor', 'supervisor name', 'manager', 'manager name',
    'reports to', 'reporting to', 'line manager', 'team lead',
    'team leader', 'boss', 'superior', 'supervisor id'
  ],
  isSupervisor: [
    'is supervisor', 'issupervisor', 'supervisor flag', 'is manager',
    'manager flag', 'is team lead', 'is team leader', 'supervisor status',
    'makes supervisor', 'set as supervisor'
  ],
  contractRule: [
    'contract rule', 'contractrule', 'contract', 'contracted hours',
    'hours per week', 'weekly hours', 'work hours', 'working hours contract',
    'hour contract', 'employment contract', 'contract hours'
  ],
  salaryPeriod: [
    'salary period', 'salaryperiod', 'pay period', 'payment period',
    'fixed salary period', 'fixed salary - period', 'wage period',
    'salary type', 'period type', 'payment frequency'
  ],
  salaryHours: [
    'salary hours', 'salaryhours', 'expected hours', 'fixed salary hours',
    'fixed salary - expected hours', 'contracted hours', 'monthly hours',
    'weekly hours salary', 'hours per period', 'work hours salary'
  ],
  salaryAmount: [
    'salary amount', 'salaryamount', 'fixed salary', 'fixed salary amount',
    'fixed salary - amount', 'monthly salary', 'base salary', 'salary',
    'wage amount', 'fixed wage', 'gross salary', 'pay amount'
  ],
} as const;

/**
 * Type for auto-mapping rules
 */
export type AutoMappingRules = typeof AUTO_MAPPING_RULES;

/**
 * Get all supported field names for auto-mapping
 */
export function getSupportedFieldNames(): string[] {
  return Object.keys(AUTO_MAPPING_RULES);
}

/**
 * Get patterns for a specific field
 */
export function getFieldPatterns(fieldName: string): readonly string[] | undefined {
  return AUTO_MAPPING_RULES[fieldName as keyof AutoMappingRules];
}

/**
 * Check if a field is supported by auto-mapping
 */
export function isFieldSupported(fieldName: string): boolean {
  return fieldName in AUTO_MAPPING_RULES;
} 