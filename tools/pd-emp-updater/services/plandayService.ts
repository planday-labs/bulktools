import { PlandayApiCredentials, Employee, DefinitionCollection, FieldDefinition, UpdateEmployeePayload, UpdateSalaryPayload, UpdateWageRatePayload } from '../types';

const AUTH_URL = 'https://id.planday.com/connect/token';
const API_BASE_URL = 'https://openapi.planday.com';
export const EXPECTED_CLIENT_ID = '13000bf2-dd1f-41ab-a1a0-eeec783f50d7';
export const STORAGE_KEY = 'plandayCredentials:pd-emp-updater';

let credentials_internal: PlandayApiCredentials | null = null;
let accessToken: string | null = null;
let tokenExpiry: number | null = null;

export function initializeService(credentials: PlandayApiCredentials) {
    if (credentials_internal?.clientId !== credentials.clientId || credentials_internal?.refreshToken !== credentials.refreshToken) {
        accessToken = null;
        tokenExpiry = null;
    }
    credentials_internal = { ...credentials };
}

export function resetService() {
    credentials_internal = null;
    accessToken = null;
    tokenExpiry = null;
}

async function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getAccessToken(): Promise<string> {
    if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
        return accessToken;
    }

    if (!credentials_internal) {
        throw new Error("Planday service not initialized with credentials.");
    }

    const payload = new URLSearchParams({
        'client_id': credentials_internal.clientId,
        'grant_type': 'refresh_token',
        'refresh_token': credentials_internal.refreshToken,
    });

    const response = await fetch(AUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: payload.toString(),
    });

    if (!response.ok) {
        const errorText = await response.text();
        sessionStorage.removeItem(STORAGE_KEY);
        credentials_internal = null;
        accessToken = null;
        tokenExpiry = null;
        throw new Error(`Failed to refresh access token: ${response.status} ${errorText}. Your credentials may be invalid or expired. Please re-enter them.`);
    }

    const data = await response.json();
    accessToken = data.access_token;
    tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

    if (data.refresh_token && data.refresh_token !== credentials_internal.refreshToken) {
        credentials_internal.refreshToken = data.refresh_token;
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(credentials_internal));
    }
    
    return accessToken;
}

// Optimized retry logic with NetworkError handling and exponential backoff
async function fetchWithAuth(url: string, options: RequestInit = { method: 'GET' }, retries = 5, backoffDelay = 2000): Promise<Response> {
    if (!credentials_internal) throw new Error("Service not initialized");

    try {
        const token = await getAccessToken();
        const headers = {
            ...options.headers,
            'Authorization': `Bearer ${token}`,
            'X-ClientId': credentials_internal.clientId,
        };

        const response = await fetch(url, { ...options, headers });
        // Handle Rate Limiting (429)
        if (response.status === 429) {
            if (retries > 0) {
                const retryAfterHeader = response.headers.get('Retry-After');
                const xRateLimitReset = response.headers.get('x-ratelimit-reset');
                
                let waitTime = 1000; // Default 1s
                
                if (retryAfterHeader) {
                    const seconds = parseInt(retryAfterHeader, 10);
                    if (!Number.isNaN(seconds)) waitTime = seconds * 1000;
                } else if (xRateLimitReset) {
                     const seconds = parseInt(xRateLimitReset, 10);
                     if (!Number.isNaN(seconds)) waitTime = (seconds + 1) * 1000;
                }

                // Cap max wait to 10s
                waitTime = Math.min(waitTime, 10000); 

                console.warn(`Rate limited (429). Retrying in ${waitTime}ms...`);
                await wait(waitTime);
                return fetchWithAuth(url, options, retries - 1, backoffDelay);
            }
        }

        // Handle Server Errors (5xx)
        if (response.status >= 500 && retries > 0) {
             console.warn(`Server error ${response.status}. Retrying...`);
             await wait(1000); 
             return fetchWithAuth(url, options, retries - 1, backoffDelay);
        }

        return response;
    } catch (error: any) {
        // Handle Network Errors (TypeError: Failed to fetch, NetworkError, etc.)
        const message = typeof error?.message === 'string' ? error.message : '';
        const name = typeof error?.name === 'string' ? error.name : '';
        const isNetworkError = name === 'TypeError' || name === 'NetworkError' || message.includes('NetworkError') || message.includes('Failed to fetch') || message.includes('fetch');
        
        if (isNetworkError && retries > 0) {
            console.warn(`Network error detected: ${error.message}. Pausing for ${backoffDelay}ms and retrying...`);
            await wait(backoffDelay); // Wait based on backoff strategy
            // Exponential backoff: Increase delay by 1.5x for the next attempt
            return fetchWithAuth(url, options, retries - 1, backoffDelay * 1.5);
        }
        throw error;
    }
}

export async function fetchPaginatedData(endpoint: string): Promise<any[]> {
    let allData: any[] = [];
    let offset = 0;
    const limit = 50; 

    while (true) {
        // Handle endpoints that don't support pagination params (like some list endpoints returning direct arrays)
        const isSkills = endpoint.includes('/skills');
        const url = isSkills ? `${API_BASE_URL}${endpoint}` : `${API_BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}limit=${limit}&offset=${offset}`;
        
        const response = await fetchWithAuth(url);
        if (!response.ok) throw new Error(`Failed to fetch ${endpoint}: ${await response.text()}`);
        const result = await response.json();

        // Handle endpoints that return data directly as array or inside 'data' property
        let items = [];
        if (Array.isArray(result)) {
            items = result;
            allData = allData.concat(items);
            break; 
        } else if (result && result.data && Array.isArray(result.data)) {
            items = result.data;
            allData = allData.concat(items);
            if (items.length < limit || (result.paging && result.paging.total <= allData.length)) {
                break;
            }
            offset += items.length;
        } else {
            break;
        }
        
        if(isSkills) break; // Skills endpoint isn't paginated the same way usually
    }
    return allData;
}

export async function fetchEmployees(): Promise<Employee[]> {
    return fetchPaginatedData('/hr/v1.0/employees?special=BankAccount,BirthDate,Ssn');
}

export async function fetchEmployeeDetails(id: number): Promise<any> {
    // Removed Skills from special param as it causes 400 Bad Request
    const response = await fetchWithAuth(`${API_BASE_URL}/hr/v1.0/employees/${id}?special=BankAccount,BirthDate,Ssn`);
    if (!response.ok) return null;
    const json = await response.json();
    return json.data;
}

export async function fetchEmployeeContractRule(id: number): Promise<any> {
    const response = await fetchWithAuth(`${API_BASE_URL}/contractrules/v1/employees/${id}`);
    if (response.status === 404 || response.status === 204) return null;
    if (!response.ok) return null;
    const json = await response.json();
    return json.data;
}

export async function fetchEmployeeSalary(id: number): Promise<any> {
    const response = await fetchWithAuth(`${API_BASE_URL}/pay/v1.0/salaries/employees/${id}`);
    if (response.status === 404 || response.status === 204) return null;
    if (!response.ok) return null;
    const json = await response.json();
    return json.data;
}

export async function fetchEmployeePayRates(id: number): Promise<any[]> {
    const response = await fetchWithAuth(`${API_BASE_URL}/pay/v1.0/payrates/employees/${id}`);
    if (response.status === 404) return [];
    if (!response.ok) return [];
    const json = await response.json();
    return json.data || json || [];
}


export async function fetchPortalInfo(): Promise<any> {
    const response = await fetchWithAuth(`${API_BASE_URL}/portal/v1.0/info`);
    if (!response.ok) return null;
    const json = await response.json();
    return json.data;
}

// --- Definition Fetching ---

export async function fetchFieldDefinitions() {
    let customFields: FieldDefinition[] = [];
    let availableSystemFields: string[] = [];
    let countryCodes: string[] = [];
    let requiredFields: string[] = [];

    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/hr/v1.0/employees/fielddefinitions`);
        if (response.ok) {
            const result = await response.json();
            const schemaRoot = result.data || result;
            if (schemaRoot) {
                if (Array.isArray(schemaRoot.required)) {
                    requiredFields = schemaRoot.required;
                }
                const props = schemaRoot.properties || {};
                const defs = schemaRoot.definitions || {};
                let ccDef = defs['optionalCountryCode'];
                if (!ccDef && props['cellPhoneCountryCode'] && props['cellPhoneCountryCode'].$ref) {
                        const key = props['cellPhoneCountryCode'].$ref.split('/').pop();
                        if (key) ccDef = defs[key];
                }
                if (ccDef) {
                        const extractEnum = (d: any): string[] => {
                            if (Array.isArray(d.enum)) return d.enum;
                            if (Array.isArray(d.values)) return d.values;
                            if (d.anyOf && Array.isArray(d.anyOf)) {
                                const real = d.anyOf.find((x: any) => x.type !== 'null');
                                if (real) return extractEnum(real);
                            }
                            return [];
                        };
                        countryCodes = extractEnum(ccDef);
                }
                const unsupportedFields = ['contractRulesRuleId', 'countryId', 'description', 'isPublic', 'subdivisionId', 'securityGroups', 'dateTimeCreated', 'dateTimeModified'];
                const systemFields = ['id', 'firstName', 'lastName', 'ssn', 'zip', 'city', 'email', 'phone', 'phoneCountryCode', 'street1', 'street2', 'userName', 'departments', 'employeeGroups', 'hiredFrom', 'birthDate', 'gender', 'cellPhone', 'cellPhoneCountryCode', 'salaryIdentifier', 'employeeTypeId', 'Department', 'primaryDepartmentId', 'jobTitle', 'is_public', 'contractRuleId', 'bankAccount', 'skillIds', 'isSupervisor', 'supervisorId'];
                const systemFieldSet = new Set(systemFields);
                const excluded = new Set([...systemFields, ...unsupportedFields].map(k => k.toLowerCase()));
                Object.keys(props).forEach(key => {
                    if (systemFieldSet.has(key)) availableSystemFields.push(key);
                    if (excluded.has(key.toLowerCase())) return;
                    const prop = props[key];
                    let type: FieldDefinition['type'] = 'Text';
                    let options: string[] = [];
                    if (prop.type === 'string') type = 'Text';
                    if (prop.type === 'boolean') type = 'Boolean';
                    if (['number', 'integer', 'decimal'].includes(prop.type)) type = 'Numeric';
                    if (prop.format === 'date' || prop.format === 'date-time') type = 'Date';
                    if (prop.$ref) {
                            const defKey = prop.$ref.split('/').pop() || '';
                            let def = defs[defKey];
                            if (def) {
                                if (def.anyOf && Array.isArray(def.anyOf)) {
                                    const realDef = def.anyOf.find((item: any) => item.type !== 'null');
                                    if (realDef) def = realDef;
                                }
                                if (Array.isArray(def.values) && def.values.length > 0) {
                                    type = 'Dropdown'; options = def.values;
                                } else if (Array.isArray(def.enum) && def.enum.length > 0) {
                                    type = 'Dropdown'; options = def.enum;
                                } else if (def.type === 'boolean') {
                                    type = 'Boolean';
                                } else if (['number', 'integer', 'decimal'].includes(def.type)) {
                                    type = 'Numeric';
                                } else if (def.type === 'string') {
                                    type = 'Text';
                                    if (def.format === 'date' || def.format === 'date-time') type = 'Date';
                                }
                                if (type === 'Text') {
                                    const lowerKey = defKey.toLowerCase();
                                    if (lowerKey.includes('boolean')) type = 'Boolean';
                                    else if (lowerKey.includes('numeric') || lowerKey.includes('integer') || lowerKey.includes('decimal')) type = 'Numeric';
                                    else if (lowerKey.includes('custom')) type = 'Dropdown';
                                    else if (lowerKey.includes('date')) type = 'Date';
                                }
                            }
                    } else {
                            if (['date', 'datetime'].includes(prop.type)) type = 'Date';
                            if (prop.type === 'string' && (prop.format === 'date' || prop.format === 'date-time')) type = 'Date';
                            if (prop.enum) { type = 'Dropdown'; options = prop.enum; }
                    }
                    customFields.push({ id: key, originalName: key, description: prop.description || key, type, dropdownOptions: options });
                });

            }
        }
    } catch (e) { console.warn("Could not fetch field definitions", e); }
    return { customFields, availableSystemFields, countryCodes, requiredFields };
}

export async function fetchAllDefinitions(): Promise<DefinitionCollection> {
    const [departments, employeeGroups, employeeTypes, salaryTypes, skills, supervisors] = await Promise.all([
        fetchPaginatedData('/hr/v1.0/departments'),
        fetchPaginatedData('/hr/v1.0/employeegroups'),
        fetchPaginatedData('/hr/v1.0/employeetypes'),
        fetchPaginatedData('/pay/v1.0/salaries/types').then(data => Array.isArray(data) ? data : (data as any).data || []),
        // Normalize skills to ensure 'id' property exists (API returns skillId) and strictly parse as int
        fetchPaginatedData('/hr/v1.0/skills').then(data => {
            const items = Array.isArray(data) ? data : (data as any).data || [];
            return items.map((s: any) => ({ ...s, id: parseInt(String(s.id || s.skillId), 10) })); 
        }),
        fetchPaginatedData('/hr/v1.0/employees/supervisors')
    ]);
    
    // Contract rules (v1)
    let contractRules = [];
    try {
        contractRules = await fetchPaginatedData('/contractrules/v1/contractrules');
    } catch (e) { console.warn("Could not fetch contract rules", e); }

    const { customFields, availableSystemFields, countryCodes, requiredFields } = await fetchFieldDefinitions();

    return { departments, employeeGroups, employeeTypes, contractRules, salaryTypes, skills, supervisors, customFields, availableSystemFields, countryCodes, requiredFields };
}


// --- Update Operations ---

function parseError(text: string): string {
    try {
        const json = JSON.parse(text);
        const parts: string[] = [];

        // Strategy 0: modelState (ASP.NET standard) - Often contains precise field errors
        if (json.modelState) {
             const ms = Object.entries(json.modelState)
                .map(([key, msgs]) => `${key.replace('model.', '')}: ${(Array.isArray(msgs) ? msgs.join(', ') : msgs)}`)
                .join('; ');
             if(ms) parts.push(ms);
        }

        // Strategy 1: Nested Planday "Validation" errors (often in 'errors' object or array)
        if (json.errors) {
            if (Array.isArray(json.errors)) {
                // Array format
                const errs = json.errors.map((e: any) => `${e.key || ''}: ${e.message || ''}`).join(', ');
                if(errs) parts.push(errs);
            } else if (typeof json.errors === 'object') {
                // Object Map format
                const errs = Object.entries(json.errors)
                    .map(([key, msgs]) => `${key}: ${(Array.isArray(msgs) ? msgs.join(', ') : msgs)}`)
                    .join('; ');
                if(errs) parts.push(errs);
            }
        }

        // Strategy 2: Nested 'error' object
        if (json.error && typeof json.error === 'object') {
            const err = json.error;
            if (err.validation_errors && Array.isArray(err.validation_errors)) {
                const msgs = err.validation_errors.map((ve: any) => `${ve.property_name}: ${ve.error_message || ve.error_message_key}`);
                if(msgs.length > 0) parts.push(msgs.join('; '));
            }
            if (err.errors) {
                 if (typeof err.errors === 'object') {
                     const nested = Object.entries(err.errors)
                        .map(([key, msgs]) => `${key}: ${(Array.isArray(msgs) ? msgs.join(', ') : msgs)}`)
                        .join('; ');
                     if(nested) parts.push(nested);
                 }
            }
            if (err.code) parts.push(`${err.code}${err.message ? ': ' + err.message : ''}`);
            else if (err.message) parts.push(err.message);
        }
        
        // Strategy 3: Top level standard fields
        if (json.message) parts.push(json.message);
        if (json.error_description) parts.push(json.error_description);
        if (json.title && !json.message) parts.push(json.title); // Only use title if message is missing
        
        if (parts.length > 0) {
            // Deduplicate and join
            return [...new Set(parts)].join(' | ');
        }

        // Fallback
        if (Object.keys(json).length > 0) return JSON.stringify(json);
    } catch { }
    
    // HTML or other non-JSON response
    if (text.toLowerCase().includes('<!doctype html>')) return 'Server returned HTML (500/404). Endpoint might be down or invalid.';
    return text.substring(0, 300);
}

export async function updateEmployee(id: number, payload: UpdateEmployeePayload): Promise<void> {
    const response = await fetchWithAuth(`${API_BASE_URL}/hr/v1.0/employees/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errText = await response.text();
        const errorMsg = parseError(errText);
        
        // Customize generic 409 error for better UX
        if (response.status === 409 && errText.includes("You need to supply a valid employee to save")) {
             const cleanMsg = errorMsg.split(' | ').filter(p => !p.includes('You need to supply a valid employee to save')).join(' | ');
             throw new Error(`409 Error: Validation failed (${cleanMsg}) - Check for required fields and invalid field values. Remember to read the instructions for each field.`);
        }

        throw new Error(`${response.status}: ${errorMsg}`);
    }
}

export async function assignContractRule(employeeId: number, ruleId: number | null): Promise<void> {
    const url = `${API_BASE_URL}/contractrules/v1/employees/${employeeId}?contractRuleId=${ruleId || ''}`;
    const response = await fetchWithAuth(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: String(employeeId) })
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`${response.status}: ${parseError(errText)}`);
    }
}

export async function changeUsername(employeeId: number, newUsername: string): Promise<void> {
    const response = await fetchWithAuth(`${API_BASE_URL}/hr/v1.0/employees/${employeeId}/change_username`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newUsername })
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`${response.status}: ${parseError(errText)}`);
    }
}

export async function updateFixedSalary(employeeId: number, payload: UpdateSalaryPayload, isDelete: boolean): Promise<void> {
    const url = `${API_BASE_URL}/pay/v1.0/salaries/employees/${employeeId}`;
    const method = isDelete ? 'DELETE' : 'PUT';
    const body = isDelete ? undefined : JSON.stringify(payload);
    
    const response = await fetchWithAuth(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`${response.status}: ${parseError(errText)}`);
    }
}

export async function updateWageRate(groupId: number, payload: UpdateWageRatePayload): Promise<void> {
    const response = await fetchWithAuth(`${API_BASE_URL}/pay/v1.0/payrates/employeeGroups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`${response.status}: ${parseError(errText)}`);
    }
}