import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx-js-style';
import type { PlandayApiCredentials, DefinitionCollection, EmployeeUpdateReview, UpdateWageRatePayload, UpdateActionResult, FieldDefinition, Employee } from './types';
import { initializeService, fetchEmployees, fetchAllDefinitions, fetchFieldDefinitions, fetchEmployeeDetails, fetchEmployeeContractRule, fetchEmployeeSalary, fetchEmployeePayRates, updateEmployee, assignContractRule, changeUsername, updateFixedSalary, updateWageRate, resetService, fetchPaginatedData, fetchPortalInfo, EXPECTED_CLIENT_ID, STORAGE_KEY } from './services/plandayService';

// --- Utility Functions ---
const formatDateToYYYYMMDD = (date: string | Date | undefined | null): string => {
    if (!date) return '';
    try {
        const d = new Date(date);
        if (isNaN(d.getTime())) return '';
        return d.toISOString().split('T')[0];
    } catch { return ''; }
};

const getTodayYYYYMMDD = () => formatDateToYYYYMMDD(new Date());

const CURRENT_TWO_DIGIT_YEAR = parseInt(new Date().getFullYear().toString().slice(-2), 10);

// Heuristic to guess 19xx vs 20xx
const guessCentury = (twoDigitYear: number, fieldName: string): number => {
    const lowerName = fieldName.toLowerCase();
    
    // Birth Date Logic:
    // Strictly pivot on current year. 
    if (lowerName.includes('birth')) {
        return twoDigitYear > CURRENT_TWO_DIGIT_YEAR ? 1900 : 2000;
    }

    // Other Dates: Window 1951 - 2050
    return twoDigitYear > 50 ? 1900 : 2000;
};

const parseDecimal = (input: any): number => {
    if (typeof input === 'number') return input;
    if (input === undefined || input === null) return 0;
    const str = String(input).trim();
    if (str === '') return 0;
    // Replace comma with dot to support 20,5 as 20.5
    return Number(str.replace(',', '.'));
};

const parseDateWithFormat = (input: any, forceUS: boolean, yearCorrection?: number): string | null => {
    if (!input) return null;

    if (input instanceof Date) {
        if (isNaN(input.getTime())) return null;
        const y = input.getFullYear();
        const m = String(input.getMonth() + 1).padStart(2, '0');
        const d = String(input.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    if (typeof input === 'number' || /^\d{5}$/.test(String(input))) {
        const serial = parseInt(input, 10);
        if (serial > 20000 && serial < 80000) { // Valid bounds for recent dates
            // 25569 is the difference in days between Jan 1 1900 and Jan 1 1970
            const dateObj = new Date(Math.round((serial - 25569) * 86400 * 1000));
            // Use UTC methods here because we calculated pure absolute time from the Unix Epoch
            const y = dateObj.getUTCFullYear();
            const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
            const d = String(dateObj.getUTCDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
    }

    const str = String(input).trim();
    if (!str) return null;

    // Check for Year-First format (YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD)
    // Handles YYYY-MM-DD (ISO) and YYYY-DD-MM (if Day > 12)
    const matchYearFirst = str.match(/^(\d{4})[\/\.\-](\d{1,2})[\/\.\-](\d{1,2})$/);
    if (matchYearFirst) {
        const y = parseInt(matchYearFirst[1], 10);
        const p1 = parseInt(matchYearFirst[2], 10);
        const p2 = parseInt(matchYearFirst[3], 10);

        let m, d;
        // Assume YYYY-MM-DD (ISO) by default.
        // If p1 > 12, it implies YYYY-DD-MM
        if (p1 > 12) {
            d = p1;
            m = p2;
        } else {
            m = p1;
            d = p2;
        }

        if (m > 12 || d > 31 || m < 1 || d < 1) return null;
        
        const mStr = String(m).padStart(2, '0');
        const dStr = String(d).padStart(2, '0');
        return `${y}-${mStr}-${dStr}`;
    }

    // Check for Year-Last format (D/M/Y or M/D/Y)
    const match = str.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})$/);
    if (match) {
        let part1 = parseInt(match[1], 10);
        let part2 = parseInt(match[2], 10);
        let y = parseInt(match[3], 10);

        if (yearCorrection) {
            y = yearCorrection;
        } else if (y < 100) {
            y += (y > 50 ? 1900 : 2000); 
        }

        let d, m;

        if (forceUS) {
            m = part1;
            d = part2;
        } else {
            d = part1;
            m = part2;
        }

        if (m > 12 || d > 31 || m < 1 || d < 1) return null;

        const mStr = String(m).padStart(2, '0');
        const dStr = String(d).padStart(2, '0');
        return `${y}-${mStr}-${dStr}`;
    }

    // Attempt standard JS Date parse as a fallback (handles formats like "Tue Aug 15 2000...")
    const fallbackDate = new Date(str.replace(/-/g, '/')); // replace dashes to prevent timezone issues in some browsers if it looks iso-ish
    if (!isNaN(fallbackDate.getTime())) {
        // Only accept if it actually looks somewhat like a date rather than random numbers
        // e.g. "123" parses to 2001 in some browsers, but JS Date toString usually contains text
        if (/[A-Za-z]/.test(str)) {
            const y = fallbackDate.getFullYear();
            if (y > 1900 && y < 2100) {
                const m = String(fallbackDate.getMonth() + 1).padStart(2, '0');
                const d = String(fallbackDate.getDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            }
        }
    }

    return null;
};

const formatOriginalDateForDisplay = (raw: any, isUSFormat: boolean): string => {
    if (!raw) return String(raw);

    if (raw instanceof Date) {
        if (isNaN(raw.getTime())) return String(raw);
        const y = raw.getFullYear();
        const m = String(raw.getMonth() + 1).padStart(2, '0');
        const d = String(raw.getDate()).padStart(2, '0');
        return isUSFormat ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
    }

    if (typeof raw === 'number' || /^\d{5}$/.test(String(raw))) {
        const serial = parseInt(String(raw), 10);
        if (serial > 20000 && serial < 80000) {
            const dateObj = new Date(Math.round((serial - 25569) * 86400 * 1000));
            const y = dateObj.getUTCFullYear();
            const m = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
            const d = String(dateObj.getUTCDate()).padStart(2, '0');
            return isUSFormat ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
        }
    }

    return String(raw);
};

const checkForUSDateFormat = (rows: any[], dateKeys: string[]): boolean => {
    let usMarkerFound = false;
    let euMarkerFound = false;

    for (const row of rows) {
        for (const key of dateKeys) {
            const val = row[key];
            if (val && typeof val === 'string') {
                const match = val.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})$/);
                if (match) {
                    const p1 = parseInt(match[1], 10);
                    const p2 = parseInt(match[2], 10);
                    if (p2 > 12) usMarkerFound = true;
                    if (p1 > 12) euMarkerFound = true;
                }
            }
        }
    }

    if (usMarkerFound && !euMarkerFound) return true;
    return false; 
};

// --- SVG Icons ---
const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>);
const InfoIcon: React.FC<{ className?: string }> = ({ className }) => (<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>);
const CopyIcon: React.FC<{ className?: string }> = ({ className }) => (<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>);
const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>);
const CalendarIcon: React.FC<{ className?: string }> = ({ className }) => (<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>);
const AlertIcon: React.FC<{ className?: string }> = ({ className }) => (<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>);
const CloudUploadIcon: React.FC<{ className?: string }> = ({ className }) => (<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>);
const UserGroupIcon: React.FC<{ className?: string }> = ({ className }) => (<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>);
const BadgeIdIcon: React.FC<{ className?: string }> = ({ className }) => (<svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0c0 .884-.5 1.5-1 1.5a1 1 0 01-1-1.5zm0 0c0 .884.5 1.5 1 1.5a1 1 0 001-1.5" /></svg>);


// --- UI Components ---

const HelpModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
}> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900 bg-opacity-50 backdrop-blur-sm p-4 transition-opacity">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden transform transition-all scale-100 opacity-100">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                        <span className="text-blue-600">ℹ️</span> Mapping Guide & Custom Templates
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-lg p-1">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                <div className="p-6 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 130px)' }}>
                    <div className="space-y-6 text-gray-700 text-sm leading-relaxed">
                        <div>
                            <h4 className="font-bold text-gray-900 mb-2">Can I use my own template/file?</h4>
                            <p>
                                Yes! You can use your own Excel file (e.g., exported from your HR software) instead of using the template generated by this app.
                            </p>
                            <p className="mt-2 text-amber-800 bg-amber-50 p-3 rounded border border-amber-200">
                                <strong>Note:</strong> Because your file's columns won't perfectly match our template, you will have to perform manual mapping of columns to Planday fields. This might work in some scenarios for some fields, but not all.
                            </p>
                        </div>
                        
                        <div>
                            <h4 className="font-bold text-gray-900 mb-2">How Mapping Works</h4>
                            <p className="mb-2">
                                When you arrive at the mapping screens, the app will try to automatically match your employees and columns to known Planday data using intelligent fuzzy matching. 
                            </p>
                            <ul className="list-disc pl-5 space-y-1 mb-2">
                                <li>✨ <strong>Auto-mapped (Yellow):</strong> The app found a likely match. Please verify it's correct.</li>
                                <li><strong>Manually mapped (Blue):</strong> You have manually selected a mapping.</li>
                            </ul>
                        </div>

                        <div>
                            <h4 className="font-bold text-gray-900 mb-2">Mapping Departments, Employee Groups & Rates</h4>
                            <p>
                                When updating complex organizational data from an external file, you can map complete columns to our special <em>"All"</em> options:
                            </p>
                            <ul className="list-disc pl-5 space-y-2 mt-2">
                                <li>
                                    <strong>ALL_DEPARTMENTS:</strong> Maps a single column containing department names.
                                </li>
                                <li>
                                    <strong>ALL_EMPLOYEE_GROUPS:</strong> Maps a column containing Employee Group names.
                                </li>
                                <li>
                                    <strong>ALL_EMPLOYEE_GROUPS_RATES:</strong> Maps a column containing the specific hourly rates for those groups.
                                </li>
                            </ul>
                            <p className="mt-2 text-xs bg-blue-50 text-blue-800 p-3 rounded border border-blue-100">
                                <strong>Tip:</strong> The app will scan the names of Departments, Groups, and Skills for you, so you can often just auto-map or manually select them individually from the list if your file structures them as separate columns.
                            </p>
                        </div>
                    </div>
                </div>
                <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
                    <button 
                        onClick={onClose}
                        className="px-6 py-2 rounded-lg text-white bg-blue-600 hover:bg-blue-700 font-bold transition-colors focus:ring-2 focus:ring-blue-300 focus:outline-none"
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
};

const ConfirmModal: React.FC<{ 
    isOpen: boolean; 
    onClose: () => void; 
    onConfirm: () => void; 
    title: string; 
    message: string | React.ReactNode; 
    confirmText: string; 
    cancelText: string 
}> = ({ isOpen, onClose, onConfirm, title, message, confirmText, cancelText }) => {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-50 backdrop-blur-sm p-4 transition-opacity">
             <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden transform transition-all scale-100 opacity-100">
                <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-3">{title}</h3>
                    <p className="text-gray-600 mb-8 text-base leading-relaxed">{message}</p>
                    <div className="flex justify-end gap-3">
                        <button 
                            onClick={onClose}
                            className="px-5 py-2.5 rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 font-medium transition-colors focus:ring-2 focus:ring-gray-300 focus:outline-none"
                        >
                            {cancelText}
                        </button>
                        <button 
                            onClick={() => { onConfirm(); onClose(); }}
                            className="px-5 py-2.5 rounded-lg text-white bg-green-600 hover:bg-green-700 font-bold transition-colors focus:ring-2 focus:ring-green-300 focus:outline-none"
                        >
                            {confirmText}
                        </button>
                    </div>
                </div>
             </div>
        </div>
    );
};

const calculateSimilarity = (s1: string, s2: string): number => {
    const normalize = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '');
    const a = normalize(s1);
    const b = normalize(s2);
    
    // Check known synonyms mapped to typical Field keys
    const SYNONYM_GROUPS = [
        ['all_employee_groups', 'all employee groups', 'role', 'rolle', 'befattning', 'stilling', 'position', 'roles'],
        ['update - mobile', 'mobile', 'cellphone', 'mobil', 'mobiltelefon', 'handy', 'telefon', 'phone', 'cell phone'],
        ['update - jobtitle', 'jobtitle', 'job title', 'jobtitel'],
        ['all_departments', 'all departments', 'department', 'segment', 'afdeling', 'avdelning', 'avdeling', 'abteilung', 'dept', 'departments'],
        ['first name', 'firstname', 'fornavn', 'förnamn', 'vorname'],
        ['last name', 'lastname', 'efternavn', 'efternamn', 'etternavn', 'nachname'],
        ['name', 'navn', 'namn', 'fullname', 'fulde navn']
    ];

    const aNoSpace = a.replace(/ /g, '');
    const bNoSpace = b.replace(/ /g, '');

    for (const group of SYNONYM_GROUPS) {
        const normGroup = group.map(t => t.replace(/[^a-z0-9]/g, ''));
        const aSyn = normGroup.some(t => aNoSpace.includes(t) || t.includes(aNoSpace));
        const bSyn = normGroup.some(t => bNoSpace.includes(t) || t.includes(bNoSpace));
        if (aSyn && bSyn) {
            return 1.0;
        }
    }

    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    const getLevenshteinDistance = (str1: string, str2: string) => {
        const m = str1.length;
        const n = str2.length;
        const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + cost
                );
            }
        }
        return dp[m][n];
    };

    const getSim = (str1: string, str2: string) => {
        const maxLen = Math.max(str1.length, str2.length);
        if (maxLen === 0) return 1;
        const dist = getLevenshteinDistance(str1, str2);
        const sim = 1 - (dist / maxLen);
        
        if (str1.startsWith(str2) || str2.startsWith(str1)) {
            return Math.max(sim, 0.85); 
        }
        return sim;
    };

    const scoreFull = getSim(a.replace(/ /g, ''), b.replace(/ /g, ''));

    const tokensA = a.split(' ').filter(t => t.length > 0);
    const tokensB = b.split(' ').filter(t => t.length > 0);

    let totalTokenScore = 0;
    const [shortT, longT] = tokensA.length < tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
    
    for (const t1 of shortT) {
        let bestTokenMatch = 0;
        for (const t2 of longT) {
            bestTokenMatch = Math.max(bestTokenMatch, getSim(t1, t2));
        }
        totalTokenScore += bestTokenMatch;
    }
    
    const scoreTokens = shortT.length > 0 ? (totalTokenScore / shortT.length) : 0;
    const lengthPenalty = Math.max(shortT.length, longT.length) > shortT.length ? 0.9 : 1.0;

    return Math.max(scoreFull, scoreTokens * lengthPenalty);
};

const SIMILARITY_THRESHOLD = 0.80;

const extractEmployeeName = (row: any): string => {
    let first = "";
    let last = "";
    let full = "";
    const namePattern = /^(name|navn|namn|fullname|fulde(\s*)navn)$/i;
    const firstPattern = /^(first(\s*)name|firstname|fornavn|förnamn|vorname)$/i;
    const lastPattern = /^(last(\s*)name|lastname|efternavn|efternamn|etternavn|nachname)$/i;

    for (const key of Object.keys(row)) {
        if (!row[key]) continue;
        const cleanKey = key.trim();
        if (firstPattern.test(cleanKey)) first = String(row[key]);
        else if (lastPattern.test(cleanKey)) last = String(row[key]);
        else if (namePattern.test(cleanKey)) full = String(row[key]);
    }
    
    const combined = (first + " " + last).trim();
    if (combined && combined !== "null") return combined;
    if (full && full !== "null") return full.trim();
    return "";
};

interface Option {
    value: string | number;
    label: string;
}

const SearchableSelect: React.FC<{ 
    options: Option[]; 
    value: string | number | null; 
    onChange: (val: string) => void; 
    placeholder?: string;
    disabled?: boolean;
    displayValue?: string;
    usedValues?: Set<string | number>;
    usePortal?: boolean;
    matchStatus?: 'exact' | 'auto' | 'manual' | null;
}> = ({ options, value, onChange, placeholder = "Select...", disabled = false, displayValue, usedValues, usePortal = true, matchStatus = null }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState("");
    const wrapperRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

    useEffect(() => {
        if (isOpen) {
            const timer = setTimeout(() => {
                inputRef.current?.focus({ preventScroll: true });
            }, 10);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as Node;
            if (wrapperRef.current && !wrapperRef.current.contains(target) && (!menuRef.current || !menuRef.current.contains(target))) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        if (!isOpen) setSearch("");
        
        let isMounted = true;
        let animationFrameId: number | null = null;

        const calculatePos = () => {
             if (usePortal && wrapperRef.current && isOpen && isMounted) {
                 const rect = wrapperRef.current.getBoundingClientRect();
                 const spaceBelow = window.innerHeight - rect.bottom;
                 const spaceAbove = rect.top;
                 
                 // if no space below but space above, render above
                 if (spaceBelow < 150 && spaceAbove > 200) {
                     setMenuStyle(prev => {
                         const newStyle = {
                             position: 'fixed' as const,
                             bottom: (window.innerHeight - rect.top) + 'px',
                             left: rect.left + 'px',
                             width: rect.width + 'px',
                             maxHeight: Math.min(300, spaceAbove - 20) + 'px',
                             zIndex: 99999
                         };
                         if (prev.bottom === newStyle.bottom && prev.left === newStyle.left) return prev;
                         return newStyle;
                     });
                 } else {
                     setMenuStyle(prev => {
                         const newStyle = {
                             position: 'fixed' as const,
                             top: rect.bottom + 'px',
                             left: rect.left + 'px',
                             width: rect.width + 'px',
                             maxHeight: Math.min(300, Math.max(150, spaceBelow - 20)) + 'px',
                             zIndex: 99999
                         };
                         if (prev.top === newStyle.top && prev.left === newStyle.left) return prev;
                         return newStyle;
                     });
                 }
             } else if (!usePortal && isMounted) {
                 setMenuStyle({
                     position: 'absolute',
                     top: '100%',
                     left: 0,
                     width: '100%',
                     maxHeight: '300px',
                     zIndex: 99999,
                     marginTop: '4px'
                 });
             }
             animationFrameId = null;
        };

        const updatePos = () => {
             if (!animationFrameId) {
                 animationFrameId = requestAnimationFrame(calculatePos);
             }
        };
        
        if (isOpen) {
            updatePos();
            if (usePortal) {
                window.addEventListener('scroll', updatePos, { passive: true });
                window.addEventListener('resize', updatePos, { passive: true });
            }
        }
        
        return () => {
            isMounted = false;
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
            if (usePortal) {
                window.removeEventListener('scroll', updatePos);
                window.removeEventListener('resize', updatePos);
            }
        };
    }, [isOpen, usePortal]);

    const selectedOption = options.find(o => String(o.value) === String(value));
    const currentLabel = displayValue || (selectedOption ? selectedOption.label : (value ? String(value) : placeholder));

    const filteredOptions = useMemo(() => {
        let result = options;
        if (search) {
            const lower = search.toLowerCase();
            result = options.filter(o => o.label.toLowerCase().includes(lower));
        }
        return result.slice(0, 50);
    }, [options, search]);

    if (disabled) {
        return (
            <div className="w-full p-2 border border-gray-200 rounded bg-gray-100 text-gray-500 text-sm truncate select-none italic">
                {currentLabel}
            </div>
        );
    }

    const menuContent = (
        <div 
            ref={menuRef}
            className={`bg-white border border-gray-200 rounded-lg shadow-xl flex flex-col min-w-[200px] ${!usePortal ? 'absolute' : ''}`}
            style={menuStyle}
        >
            <div className="p-2 border-b border-gray-100">
                <input 
                    ref={inputRef}
                    type="text" 
                    className="w-full p-1.5 px-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900"
                    placeholder="Type to search..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>
            <div className="overflow-y-auto flex-1 p-1">
                <div 
                    className="p-2 rounded hover:bg-gray-100 cursor-pointer text-gray-500 italic text-sm mb-1"
                    onClick={() => { onChange(""); setIsOpen(false); }}
                >
                    {placeholder} (Clear)
                </div>
                {filteredOptions.length > 0 ? (
                    filteredOptions.map(opt => {
                        const isUsed = usedValues?.has(opt.value) && String(opt.value) !== String(value);
                        return (
                            <div 
                                key={opt.value} 
                                className={`p-2 rounded cursor-pointer text-sm mb-0.5 flex justify-between items-center 
                                    ${String(opt.value) === String(value) ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}
                                    ${isUsed ? 'opacity-50' : ''}
                                `}
                                onClick={() => { onChange(String(opt.value)); setIsOpen(false); }}
                            >
                                <span className={isUsed ? 'line-through decoration-gray-400' : ''}>
                                    {opt.label}
                                </span>
                                {isUsed && <span className="text-xs text-gray-400 italic ml-2">(Mapped)</span>}
                            </div>
                        );
                    })
                ) : (
                    <div className="p-2 text-gray-500 text-sm italic text-center">No results found</div>
                )}
            </div>
        </div>
    );

    let borderClass = 'border-gray-300 hover:border-blue-300';
    let bgClass = 'bg-white';
    let icon = null;

    if (isOpen) {
        borderClass = 'ring-2 ring-blue-100 border-blue-400';
        bgClass = 'bg-white';
    } else {
        if (matchStatus === 'auto') {
            borderClass = 'border-amber-400 hover:border-amber-500';
            bgClass = 'bg-amber-50';
            icon = <span className="text-amber-600" title="Auto-mapped">✨</span>;
        } else if (matchStatus === 'manual') {
            borderClass = 'border-blue-400 hover:border-blue-500';
            bgClass = 'bg-blue-50';
        }
    }

    return (
        <div className="relative w-full" ref={wrapperRef}>
            <div 
                className={`w-full p-2 border rounded cursor-pointer flex justify-between items-center text-sm transition-all flex-nowrap h-[38px] ${borderClass} ${bgClass}`}
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className={`truncate flex items-center gap-2 ${!selectedOption && !value ? 'text-gray-400' : 'text-gray-800'}`}>
                    {icon}
                    {currentLabel}
                </span>
                <span className="text-gray-400 text-xs ml-2 pointer-events-none flex-shrink-0">▼</span>
            </div>
            
            {isOpen && (usePortal ? createPortal(menuContent, document.body) : menuContent)}
        </div>
    );
};

const PageHeader: React.FC = () => (
    <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 flex items-center justify-center gap-3">
            Planday Bulk Employee Updater
            <span className="bg-blue-500 text-white text-xs font-bold px-2 py-1 rounded-full align-middle">BETA</span>
        </h1>
        <p className="mt-2 text-lg text-gray-500">Update employee details in bulk from Excel files or Table</p>
    </div>
);

const Loader: React.FC<{ text: string }> = ({ text }) => (
    <div className="flex items-center text-gray-500"><svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span>{text}</span></div>
);

const ProgressBar: React.FC<{ percentage: number; current?: number; total?: number; label?: string }> = ({ percentage, current, total, label = "Processing Updates..." }) => (
    <div className="w-full">
        <div className="flex justify-between mb-2 items-end">
            <span className="text-sm font-bold text-blue-900">{label}</span>
            {typeof current === 'number' && typeof total === 'number' && total > 0 && (
                <span className="text-xs font-medium text-blue-700 bg-blue-100 px-2 py-1 rounded-full">
                    {current} / {total}
                </span>
            )}
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div 
                className="bg-blue-600 h-3 rounded-full transition-all duration-300 ease-out" 
                style={{ width: `${percentage}%` }}
            />
        </div>
    </div>
);

const Stepper: React.FC<{ current: number; steps: { title: string; subtitle: string }[]; onStepClick: (index: number) => void; skippedSteps?: number[] }> = ({ current, steps, onStepClick, skippedSteps = [] }) => (
    <nav aria-label="Progress">
        <ol role="list" className="flex items-center">
            {steps.map((step, index) => {
                const isLastStep = index === steps.length - 1;
                const isCompleted = index < current || (index === current && isLastStep);
                const isCurrent = index === current;
                const isSkipped = skippedSteps.includes(index);
                // Allow clicking step 1 (Authentication) to reset/logout
                const canClick = index === 0; 
                
                return (
                    <li key={step.title} className={`relative ${index !== steps.length - 1 ? 'flex-1' : ''}`}>
                        <div 
                            className={`flex items-center text-sm font-medium ${canClick ? 'cursor-pointer group' : ''}`}
                            onClick={() => canClick && onStepClick(index)}
                        >
                            <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors ${isSkipped && (isCompleted || isCurrent) ? 'bg-yellow-100 text-yellow-700 font-bold border border-yellow-300' : isCompleted ? 'bg-green-600 outline-none text-white' : isCurrent ? 'bg-blue-600 outline-none text-white' : 'bg-gray-300 outline-none text-gray-600'} ${canClick ? 'group-hover:opacity-80' : ''}`}>
                                {isSkipped && (isCompleted || isCurrent) ? <span>{index + 1}</span> : isCompleted ? <CheckIcon className="h-6 w-6" /> : <span>{index + 1}</span>}
                            </span>
                            <div className="ml-4 hidden md:block">
                                <span className={`block text-sm font-semibold ${isSkipped && (isCompleted || isCurrent) ? 'text-yellow-600' : isCompleted ? 'text-green-600' : isCurrent ? 'text-blue-600' : 'text-gray-500'}`}>{step.title}</span>
                                <span className="block text-sm text-gray-500">{isSkipped && (isCompleted || isCurrent) ? 'Skipped' : step.subtitle}</span>
                            </div>
                        </div>
                        {index !== steps.length - 1 && <div className={`absolute top-5 left-10 -ml-px mt-px h-0.5 w-full ${isCompleted ? 'bg-green-600' : 'bg-gray-300'} aria-hidden="true"`} />}
                    </li>
                );
            })}
        </ol>
    </nav>
);

const TokenGuide: React.FC = () => (
    <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 flex flex-col justify-center">
        <h3 className="text-2xl font-bold mb-4 text-gray-900">How to get your refresh token</h3>
        <p className="text-gray-600 mb-6">Follow these steps to generate the necessary credentials from your Planday portal.</p>
        
        <ol className="list-decimal list-inside space-y-4 text-gray-700">
            <li>Log in to your Planday portal</li>
            <li>Go to <strong>Settings &rarr; API Access</strong></li>
            <li>
                Click <span className="bg-blue-100 text-blue-800 px-1 rounded">"Connect APP"</span> and connect to app:
                <div className="mt-2 flex items-center justify-between bg-gray-100 p-3 rounded border border-gray-200 font-mono text-sm text-gray-800">
                    <span className="break-all">13000bf2-dd1f-41ab-a1a0-eeec783f50d7</span>
                    <button className="text-gray-500 hover:text-blue-600 ml-2 p-1 transition-colors" onClick={() => navigator.clipboard.writeText('13000bf2-dd1f-41ab-a1a0-eeec783f50d7')} title="Copy ID">
                        <CopyIcon className="w-5 h-5"/>
                    </button>
                </div>
            </li>
            <li>Authorize the app when prompted</li>
            <li>Copy the <strong>"Token"</strong> value (this is your Refresh Token)</li>
        </ol>
    </div>
);

const AppInfoFooter: React.FC = () => (
    <footer className="py-8 text-center text-gray-400 text-xs mt-auto">
        <div className="flex justify-center items-center gap-1 mb-2 group relative">
            <span className="font-medium">App Info</span>
            <InfoIcon className="w-4 h-4 cursor-help text-gray-400 hover:text-gray-600" />
            
            <div className="absolute bottom-full mb-2 w-96 p-5 bg-gray-900 text-white text-left rounded-xl text-xs shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 left-1/2 -translate-x-1/2">
                <p className="leading-relaxed mb-4">
                    <strong className="text-white block mb-1">Client-Side Processing & Secure:</strong>
                    This app is a React-based JavaScript web application that runs entirely in your browser. 
                    Your Excel files and employee data are processed locally in your browser and are never sent to any third‑party servers; 
                    they are only transmitted directly to the official Planday Open API over a secure encrypted connection (HTTPS).
                </p>
                <a href="https://openapi.planday.com/" target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:text-blue-200 underline block mb-4">
                    Planday Open API Documentation
                </a>
                <div className="pt-3 border-t border-gray-700 text-center text-gray-500">
                     Version 2.1 <br/> Made with ❤️ by the Planday Community
                </div>
            </div>
        </div>
    </footer>
);

const ResultBreakdown: React.FC<{ results: EmployeeUpdateReview['results'] }> = ({ results }) => {
    if (!results) return <span className="text-gray-400">-</span>;
    
    // Grouping Logic
    const sections = [];

    // 1. HR Fields (Main + Username)
    // Includes System HR fields + Custom fields + Skills (all in 'main') + Username
    const mainActive = results.main && results.main.message !== 'Skipped';
    const userActive = results.username && results.username.message !== 'Skipped';
    
    if (mainActive || userActive) {
        let success = true;
        const msgs: string[] = [];
        
        if (results.main && !results.main.success) {
            success = false;
            msgs.push(results.main.message);
        }
        if (results.username && !results.username.success) {
            success = false;
            msgs.push(`Username: ${results.username.message}`);
        }
        
        sections.push({
            label: 'HR Fields',
            success,
            message: success ? 'Success' : msgs.join('; ')
        });
    }

    // 2. Supervisor
    if (results.supervisor && results.supervisor.message !== 'Skipped') {
        sections.push({
            label: 'Supervisor',
            success: results.supervisor.success,
            message: results.supervisor.message === 'Success' ? 'Success' : results.supervisor.message
        });
    }

    // 3. Contract Rule
    if (results.contract && results.contract.message !== 'Skipped') {
        sections.push({
            label: 'Contract Rule',
            success: results.contract.success,
            message: results.contract.message === 'Success' ? 'Success' : results.contract.message
        });
    }

    // 4. Wages & Salaries
    const salaryActive = results.salary && results.salary.message !== 'Skipped';
    const ratesActive = results.rates && results.rates.message !== 'Skipped';
    
    if (salaryActive || ratesActive) {
        let success = true;
        const msgs: string[] = [];
        
        if (results.salary && !results.salary.success) {
            success = false;
            msgs.push(`Salary: ${results.salary.message}`);
        }
        if (results.rates && !results.rates.success) {
            success = false;
            msgs.push(`Wages: ${results.rates.message}`);
        }
        
        sections.push({
            label: 'Wages & Salaries',
            success,
            message: success ? 'Success' : msgs.join('; ')
        });
    }

    if (sections.length === 0) return <span className="text-gray-400">Skipped</span>;

    return (
        <div className="text-xs space-y-1">
            {sections.map((p, i) => (
                <div key={i} className={`flex gap-1 min-w-0 ${p.success ? 'text-green-700' : 'text-red-700'}`}>
                    <span className="font-semibold shrink-0">{p.label}:</span>
                    <span className="truncate" title={p.message}>{p.message}</span>
                </div>
            ))}
        </div>
    );
};

interface ValidationError {
    rawRowIndex: number;
    row: number;
    employeeName: string;
    field: string;
    fullKey?: string;
    value: string;
    allowed: string[];
}

const ValidationErrorsView: React.FC<{ 
    errors: ValidationError[]; 
    onBack: () => void;
    onUpdateValue: (rawRowIndex: number, fullKey: string, newValue: string) => void;
    onRevalidate: () => void;
    onSkipFields: () => void;
    onContinueWithErrors?: () => void;
    validationSource?: 'upload' | 'review';
}> = ({ errors, onBack, onUpdateValue, onRevalidate, onSkipFields, onContinueWithErrors, validationSource }) => {
    const [showSkipConfirm, setShowSkipConfirm] = useState(false);

    const canEdit = (item: ValidationError) => {
        if (!item.fullKey) return false;
        if (item.fullKey === 'FIXED_SALARY_MISSING' || item.fullKey.startsWith('GROUP_MISSING_')) return false;
        return true;
    };

    const isDropdown = (item: ValidationError) => {
        if (!canEdit(item)) return false;
        if (item.allowed.length === 0) return false;
        if (item.allowed[0].includes("Valid Date")) return false;
        if (item.allowed[0].includes("Must provide")) return false;
        return true;
    };

    return (
        <div className="bg-white p-8 rounded-xl shadow-lg border border-red-100 max-w-6xl mx-auto">
            <div className="flex items-center gap-4 mb-6">
                <div className="bg-red-100 p-3 rounded-full">
                    <AlertIcon className="w-8 h-8 text-red-600" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Validation Failed</h2>
                    <p className="text-red-600 font-medium">We found invalid data in your file. You can correct them below, fix in file and re-upload, skip the invalid values, or continue with invalid fields to fix them in the table later.</p>
                </div>
            </div>

            <p className="text-gray-600 mb-6">
                The values in the fields below do not match the allowed options in Planday. <br/>
                Please correct these values directly in the table, skip them, or update your Excel file.
            </p>

            <div className="border border-red-200 rounded-lg overflow-hidden mb-8">
                <div className="max-h-[500px] overflow-y-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-red-50 sticky top-0 border-b border-red-200">
                            <tr>
                                <th className="p-3 font-semibold text-gray-700 w-16">Row</th>
                                <th className="p-3 font-semibold text-gray-700 w-48">Employee</th>
                                <th className="p-3 font-semibold text-gray-700 w-48">Field</th>
                                <th className="p-3 font-semibold text-gray-700 w-64">Invalid Value</th>
                                <th className="p-3 font-semibold text-gray-700">Allowed Options</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {errors.map((item, idx) => (
                                <tr key={idx} className="hover:bg-gray-50">
                                    <td className="p-3 text-gray-500 font-mono">{item.row}</td>
                                    <td className="p-3 font-medium text-gray-900">{item.employeeName}</td>
                                    <td className="p-3 text-gray-700 font-semibold">{item.field}</td>
                                    <td className="p-3">
                                        {canEdit(item) ? (
                                            isDropdown(item) ? (
                                                <select
                                                    value={item.value || ""}
                                                    onChange={e => onUpdateValue(item.rawRowIndex, item.fullKey!, e.target.value)}
                                                    className="w-full text-red-700 border border-red-300 rounded p-1 text-sm bg-white"
                                                >
                                                    <option value={item.value} disabled>{item.value || "Empty"}</option>
                                                    <option value="">-- Clear --</option>
                                                    {item.allowed.map(opt => (
                                                        <option key={opt} value={opt}>{opt}</option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={item.value || ""}
                                                    onChange={e => onUpdateValue(item.rawRowIndex, item.fullKey!, e.target.value)}
                                                    className="w-full text-red-700 border border-red-300 rounded p-1 text-sm bg-white placeholder-red-300"
                                                    placeholder="Enter valid value"
                                                />
                                            )
                                        ) : (
                                            <span className="text-red-600 font-mono bg-red-50 rounded px-1">{item.value}</span>
                                        )}
                                    </td>
                                    <td className="p-3 text-gray-600">
                                        <div className="flex flex-wrap gap-1">
                                            {item.allowed.slice(0, 10).map((opt, i) => (
                                                <span key={i} className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs border border-gray-200">
                                                    {opt}
                                                </span>
                                            ))}
                                            {item.allowed.length > 10 && (
                                                <span className="text-xs text-gray-400 self-center">+{item.allowed.length - 10} more...</span>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="flex justify-between items-center">
                <button 
                    onClick={onBack} 
                    className="font-medium text-gray-600 hover:text-gray-900 transition-colors"
                >
                    &larr; Back
                </button>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => {
                            if (validationSource === 'review') {
                                setShowSkipConfirm(true);
                            } else {
                                onSkipFields();
                            }
                        }} 
                        className="bg-white text-gray-700 border border-gray-300 px-5 py-2.5 rounded-lg font-medium hover:bg-gray-50 flex items-center transition-colors"
                    >
                        Skip Invalid Fields
                    </button>
                    {onContinueWithErrors && (
                        <button 
                            onClick={onContinueWithErrors} 
                            className="bg-white text-yellow-700 border border-yellow-300 px-5 py-2.5 rounded-lg font-medium hover:bg-yellow-50 flex items-center transition-colors"
                        >
                            Continue with Errors
                        </button>
                    )}
                    {validationSource !== 'review' && (
                        <button 
                            onClick={onRevalidate} 
                            className="bg-blue-600 text-white px-5 py-2.5 rounded-lg font-bold hover:bg-blue-700 flex items-center transition-colors"
                        >
                            Re-validate & Continue
                        </button>
                    )}
                </div>
            </div>

            <ConfirmModal 
                isOpen={showSkipConfirm}
                onClose={() => setShowSkipConfirm(false)}
                onConfirm={onSkipFields}
                title="Skip Invalid Fields"
                message="The invalid field values will be removed, and you will be taken back to the table editor to review changes. Continue?"
                confirmText="Yes, skip and continue"
                cancelText="Cancel"
            />
        </div>
    );
};

// --- Employee & Field Mapping Components ---

interface IdentitySelectorProps {
    headers: string[];
    onNext: (method: 'NAME' | 'ID', config?: any) => void;
    onBack: () => void;
}

const IdentitySelector: React.FC<IdentitySelectorProps> = ({ headers, onNext, onBack }) => {
    const [method, setMethod] = useState<'NAME' | 'ID'>('NAME');
    const [selectedColumn, setSelectedColumn] = useState('');
    
    // New State for Name configuration
    const [nameMode, setNameMode] = useState<'AUTO' | 'SINGLE' | 'SPLIT'>('AUTO');
    const [nameCol1, setNameCol1] = useState(''); // Single col OR First Name
    const [nameCol2, setNameCol2] = useState(''); // Last Name

    const options = useMemo(() => headers.map(h => ({ value: h, label: h })), [headers]);

    const isNextDisabled = () => {
        if (method === 'ID') return !selectedColumn;
        if (method === 'NAME') {
             if (nameMode === 'SINGLE' && !nameCol1) return true;
             if (nameMode === 'SPLIT' && (!nameCol1 || !nameCol2)) return true;
        }
        return false;
    };

    const handleNext = () => {
        if (method === 'ID') {
            onNext('ID', selectedColumn);
        } else {
            onNext('NAME', { mode: nameMode, col1: nameCol1, col2: nameCol2 });
        }
    };

    return (
        <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 max-w-2xl mx-auto">
             <h2 className="text-2xl font-bold mb-4">Identify Employees</h2>
             <p className="text-gray-500 mb-6">
                Your template was not generated from this app. How would you like to match employees from your file to the employee profiles in Planday?
             </p>

             <div className="space-y-4 mb-8">
                 <div 
                    className={`border rounded-lg p-4 cursor-pointer transition-all ${method === 'NAME' ? 'ring-2 ring-blue-500 bg-blue-50 border-blue-500' : 'border-gray-200 hover:border-gray-300'}`}
                    onClick={() => setMethod('NAME')}
                 >
                     <div className="flex items-start gap-3">
                         <div className={`w-5 h-5 mt-1 rounded-full border flex items-center justify-center ${method === 'NAME' ? 'border-blue-600' : 'border-gray-400'}`}>
                             {method === 'NAME' && <div className="w-2.5 h-2.5 bg-blue-600 rounded-full" />}
                         </div>
                         <div className="flex-1">
                             <div className="font-bold flex items-center gap-2">
                                 <UserGroupIcon className="w-5 h-5 text-gray-500"/>
                                 Match by Name
                             </div>
                             <p className="text-sm text-gray-500 mt-1">Attempts to match First and Last names.</p>
                             
                             {method === 'NAME' && (
                                <div className="mt-4 bg-white p-3 rounded border border-gray-200 cursor-default" onClick={e => e.stopPropagation()}>
                                    <div className="mb-3">
                                         <label className="block text-xs font-bold text-gray-700 mb-1">Name Format in File:</label>
                                         <div className="flex gap-2">
                                             <button className={`px-2 py-1 text-xs rounded border transition-colors ${nameMode === 'AUTO' ? 'bg-blue-100 text-blue-700 border-blue-300 font-semibold' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`} onClick={() => setNameMode('AUTO')}>Auto-Detect</button>
                                             <button className={`px-2 py-1 text-xs rounded border transition-colors ${nameMode === 'SINGLE' ? 'bg-blue-100 text-blue-700 border-blue-300 font-semibold' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`} onClick={() => setNameMode('SINGLE')}>Single Column</button>
                                             <button className={`px-2 py-1 text-xs rounded border transition-colors ${nameMode === 'SPLIT' ? 'bg-blue-100 text-blue-700 border-blue-300 font-semibold' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`} onClick={() => setNameMode('SPLIT')}>Two Columns</button>
                                         </div>
                                    </div>

                                    {nameMode === 'SINGLE' && (
                                        <div className="mb-2 animate-fadeIn">
                                            <label className="block text-xs font-bold text-gray-700 mb-1">Select Column (Full Name):</label>
                                            <SearchableSelect options={options} value={nameCol1} onChange={setNameCol1} placeholder="-- Select Full Name Column --" />
                                        </div>
                                    )}

                                    {nameMode === 'SPLIT' && (
                                        <div className="grid grid-cols-2 gap-2 animate-fadeIn">
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 mb-1">First Name Column:</label>
                                                <SearchableSelect options={options} value={nameCol1} onChange={setNameCol1} placeholder="-- First Name --" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 mb-1">Last Name Column:</label>
                                                <SearchableSelect options={options} value={nameCol2} onChange={setNameCol2} placeholder="-- Last Name --" />
                                            </div>
                                        </div>
                                    )}
                                    
                                    {nameMode === 'AUTO' && (
                                         <p className="text-xs text-gray-500 italic animate-fadeIn">We will try to automatically identify name columns like "Name", "Employee", "First Name", "Last Name".</p>
                                    )}
                                </div>
                            )}
                         </div>
                     </div>
                 </div>

                 <div 
                    className={`border rounded-lg p-4 cursor-pointer transition-all ${method === 'ID' ? 'ring-2 ring-blue-500 bg-blue-50 border-blue-500' : 'border-gray-200 hover:border-gray-300'}`}
                    onClick={() => setMethod('ID')}
                 >
                     <div className="flex items-start gap-3">
                         <div className={`w-5 h-5 mt-1 rounded-full border flex items-center justify-center ${method === 'ID' ? 'border-blue-600' : 'border-gray-400'}`}>
                             {method === 'ID' && <div className="w-2.5 h-2.5 bg-blue-600 rounded-full" />}
                         </div>
                         <div className="flex-1">
                             <div className="font-bold flex items-center gap-2">
                                 <BadgeIdIcon className="w-5 h-5 text-gray-500"/>
                                 Match by Salary Identifier (Payroll ID)
                             </div>
                             <p className="text-sm text-gray-500 mt-1">Uses a specific column in your file to match against the Planday Payroll ID.</p>
                             
                             {method === 'ID' && (
                                 <div className="mt-4 bg-white p-3 rounded border border-gray-200 animate-fadeIn" onClick={e => e.stopPropagation()}>
                                     <label className="block text-xs font-bold text-gray-700 mb-1">Select Column containing ID:</label>
                                     <SearchableSelect 
                                        options={options} 
                                        value={selectedColumn} 
                                        onChange={setSelectedColumn}
                                        placeholder="-- Select Column --"
                                     />
                                 </div>
                             )}
                         </div>
                     </div>
                 </div>
             </div>

             <div className="flex justify-end gap-4">
                <button onClick={onBack} className="text-gray-600 hover:text-gray-900 px-4">Back</button>
                <button 
                    onClick={handleNext} 
                    disabled={isNextDisabled()}
                    className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    Next
                </button>
            </div>
        </div>
    );
};

interface EmployeeMapperProps {
    rows: any[];
    employees: Employee[];
    initialMapping?: Map<number, number | null>;
    matchMethod?: 'NAME' | 'ID';
    onComplete: (mapping: Map<number, number>) => void;
    onCancel: () => void;
    onBack: () => void;
    onShowHelp?: () => void;
}

const EmployeeMapper: React.FC<EmployeeMapperProps> = ({ rows, employees, initialMapping, matchMethod = 'NAME', onComplete, onCancel, onBack, onShowHelp }) => {
    // Attempt auto-match on mount if initialMapping not provided
    const [mapping, setMapping] = useState<Map<number, number | null>>(new Map());
    const [showUnmappedFirst, setShowUnmappedFirst] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [matchTypes, setMatchTypes] = useState<Map<number, 'exact' | 'auto' | 'manual'>>(new Map());
    const [showAutoMapConfirm, setShowAutoMapConfirm] = useState(false);
    
    useEffect(() => {
        if (initialMapping) {
            setMapping(initialMapping);
            const initialMatchTypes = new Map<number, 'exact' | 'auto' | 'manual'>();
            initialMapping.forEach((val, key) => initialMatchTypes.set(key, 'exact'));
            setMatchTypes(initialMatchTypes);
            return;
        }

        // Fallback to name matching if no initial map provided (should not happen with new flow, but good for safety)
        const newMap = new Map<number, number | null>();
        const newMatchTypes = new Map<number, 'exact' | 'auto' | 'manual'>();
        
        const empMap = new Map<string, number>();
        employees.forEach(e => {
            empMap.set(`${e.firstName.toLowerCase()} ${e.lastName.toLowerCase()}`, e.id);
            empMap.set(`${e.firstName} ${e.lastName}`.toLowerCase(), e.id);
        });

        rows.forEach((row, idx) => {
            let name = "";
            const keys = Object.keys(row).map(k => k.toLowerCase());
            
            if (row["First Name"] && row["Last Name"]) {
                name = `${row["First Name"]} ${row["Last Name"]}`;
            } else if (row["Name"]) {
                name = row["Name"];
            } else if (row["Employee"]) {
                name = row["Employee"];
            } else if (row["Full Name"]) {
                name = row["Full Name"];
            } else {
                const nameKey = Object.keys(row).find(k => k.toLowerCase().includes('name'));
                if (nameKey) name = row[nameKey];
            }
            
            if (name) {
                const cleanName = String(name).toLowerCase().trim();
                const matchedId = empMap.get(cleanName);
                if (matchedId) {
                    newMap.set(idx, matchedId);
                    newMatchTypes.set(idx, 'exact');
                } else {
                    newMap.set(idx, null);
                }
            } else {
                newMap.set(idx, null);
            }
        });
        setMapping(newMap);
        setMatchTypes(newMatchTypes);
    }, [rows, employees, initialMapping]);

    const handleSelect = (rowIdx: number, empId: string) => {
        const newMap = new Map(mapping);
        const newMatchTypes = new Map(matchTypes);

        if (empId === "") {
            newMap.set(rowIdx, null);
            newMatchTypes.delete(rowIdx);
        } else {
            newMap.set(rowIdx, parseInt(empId, 10));
            newMatchTypes.set(rowIdx, 'manual');
        }
        
        setMapping(newMap);
        setMatchTypes(newMatchTypes);
    };

    const handleAutoMap = () => {
        const newMap = new Map(mapping);
        const newMatchTypes = new Map(matchTypes);
        let changed = false;

        rows.forEach((row, idx) => {
            if (!newMap.get(idx)) {
                const rowName = extractEmployeeName(row);
                const searchString = (rowName || Object.values(row).join(" ")).toLowerCase();
                
                if (searchString) {
                    let bestMatch = null;
                    let bestScore = 0;
                    employeeOptions.forEach(opt => {
                        const score = calculateSimilarity(searchString, opt.label);
                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = opt.value;
                        }
                    });

                    if (bestScore >= SIMILARITY_THRESHOLD && bestMatch) {
                        newMap.set(idx, bestMatch as number);
                        newMatchTypes.set(idx, 'auto');
                        changed = true;
                    }
                }
            }
        });

        if (changed) {
            setMapping(newMap);
            setMatchTypes(newMatchTypes);
        }
        setShowAutoMapConfirm(false);
    };

    const handleContinue = () => {
        // Filter out rows that are not mapped
        const finalMap = new Map<number, number>();
        mapping.forEach((val, key) => {
            if (val !== null) finalMap.set(key, val);
        });
        onComplete(finalMap);
    };
    
    // Sort employees for dropdown
    const sortedEmployees = useMemo(() => [...employees].sort((a,b) => a.firstName.localeCompare(b.firstName)), [employees]);
    const employeeOptions = useMemo(() => sortedEmployees.map(e => ({ value: e.id, label: `${e.firstName} ${e.lastName}` })), [sortedEmployees]);

    // Create a set of already mapped employee IDs to show in strikethrough
    const usedEmployeeIds = useMemo(() => {
        const used = new Set<number>();
        mapping.forEach(val => {
            if(val !== null) used.add(val);
        });
        return used;
    }, [mapping]);

    // Calculate stats
    const mappedCount = Array.from(mapping.values()).filter(v => v !== null).length;
    const totalRows = rows.length;
    const unmappedCount = totalRows - mappedCount;

    // Prepare rows for display (supporting sort)
    const displayRows = useMemo(() => {
        let rowData = rows.map((r, i) => ({ data: r, index: i }));

        if (searchQuery) {
            const sq = searchQuery.toLowerCase();
            rowData = rowData.filter(r => {
                const rowValues = Object.values(r.data).map(v => String(v).toLowerCase()).join(' ');
                if (rowValues.includes(sq)) return true;
                
                // Also search by mapped employee
                const mappedId = mapping.get(r.index);
                if (mappedId) {
                    const emp = employees.find(e => e.id === mappedId);
                    if (emp && (`${emp.firstName} ${emp.lastName}`.toLowerCase().includes(sq) || (emp.email && emp.email.toLowerCase().includes(sq)))) return true;
                }
                return false;
            });
        }

        if (showUnmappedFirst) {
            rowData.sort((a, b) => {
                const aMapped = mapping.get(a.index) !== null;
                const bMapped = mapping.get(b.index) !== null;
                if (aMapped === bMapped) return a.index - b.index; // Keep original order
                return aMapped ? 1 : -1; // Unmapped (false) comes first
            });
        }
        return rowData;
    }, [rows, mapping, showUnmappedFirst, searchQuery, employees]);

    return (
        <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 max-w-6xl mx-auto">
            {matchMethod === 'NAME' ? (
                <div className="bg-orange-50 border-l-4 border-orange-500 p-4 mb-6 rounded-r-lg">
                    <div className="flex">
                        <div className="flex-shrink-0">
                            <AlertIcon className="h-5 w-5 text-orange-400" />
                        </div>
                        <div className="ml-3">
                            <h3 className="text-sm font-medium text-orange-800">Security Warning: Using Name Matching</h3>
                            <div className="mt-2 text-sm text-orange-700">
                                <p>
                                    Matching employees by name is less secure and prone to errors compared to using Planday IDs or Payroll IDs. 
                                    To avoid manual mapping, please use the generated template from this app. 
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="bg-blue-50 border-l-4 border-blue-500 p-4 mb-6 rounded-r-lg">
                     <div className="flex">
                        <div className="flex-shrink-0">
                            <BadgeIdIcon className="h-5 w-5 text-blue-500" />
                        </div>
                        <div className="ml-3">
                            <h3 className="text-sm font-medium text-blue-800">Matching by Salary Identifier (Payroll ID)</h3>
                            <div className="mt-2 text-sm text-blue-700">
                                <p>We have matched employees based on the selected column. Please review unmapped rows below.</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <h2 className="text-2xl font-bold mb-4">Map Employees</h2>
            <p className="text-gray-500 mb-6">
                Your file is missing the "Planday Employee ID" column. Please map the rows in your file to Planday employees. 
            </p>

            <div className="flex flex-col gap-4 mb-4">
                <div className="flex gap-4 text-sm font-medium">
                    <span className="bg-gray-100 text-gray-800 px-3 py-1 rounded-full border whitespace-nowrap">Total: {totalRows}</span>
                    <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full border border-green-200 whitespace-nowrap">Mapped: {mappedCount}</span>
                    <span className="bg-[#ffe5e5] text-red-800 px-3 py-1 rounded-full border border-red-200 whitespace-nowrap">Unmapped: {unmappedCount}</span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex-1 min-w-[200px] max-w-sm">
                        <input
                            type="text"
                            placeholder="Search employees..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div className="flex gap-4 items-center">
                        <button 
                            onClick={onShowHelp}
                            className="px-3 py-2 border border-gray-300 bg-white shadow-sm rounded flex items-center gap-2 hover:bg-gray-50 text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors"
                            title="Open Mapping Guide"
                        >
                            <span className="text-blue-600">ℹ️</span> Help
                        </button>
                        <button 
                            onClick={() => setShowAutoMapConfirm(true)}
                            className="px-3 py-2 border border-gray-300 bg-white shadow-sm rounded flex items-center gap-2 hover:bg-gray-50 text-sm font-medium text-gray-700 hover:text-indigo-600 transition-colors"
                            title="Try to automatically map remaining unmapped employees"
                        >
                            <span className="text-indigo-600">✨</span> Auto-map
                        </button>
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                            <input 
                                type="checkbox" 
                                checked={showUnmappedFirst} 
                                onChange={e => setShowUnmappedFirst(e.target.checked)} 
                                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 bg-white border-gray-300"
                            />
                            Show unmapped first
                        </label>
                    </div>
                </div>
            </div>
            
            <div className="border rounded-lg overflow-hidden mb-8 h-[80vh] overflow-y-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 sticky top-0 border-b z-10">
                        <tr>
                            <th className="p-3 font-semibold text-gray-700 w-1/2">Row Data (Preview)</th>
                            <th className="p-3 font-semibold text-gray-700 w-1/2">Matched Planday Employee</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {displayRows.map((item) => {
                            const originalIdx = item.index;
                            const row = item.data;
                            const preview = Object.values(row).slice(0, 3).join(' | ');
                            const currentId = mapping.get(originalIdx) || null;
                            const isUnmapped = !currentId;
                            const matchStatus = matchTypes.get(originalIdx) || null;
                            
                            return (
                                <EmployeeMapperRow 
                                    key={originalIdx}
                                    row={row}
                                    originalIdx={originalIdx}
                                    mappedId={currentId}
                                    isUnmapped={isUnmapped}
                                    employeeOptions={employeeOptions}
                                    matchStatus={matchStatus}
                                    usedValues={usedEmployeeIds}
                                    onSelect={handleSelect}
                                />
                            );
                        })}
                    </tbody>
                </table>
            </div>
            
            <div className="flex justify-end gap-4">
                <button onClick={onCancel} className="text-gray-600 hover:text-gray-900 px-4">Cancel</button>
                <button onClick={handleContinue} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700">
                    Next: Map Fields
                </button>
            </div>
            
            <ConfirmModal
                isOpen={showAutoMapConfirm}
                onClose={() => setShowAutoMapConfirm(false)}
                onConfirm={handleAutoMap}
                title="Try to auto-map Employees"
                message="This will try to automatically map fields with high confidence. You will still need to review the matches to ensure they are correct."
                confirmText="Try Auto-map"
                cancelText="Cancel"
            />
        </div>
    );
};

interface TargetField {
    key: string;
    label: string;
}

interface FieldMapperProps {
    fileHeaders: string[];
    availableTargets: TargetField[];
    onComplete: (mapping: Map<string, string>) => void;
    onCancel: () => void;
    initialMapping?: Map<string, string>;
    onShowHelp?: () => void;
}

const EmployeeMapperRow: React.FC<{
    row: any;
    originalIdx: number;
    mappedId: number | null;
    isUnmapped: boolean;
    employeeOptions: any[];
    matchStatus: 'exact' | 'auto' | 'manual' | null;
    usedValues?: Set<number | string>;
    onSelect: (rowIdx: number, empId: string) => void;
}> = ({ row, originalIdx, mappedId, isUnmapped, employeeOptions, matchStatus, usedValues, onSelect }) => {
    const sortedOptions = useMemo(() => {
        const rowName = extractEmployeeName(row);
        const searchString = (rowName || Object.values(row).join(" ")).toLowerCase();
        
        if (!searchString) return employeeOptions;

        const withScore = employeeOptions.map(opt => ({
            ...opt,
            score: typeof opt.value === 'number' || typeof opt.value === 'string' ? calculateSimilarity(searchString, opt.label) : 0
        }));

        return withScore.sort((a, b) => {
            if (a.value === "") return -1;
            if (b.value === "") return 1;
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return a.label.localeCompare(b.label);
        }).map(opt => ({ value: opt.value, label: opt.label }));
    }, [row, employeeOptions]);

    const preview = Object.entries(row)
        .slice(0, 5)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');

    return (
        <tr className={`hover:bg-gray-50 ${isUnmapped ? 'bg-[#ffe5e5]' : ''}`}>
            <td className="p-3 text-gray-600 truncate max-w-md align-middle" title={preview}>{preview}</td>
            <td className="p-3 align-middle">
                <SearchableSelect 
                    options={sortedOptions}
                    value={mappedId}
                    onChange={(val) => onSelect(originalIdx, val)}
                    placeholder="-- Skip Row --"
                    matchStatus={matchStatus}
                    usedValues={usedValues}
                />
            </td>
        </tr>
    );
};

const FieldMapperRow: React.FC<{
    header: string;
    isIdentity: boolean;
    currentTarget: string;
    isUnmapped: boolean;
    targetOptions: any[];
    usedTargets: Set<string>;
    matchStatus: 'exact' | 'auto' | 'manual' | null;
    onSelect: (header: string, val: string) => void;
}> = ({ header, isIdentity, currentTarget, isUnmapped, targetOptions, usedTargets, matchStatus, onSelect }) => {
    const sortedOptions = useMemo(() => {
        if (!header) return targetOptions;
        
        const optionsWithScore = targetOptions.map(opt => ({
            ...opt,
            score: typeof opt.value === 'string' ? Math.max(
                calculateSimilarity(header, opt.value),
                calculateSimilarity(header, opt.label)
            ) : 0
        }));
        
        return optionsWithScore.sort((a, b) => {
            if (a.value === "") return -1;
            if (b.value === "") return 1;

            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return a.label.localeCompare(b.label);
        }).map(opt => ({ value: opt.value, label: opt.label }));
    }, [header, targetOptions]);

    return (
        <tr className={`hover:bg-gray-50 ${isUnmapped ? 'bg-[#ffe5e5]' : ''}`}>
            <td className="p-3 font-medium text-gray-800 align-middle">{header}</td>
            <td className="p-3 align-middle">
                {isIdentity ? (
                    <div className="w-full p-2 border border-transparent bg-gray-100 text-gray-500 rounded italic select-none">
                        Already Mapped (Identity)
                    </div>
                ) : (
                    <SearchableSelect 
                        options={sortedOptions}
                        value={currentTarget}
                        onChange={(val) => onSelect(header, val)}
                        placeholder="-- Ignore --"
                        usedValues={usedTargets}
                        matchStatus={matchStatus}
                    />
                )}
            </td>
        </tr>
    );
};

const FieldMapper: React.FC<FieldMapperProps> = ({ fileHeaders, availableTargets, onComplete, onCancel, initialMapping, onShowHelp }) => {
    const [mapping, setMapping] = useState<Map<string, string>>(new Map());
    const [identityHeaders, setIdentityHeaders] = useState<Set<string>>(new Set());
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [unmappedHeaders, setUnmappedHeaders] = useState<string[]>([]);
    const [filterUnmapped, setFilterUnmapped] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortMethod, setSortMethod] = useState<'Original' | 'FileAsc' | 'FileDesc' | 'MappedStatus'>('Original');
    const [matchTypes, setMatchTypes] = useState<Map<string, 'exact' | 'auto' | 'manual'>>(new Map());
    const [showAutoMapConfirm, setShowAutoMapConfirm] = useState(false);

    useEffect(() => {
        const newMap = new Map<string, string>();
        const newMatchTypes = new Map<string, 'exact' | 'auto' | 'manual'>();
        const identity = new Set<string>();

        // Identify ID columns first (Names)
        const nameRegex = /^(first(\s*)name|last(\s*)name|full(\s*)name|firstname|lastname|fullname|fornavn|efternavn|fulde(\s*)navn|förnamn|efternamn|etternavn|vorname|nachname)$/i;
        const employeeRegex = /^(employee|planday employee id)$/i;
        const payrollRegex = /^(salary\s*identifier|payroll\s*(id|identifier)|identifier|id)$/i;

        fileHeaders.forEach(header => {
            const lower = header.toLowerCase().trim();
            
            // Check for identity fields
            if (nameRegex.test(lower) || employeeRegex.test(lower) || payrollRegex.test(lower)) {
                identity.add(header);
                return; // Skip mapping for identity fields
            }

            if (initialMapping && initialMapping.has(header)) {
                newMap.set(header, initialMapping.get(header)!);
                newMatchTypes.set(header, 'exact');
                return;
            } else if (!initialMapping || initialMapping.size === 0) {
                // Smart Auto-match
                // 1. Exact match with target key or label
                let match = availableTargets.find(t => 
                    t.label.toLowerCase() === lower || 
                    t.key.toLowerCase() === lower || 
                    t.key.replace('UPDATE - ', '').toLowerCase() === lower
                );

                if (!match) {
                    const cleanLower = lower.replace(/[^a-z0-9]/g, '');
                    const aliasMap: Record<string, string[]> = {
                        'mobile': ['cellphone', 'mobile', 'phone', 'cell'],
                        'country code': ['cellphonecountrycode', 'phonecode', 'countrycode', 'mobilecountrycode'],
                        'employee type': ['employeetypeid', 'type', 'employeetype', 'emptype'],
                        'start/hired date': ['hiredfrom', 'hiredate', 'startdate', 'start'],
                        'birth date': ['birthdate', 'dob', 'dateofbirth', 'birthday'],
                        'street 1': ['street1', 'address', 'address1', 'street'],
                        'street 2': ['street2', 'address2'],
                        'assign supervisor': ['supervisorid', 'manager', 'assignsupervisor', 'supervisor'],
                        'is supervisor': ['issupervisor', 'managerflag', 'ismanager'],
                        'email': ['email', 'emailaddress'],
                        'tax id': ['ssn', 'taxid', 'cpr'],
                        'gender': ['gender', 'sex'],
                        'zip': ['zip', 'zipcode', 'postalcode'],
                        'city': ['city', 'town'],
                        'jobtitle': ['jobtitle', 'title', 'role'],
                        'system bank reg': ['bankreg', 'bankregistration', 'bankrouting'],
                        'system bank account nr': ['bankacc', 'bankaccount', 'accountnumber', 'accountnr'],
                        'fixed salary - expected working hours': ['fixedsalaryexpectedhours', 'expectedworkinghours', 'expectedhours']
                    };

                    for (const [canonical, aliases] of Object.entries(aliasMap)) {
                        if (aliases.includes(cleanLower)) {
                            match = availableTargets.find(t => t.label.toLowerCase() === canonical || t.key.toLowerCase() === `update - ${canonical}`);
                            break;
                        }
                    }
                }

                // 2. Smart Match for "Employee Group: X" -> "Group Rate - X"
                if (!match && lower.startsWith('employee group:')) {
                    const groupName = lower.replace('employee group:', '').trim();
                    const targetKey = `UPDATE - Group Rate - ${groupName}`.toLowerCase();
                    match = availableTargets.find(t => t.key.toLowerCase() === targetKey);
                }

                // 2b. Smart Match for multi-select Pseudo fields
                if (!match) {
                    if (lower === 'department' || lower === 'departments') {
                        match = availableTargets.find(t => t.key === 'ALL_DEPARTMENTS');
                    } else if (lower === 'employee group' || lower === 'employee groups' || lower === 'groups' || lower === 'group') {
                        match = availableTargets.find(t => t.key === 'ALL_EMPLOYEE_GROUPS');
                    } else if (lower === 'rate' || lower === 'rates' || lower === 'group rates' || lower === 'employee group rates') {
                        match = availableTargets.find(t => t.key === 'ALL_EMPLOYEE_GROUPS_RATES');
                    } else if (lower === 'wage valid from' || lower === 'salaries valid from' || lower === 'salary valid from' || lower === 'wages valid from') {
                        match = availableTargets.find(t => t.key === 'ALL_WAGE_SALARY_VALID_FROM');
                    }
                }

                // 3. Smart Match for Skills & Departments & Groups
                if (!match) {
                    const prefixMatch = lower.match(/^(skill|department|employee group|group)s?[\s\:\-]+\s*(.*)$/i);
                    let category = "";
                    let itemName = "";
                    if (prefixMatch) {
                        category = prefixMatch[1].toLowerCase();
                        itemName = prefixMatch[2].trim();
                    } else if (lower.match(/[\(\[]\s*x\s*[\)\]]$/i)) {
                        // e.g. "DL (x)"
                        category = "skill";
                        itemName = lower.replace(/[\(\[]\s*x\s*[\)\]]$/i, '').replace(/^skills?[\s\:\-]+/i, '').trim();
                    }

                    if (!itemName) {
                        // try fuzzy match across dynamic targets if it's just the name
                        itemName = lower;
                    }

                    itemName = itemName.replace(/[\(\[]\s*x\s*[\)\]]$/i, '').trim();
                    const cleanItemName = itemName.toLowerCase();

                    const tryMatchTarget = (prefix: string) => {
                        const targetPrefix = `${prefix.toLowerCase()} -`;
                        return availableTargets.find(t => {
                            const lbl = t.label.toLowerCase();
                            if (!lbl.startsWith(targetPrefix)) return false;
                            
                            const tName = lbl.replace(targetPrefix, '').trim();
                            if (tName === cleanItemName) return true;
                            if (tName.replace(/[^a-z0-9]/g, '') === cleanItemName.replace(/[^a-z0-9]/g, '')) return true;
                            return false;
                        });
                    };

                    if (category.includes('group')) match = tryMatchTarget('Group Rate');
                    else if (category.includes('department')) match = tryMatchTarget('Department');
                    else if (category.includes('skill')) match = tryMatchTarget('Skill');
                    else {
                        // If no explicit prefix, guess based on available dynamic targets
                        match = tryMatchTarget('Skill') || tryMatchTarget('Department') || tryMatchTarget('Group Rate');
                    }
                }
                
                if (match) {
                    newMap.set(header, match.key);
                    // if it was found via explicit smart match mapping rules in useEffect, we consider it 'auto' 
                    // unless it was an exact literal string match in step 1, but 'auto' is safer representation of app logic here
                    newMatchTypes.set(header, 'auto');
                }
            }
        });
        
        setMapping(newMap);
        setIdentityHeaders(identity);
        setMatchTypes(newMatchTypes);
    }, [fileHeaders, availableTargets, initialMapping]);

    const handleSelect = (header: string, targetKey: string) => {
        const newMap = new Map(mapping);
        const newMatchTypes = new Map(matchTypes);
        
        if (targetKey === "") {
            newMap.delete(header);
            newMatchTypes.delete(header);
        } else {
            newMap.set(header, targetKey);
            newMatchTypes.set(header, 'manual');
        }
        
        setMapping(newMap);
        setMatchTypes(newMatchTypes);
    };

    const handleAutoMap = () => {
        const newMap = new Map(mapping);
        const newMatchTypes = new Map(matchTypes);
        let changed = false;

        fileHeaders.forEach(header => {
            if (!identityHeaders.has(header) && !newMap.has(header)) {
                let bestMatch = null;
                let bestScore = 0;
                
                availableTargets.forEach(opt => {
                    const score = Math.max(
                        calculateSimilarity(header, opt.key),
                        calculateSimilarity(header, opt.label)
                    );
                    
                    if (score > bestScore) {
                        bestScore = score;
                        bestMatch = opt.key;
                    }
                });

                if (bestScore >= SIMILARITY_THRESHOLD && bestMatch) {
                    newMap.set(header, bestMatch);
                    newMatchTypes.set(header, 'auto');
                    changed = true;
                }
            }
        });

        if (changed) {
            setMapping(newMap);
            setMatchTypes(newMatchTypes);
        }
        setShowAutoMapConfirm(false);
    };

    const handleProcess = () => {
        const unmapped = fileHeaders.filter(h => !identityHeaders.has(h) && !mapping.get(h));
        if (unmapped.length > 0) {
             setUnmappedHeaders(unmapped);
             setShowConfirmModal(true);
             return;
        }
        onComplete(mapping);
    };

    const confirmProcess = () => {
        setShowConfirmModal(false);
        onComplete(mapping);
    };

    const usedTargets = useMemo(() => new Set<string>(mapping.values()), [mapping]);

    const targetOptions = useMemo(() => {
        let filteredTargets = availableTargets;
        
        const hasIndividualValidFrom = Array.from(usedTargets).some((k: string) => 
            k.startsWith('UPDATE - Group Valid From -') || k === 'UPDATE - Fixed Salary - valid from'
        );

        if (usedTargets.has('ALL_WAGE_SALARY_VALID_FROM')) {
            filteredTargets = filteredTargets.filter(t => 
                !t.key.startsWith('UPDATE - Group Valid From -') && 
                t.key !== 'UPDATE - Fixed Salary - valid from'
            );
        } else if (hasIndividualValidFrom) {
            filteredTargets = filteredTargets.filter(t => t.key !== 'ALL_WAGE_SALARY_VALID_FROM');
        }
        
        filteredTargets = [...filteredTargets].sort((a, b) => {
            const aIsAll = a.label.includes('✨ All');
            const bIsAll = b.label.includes('✨ All');
            if (aIsAll && !bIsAll) return -1;
            if (!aIsAll && bIsAll) return 1;
            return 0; // keep original order otherwise
        });

        return [{ value: "", label: "-- Ignore --" }, ...filteredTargets.map(t => ({ value: t.key, label: t.label }))];
    }, [availableTargets, usedTargets]);

    const mappedCount = mapping.size;
    const ignorableCount = fileHeaders.length - mappedCount - identityHeaders.size;

    const finalHeadersForDisplay = useMemo(() => {
        let headers = [...fileHeaders];

        if (filterUnmapped) {
            headers = headers.filter(h => {
                const isIdentity = identityHeaders.has(h);
                const currentTarget = mapping.get(h) || "";
                return !isIdentity && !currentTarget;
            });
        }
        
        if (searchQuery) {
            const sq = searchQuery.toLowerCase();
            headers = headers.filter(h => {
                if (h.toLowerCase().includes(sq)) return true;
                const mappedTo = mapping.get(h);
                if (mappedTo) {
                    const targetOption = availableTargets.find(t => t.key === mappedTo);
                    if (targetOption && targetOption.label.toLowerCase().includes(sq)) return true;
                }
                return false;
            });
        }

        if (sortMethod === 'FileAsc') {
            headers.sort((a,b) => a.localeCompare(b));
        } else if (sortMethod === 'FileDesc') {
            headers.sort((a,b) => b.localeCompare(a));
        } else if (sortMethod === 'MappedStatus') {
            headers.sort((a,b) => {
                const aMapped = identityHeaders.has(a) || !!mapping.get(a);
                const bMapped = identityHeaders.has(b) || !!mapping.get(b);
                if (aMapped === bMapped) return 0;
                return aMapped ? 1 : -1;
            });
        }

        return headers;
    }, [fileHeaders, mapping, identityHeaders, filterUnmapped, searchQuery, sortMethod, availableTargets]);

    return (
         <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 max-w-4xl mx-auto relative">
            <h2 className="text-2xl font-bold mb-4">Map Fields</h2>
            <div className="flex flex-col gap-4 mb-6">
                <div className="flex flex-col gap-2">
                    <p className="text-gray-500">
                        Map columns from your file to Planday fields. Columns left unmapped will be ignored.
                    </p>
                    <div className="flex gap-4 text-sm font-medium">
                        <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full whitespace-nowrap">Mapped: {mappedCount}</span>
                        <span className="bg-[#ffe5e5] text-red-800 px-3 py-1 rounded-full whitespace-nowrap">Unmapped: {ignorableCount}</span>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex-1 min-w-[200px] max-w-sm">
                        <input
                            type="text"
                            placeholder="Search fields..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        />
                    </div>
                    <div className="flex items-center gap-4 flex-wrap">
                        <button 
                            onClick={onShowHelp}
                            className="px-3 py-2 border border-gray-300 bg-white shadow-sm rounded flex items-center gap-2 hover:bg-gray-50 text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors"
                            title="Open Mapping Guide"
                        >
                            <span className="text-blue-600">ℹ️</span> Help
                        </button>
                        <button 
                            onClick={() => setShowAutoMapConfirm(true)}
                            className="px-3 py-2 border border-gray-300 bg-white shadow-sm rounded flex items-center gap-2 hover:bg-gray-50 text-sm font-medium text-gray-700 hover:text-indigo-600 transition-colors"
                            title="Try to automatically map remaining unmapped fields"
                        >
                            <span className="text-indigo-600">✨</span> Auto-map
                        </button>
                        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={filterUnmapped}
                                onChange={(e) => setFilterUnmapped(e.target.checked)}
                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 bg-white border-gray-300"
                            />
                            Filter Unmapped
                        </label>
                        <select
                            value={sortMethod}
                            onChange={(e) => setSortMethod(e.target.value as any)}
                            className="text-sm px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        >
                            <option value="Original">Original Order</option>
                            <option value="FileAsc">File Header (A-Z)</option>
                            <option value="FileDesc">File Header (Z-A)</option>
                            <option value="MappedStatus">Mapped Status</option>
                        </select>
                    </div>
                </div>
            </div>
            
             <div className="border rounded-lg overflow-hidden mb-8 h-[75vh] overflow-y-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 sticky top-0 border-b z-10">
                        <tr>
                            <th className="p-3 font-semibold text-gray-700 w-1/2">File Column Header</th>
                            <th className="p-3 font-semibold text-gray-700 w-1/2">Map to Planday Field</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {finalHeadersForDisplay.map((header, idx) => {
                            const isIdentity = identityHeaders.has(header);
                            const currentTarget = mapping.get(header) || "";
                            const isUnmapped = !isIdentity && !currentTarget;
                            const matchStatus = matchTypes.get(header) || null;
                            
                            return (
                                <FieldMapperRow 
                                    key={idx}
                                    header={header}
                                    isIdentity={isIdentity}
                                    currentTarget={currentTarget}
                                    isUnmapped={isUnmapped}
                                    targetOptions={targetOptions}
                                    usedTargets={usedTargets}
                                    matchStatus={matchStatus}
                                    onSelect={handleSelect}
                                />
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="flex justify-end gap-4">
                <button onClick={onCancel} className="text-gray-600 hover:text-gray-900 px-4">Back</button>
                <button onClick={handleProcess} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700">
                    Next
                </button>
            </div>

            {showConfirmModal && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-gray-900 bg-opacity-50 backdrop-blur-sm p-4">
                     <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md w-full">
                        <h3 className="text-xl font-bold mb-3 text-gray-900">Ignore unmapped columns?</h3>
                        <p className="text-sm text-gray-600 mb-4">
                            The following columns contain data but are not mapped and will be ignored:
                        </p>
                        <div className="max-h-40 overflow-y-auto mb-6 bg-gray-50 p-3 rounded border text-sm text-gray-700">
                            <ul className="list-disc pl-5 space-y-1">
                                {unmappedHeaders.map((h, i) => <li key={i}>{h}</li>)}
                            </ul>
                        </div>
                        <div className="flex justify-end gap-3">
                             <button onClick={() => setShowConfirmModal(false)} className="px-5 py-2.5 rounded-lg font-medium text-gray-700 bg-gray-100 hover:bg-gray-200">
                                 Cancel
                             </button>
                             <button onClick={confirmProcess} className="px-5 py-2.5 rounded-lg font-bold text-white bg-blue-600 hover:bg-blue-700">
                                 Continue
                             </button>
                        </div>
                     </div>
                </div>
            )}

            <ConfirmModal
                isOpen={showAutoMapConfirm}
                onClose={() => setShowAutoMapConfirm(false)}
                onConfirm={handleAutoMap}
                title="Try to auto-map Fields"
                message="This will try to automatically map columns to Planday fields with high confidence. You will still need to review the matches to ensure they are correct."
                confirmText="Try Auto-map"
                cancelText="Cancel"
            />
         </div>
    );
};


const formatDateToText = (isoDate: string) => {
    if (!isoDate) return "";
    const [y, m, d] = isoDate.split('-');
    if (!y || !m || !d) return isoDate;
    const date = new Date(Date.UTC(parseInt(y), parseInt(m) - 1, parseInt(d)));
    return `${parseInt(d)}. ${date.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${y}`;
};

const DateConversionReport: React.FC<{ report: DateLogItem[]; isUSFormat: boolean }> = ({ report, isUSFormat }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    return (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6 transition-all">
            <div className="flex items-start gap-4">
                <CalendarIcon className="w-6 h-6 text-yellow-600 mt-1" />
                <div className="flex-1">
                    <div 
                        className="flex justify-between items-center cursor-pointer select-none" 
                        onClick={() => setIsExpanded(!isExpanded)}
                    >
                        <h3 className="text-lg font-bold text-gray-800">
                            Date Format Detected: {isUSFormat ? 'US Format (MM/DD/YYYY)' : 'Standard/EU Format (DD/MM/YYYY)'}
                        </h3>
                        <button className="text-yellow-700 hover:text-yellow-800 font-medium text-sm">
                            {isExpanded ? 'Hide Details' : 'Read more'}
                        </button>
                    </div>
                    {isExpanded && (
                        <div className="mt-4 border-t border-yellow-200 pt-4 animate-in fade-in slide-in-from-top-2 duration-200">
                            <p className="text-sm text-gray-600 mb-4">
                                The app scanned the uploaded file and detected the above date format. 
                                All dates in the file have been processed accordingly. 
                                Below is a log of how dates were read and what payload will be sent to Planday (YYYY-MM-DD).
                            </p>
                            <div className="bg-white border rounded max-h-40 overflow-y-auto text-xs">
                                <table className="w-full text-left">
                                    <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                            <th className="p-2 border-b">Row</th>
                                            <th className="p-2 border-b">Field</th>
                                            <th className="p-2 border-b">Original Input</th>
                                            <th className="p-2 border-b">Payload (YYYY-MM-DD)</th>
                                            <th className="p-2 border-b">Text Date</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {report.map((item, idx) => (
                                            <tr key={idx} className="border-b last:border-0 hover:bg-gray-50">
                                                <td className="p-2">{item.rowNum}</td>
                                                <td className="p-2">{item.field}</td>
                                                <td className="p-2 font-mono text-gray-500">{item.original}</td>
                                                <td className="p-2 font-mono font-bold text-blue-600">{item.payload}</td>
                                                <td className="p-2 font-medium text-gray-700">{formatDateToText(item.payload)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

interface AmbiguousDateItem {
    id: string;
    rowNum: number;
    empName: string;
    field: string;
    input: string;
    year2Digit: number;
    suggestion1900: number;
    suggestion2000: number;
    selectedCentury: 1900 | 2000;
}

const DateAmbiguityResolver: React.FC<{ 
    items: AmbiguousDateItem[]; 
    onUpdate: (id: string, century: 1900 | 2000) => void;
    onContinue: () => void;
    onBack: () => void;
}> = ({ items, onUpdate, onContinue, onBack }) => {
    return (
        <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100">
            <div className="flex items-center gap-3 mb-6">
                <div className="bg-yellow-100 p-2 rounded-full">
                    <AlertIcon className="w-6 h-6 text-yellow-600" />
                </div>
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Ambiguous Dates Detected</h2>
                    <div className="text-gray-500 text-sm mt-2 space-y-2">
                        <p>Some dates were entered with 2-digit years. The app has applied the following rules to guess the century:</p>
                        <ul className="list-disc list-inside ml-2">
                            <li><strong>Birth dates:</strong> Years greater than the current year ({CURRENT_TWO_DIGIT_YEAR}) default to 1900s, otherwise 2000s.</li>
                            <li><strong>Other dates:</strong> Years greater than 50 default to 1900s, otherwise 2000s (window 1951-2050).</li>
                        </ul>
                        <p className="font-medium text-gray-700 mt-2">Please review and confirm if they belong to the 20th or 21st century below, or correct your file to use full 4-digit years (YYYY) and re-upload.</p>
                    </div>
                </div>
            </div>

            <div className="border rounded-lg overflow-hidden mb-8">
                <div className="max-h-[500px] overflow-y-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-gray-50 sticky top-0 border-b">
                            <tr>
                                <th className="p-3 font-semibold text-gray-700">Row</th>
                                <th className="p-3 font-semibold text-gray-700">Employee</th>
                                <th className="p-3 font-semibold text-gray-700">Field</th>
                                <th className="p-3 font-semibold text-gray-700">Input</th>
                                <th className="p-3 font-semibold text-gray-700 text-center">Correct Year</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {items.map((item) => (
                                <tr key={item.id} className="hover:bg-gray-50">
                                    <td className="p-3 text-gray-500">{item.rowNum}</td>
                                    <td className="p-3 font-medium text-gray-900">{item.empName}</td>
                                    <td className="p-3 text-gray-600">{item.field}</td>
                                    <td className="p-3 font-mono text-gray-600">{item.input}</td>
                                    <td className="p-3">
                                        <div className="flex justify-center gap-2">
                                            <button 
                                                onClick={() => onUpdate(item.id, 1900)}
                                                className={`px-3 py-1.5 rounded border text-xs font-semibold transition-colors ${item.selectedCentury === 1900 ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                                            >
                                                {item.suggestion1900}
                                            </button>
                                            <button 
                                                onClick={() => onUpdate(item.id, 2000)}
                                                className={`px-3 py-1.5 rounded border text-xs font-semibold transition-colors ${item.selectedCentury === 2000 ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                                            >
                                                {item.suggestion2000}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="flex justify-end gap-4">
                <button onClick={onBack} className="text-gray-600 hover:text-gray-900 px-4">Back</button>
                <button onClick={onContinue} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700 flex items-center gap-2">
                    Confirm & Continue
                </button>
            </div>
        </div>
    );
};


type AppStep = 'auth' | 'configure' | 'select_fields' | 'generate_template' | 'upload' | 'identity_method' | 'map_employees' | 'map_fields' | 'validation_errors' | 'resolve_dates' | 'review' | 'processing' | 'summary';

const STEP_CONFIG = {
    labels: [
        { title: 'Authentication', subtitle: 'Connect to Planday' },
        { title: 'Configure', subtitle: 'Update method' },
        { title: 'Upload', subtitle: 'Upload Excel file' },
        { title: 'Review', subtitle: 'Check & Edit' },
        { title: 'Update Process', subtitle: 'Updating employees' },
        { title: 'Results', subtitle: 'View results' },
    ]
};

const getStepIndex = (step: AppStep) => {
    switch(step) {
        case 'auth': return 0;
        case 'configure': 
        case 'select_fields': 
        case 'generate_template': return 1;
        case 'upload': 
        case 'identity_method':
        case 'map_employees': 
        case 'map_fields':
        case 'validation_errors':
        case 'resolve_dates':
            return 2;
        case 'review': return 3;
        case 'processing': return 4;
        case 'summary': return 5;
        default: return 0;
    }
}

interface DateLogItem {
    rowNum: number;
    field: string;
    original: string;
    payload: string;
}

const getNonEmptyHeaders = (json: any[]) => {
    if (!json || json.length === 0) return [];
    const headers = Object.keys(json[0]);
    return headers.filter(h => {
        return json.some(row => {
            const val = row[h];
            return val !== undefined && val !== null && String(val).trim() !== '';
        });
    });
};

const MultiSelectMenu = ({ label, options, selectedIds, onChange, toggleOptionLabel, toggleOptionEnabled, onToggleOption, toggleTooltipText }: { 
    label: string, 
    options: {id: number, name: string}[], 
    selectedIds: number[], 
    onChange: (ids: number[]) => void,
    toggleOptionLabel?: string,
    toggleOptionEnabled?: boolean,
    onToggleOption?: (enabled: boolean) => void,
    toggleTooltipText?: React.ReactNode
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    
    // Close on click outside
    const menuRef = React.useRef<HTMLDivElement>(null);
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setSearchTerm('');
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const isAllSelected = selectedIds.length === 0 || selectedIds.length === options.length;
    const isNoneSelected = selectedIds.length === 1 && selectedIds[0] === -1;
    const filteredOptions = options.filter(opt => opt.name.toLowerCase().includes(searchTerm.toLowerCase()));
    const isAllSearchFilteredSelected = filteredOptions.length > 0 && filteredOptions.every(opt => isAllSelected || selectedIds.includes(opt.id));

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            onChange([]);
        } else {
            onChange([-1]);
        }
    };

    const handleSelectAllSearch = (checked: boolean) => {
        if (checked) {
            let newSelected = isAllSelected ? [...options.map(o => o.id)] : [...selectedIds];
            if (!isAllSelected) {
                filteredOptions.forEach(opt => {
                    if (!newSelected.includes(opt.id)) {
                        newSelected.push(opt.id);
                    }
                });
                if (newSelected.length === options.length) {
                    onChange([]);
                } else {
                    onChange(newSelected);
                }
            }
        } else {
            let newSelected = isAllSelected ? [...options.map(o => o.id)] : [...selectedIds];
            const filteredIds = filteredOptions.map(o => o.id);
            newSelected = newSelected.filter(id => !filteredIds.includes(id));
            if (newSelected.length === 0) {
                onChange([-1]);
            } else {
                onChange(newSelected);
            }
        }
    };

    const handleOptionToggle = (optId: number, checked: boolean) => {
        if (isAllSelected) {
            if (!checked) {
                onChange(options.filter(o => o.id !== optId).map(o => o.id));
            }
        } else if (isNoneSelected) {
            if (checked) {
                onChange([optId]);
            }
        } else {
            if (checked) {
                const next = [...selectedIds, optId];
                if (next.length === options.length) {
                    onChange([]);
                } else {
                    onChange(next);
                }
            } else {
                const next = selectedIds.filter(id => id !== optId);
                if (next.length === 0) {
                    onChange([-1]);
                } else {
                    onChange(next);
                }
            }
        }
    };
    
    return (
        <div className="flex-1 min-w-[200px] relative" ref={menuRef}>
            <div className="flex justify-between items-center mb-1">
                <label className="block text-xs font-semibold text-gray-500 uppercase">{toggleOptionEnabled && toggleOptionLabel ? toggleOptionLabel : label}</label>
                {onToggleOption && (
                    <div className="flex items-center gap-2">
                        {toggleTooltipText && (
                            <div className="group relative flex items-center">
                                <InfoIcon className="w-3.5 h-3.5 cursor-help transition-colors text-orange-500" />
                                <div className="absolute right-0 bottom-full mb-2 w-64 bg-gray-900 text-white text-xs rounded p-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 normal-case font-normal shadow-lg">
                                    {toggleTooltipText}
                                </div>
                            </div>
                        )}
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                                type="checkbox" 
                                className="sr-only peer" 
                                checked={!!toggleOptionEnabled}
                                onChange={(e) => onToggleOption(e.target.checked)}
                            />
                            <div className="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-orange-500"></div>
                        </label>
                    </div>
                )}
            </div>
            <button 
                type="button"
                className="w-full text-left text-sm border border-gray-300 bg-white rounded-md shadow-sm px-3 py-2 flex items-center justify-between focus:ring-blue-500 focus:border-blue-500 hover:bg-gray-50"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="truncate text-gray-700">
                    {isAllSelected 
                        ? `All ${label === 'Department' ? (toggleOptionEnabled ? 'Primary Departments' : 'Departments') : (label.endsWith('s') ? label : label + 's')}` 
                        : `${isNoneSelected ? 0 : selectedIds.length} selected`}
                </div>
                <span className="text-gray-400 ml-2">▼</span>
            </button>
            
            {isOpen && (
                <div className="absolute z-[100] mt-1 w-full flex flex-col bg-white border border-gray-200 rounded-md shadow-lg">
                    <div className="p-2 border-b border-gray-100">
                        <input
                            type="text"
                            placeholder="Search..."
                            className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 outline-none"
                            value={searchTerm}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                        {searchTerm.length === 0 && (
                            <label className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-50 font-medium">
                                <input 
                                    type="checkbox" 
                                    className="text-blue-600 rounded bg-white border-gray-300 focus:ring-blue-500" 
                                    checked={isAllSelected}
                                    onChange={(e) => handleSelectAll(e.target.checked)}
                                />
                                <span className="text-sm text-gray-700 truncate">All</span>
                            </label>
                        )}
                        {searchTerm.length > 0 && (
                            <label className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-50 font-medium">
                                <input 
                                    type="checkbox" 
                                    className="text-blue-600 rounded bg-white border-gray-300 focus:ring-blue-500" 
                                    checked={isAllSearchFilteredSelected}
                                    onChange={(e) => handleSelectAllSearch(e.target.checked)}
                                />
                                <span className="text-sm text-gray-700 truncate">Select all</span>
                            </label>
                        )}
                        {filteredOptions.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-gray-500 italic text-center">No results found</div>
                        ) : (
                            filteredOptions.map(opt => {
                                const isChecked = isAllSelected || selectedIds.includes(opt.id);
                                return (
                                    <label key={opt.id} className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 cursor-pointer">
                                        <input 
                                            type="checkbox" 
                                            className="text-blue-600 rounded bg-white border-gray-300 focus:ring-blue-500" 
                                            checked={isChecked}
                                            onChange={(e) => handleOptionToggle(opt.id, e.target.checked)}
                                        />
                                        <span className="text-sm text-gray-700 truncate">{opt.name}</span>
                                    </label>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const ResizableHeader: React.FC<{ title: string, defaultWidth: number, isLeft?: boolean, checkbox?: React.ReactNode, info?: { type: string, description: string, guidance: string, required?: boolean } | null, bgColor?: string, onDelete?: () => void, minWidth?: number, extraActions?: React.ReactNode, isMissing?: boolean, onRemapClick?: () => void }> = ({ title, defaultWidth, isLeft, checkbox, info, bgColor, onDelete, minWidth, extraActions, isMissing, onRemapClick }) => {
    const [w, setW] = useState(defaultWidth);
    const [hasResized, setHasResized] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const iconRef = useRef<SVGSVGElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const thRef = useRef<HTMLTableCellElement>(null);
    const titleRef = useRef<HTMLSpanElement>(null);
    
    useEffect(() => {
        // Calculate the ideal width based on the contents
        if (!hasResized && contentRef.current && titleRef.current) {
            // Padding (24px for p-3), gap-2 (8px), icon size, close buttons, etc.
            // We can just use the title's scrollWidth + some padding/gap allowance
            // Instead of guessing, let's look at how much the title overflowed its layout width
            const titleTargetWidth = titleRef.current.scrollWidth;
            const titleActualWidth = titleRef.current.getBoundingClientRect().width;
            
            if (titleTargetWidth > titleActualWidth + 1) { // 1px threshold
                const diff = titleTargetWidth - titleActualWidth;
                setW(prev => prev + diff + 15); // add 15px breathing room
            }
        }
    }, [title, extraActions, hasResized]);
    
    const startDrag = (e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = thRef.current ? thRef.current.getBoundingClientRect().width : w;
        setHasResized(true);
        
        let minAllowed = minWidth || 60;
        if (isLeft && contentRef.current) {
            minAllowed = Math.max(minAllowed, contentRef.current.scrollWidth);
        }
        
        const onMouseMove = (moveEvent: MouseEvent) => {
            requestAnimationFrame(() => {
                const newWidth = Math.max(minAllowed, startWidth + moveEvent.clientX - startX);
                setW(newWidth);
            });
        };
        
        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = 'default';
        };
        
        document.body.style.cursor = 'col-resize';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    const isRequired = info?.required === true;
    const titleColorClass = isRequired ? "text-red-800" : "text-gray-800";

    const renderTooltip = () => {
        if (!info || !iconRef.current || !isHovered) return null;
        
        const rect = iconRef.current.getBoundingClientRect();
        
        return createPortal(
            <div 
                className="fixed w-48 p-2 bg-gray-800 text-white text-xs rounded shadow-lg z-[9999] whitespace-normal text-left font-normal border border-gray-700 pointer-events-none"
                style={{
                    left: rect.left + rect.width / 2,
                    top: rect.bottom + 8,
                    transform: 'translateX(-50%)'
                }}
            >
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-gray-800"></div>
                <p className="font-bold mb-1 border-b border-gray-600 pb-1">{info.description} <span className="text-gray-300 font-normal">({info.type})</span></p>
                <p>{info.guidance}</p>
                {isRequired && (
                    <p className="text-red-400 mt-2">* Currently set as REQUIRED in the portal employee form settings</p>
                )}
            </div>,
            document.body
        );
    };

    return (
        <th 
            ref={thRef}
            className={`${bgColor || 'bg-gray-200'} border-x border-gray-300 p-0 relative sticky top-0 align-top group/header ${isLeft ? 'z-20 hover:z-40 left-0 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]' : 'z-10 hover:z-40'}`}
            style={{ 
                width: `${w}px`, 
                minWidth: `${w}px`, 
                maxWidth: `${w}px` 
            }}
        >
            <div ref={contentRef} className="p-3 h-full flex items-center overflow-visible w-full relative gap-2">
                {checkbox}
                {isLeft ? (
                    <span ref={titleRef} className={`whitespace-nowrap font-semibold select-none flex-shrink-0 ${titleColorClass}`}>{title}</span>
                ) : (
                    isMissing ? (
                        <div 
                            className="flex flex-col items-start cursor-pointer group"
                            onClick={onRemapClick}
                        >
                            <span ref={titleRef} className={`whitespace-nowrap font-semibold overflow-hidden text-ellipsis max-w-full text-red-600 group-hover:text-red-800 underline decoration-red-400 decoration-dashed underline-offset-4 title-remap-btn`} title="Field missing in Planday. Click to remap.">{title}</span>
                            <span className="text-[10px] text-red-500 uppercase font-bold tracking-wider pt-1">Missing in portal - Click to remap</span>
                        </div>
                    ) : (
                        <span ref={titleRef} className={`whitespace-nowrap font-semibold select-none overflow-hidden text-ellipsis max-w-full flex-1 ${titleColorClass}`}>{title}</span>
                    )
                )}
                {info && (
                    <div className="relative inline-block flex-shrink-0" onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
                        <svg ref={iconRef} className="w-4 h-4 text-gray-500 hover:text-blue-600 cursor-help" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                            <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        {renderTooltip()}
                    </div>
                )}
                {extraActions}
                {onDelete && (
                    <div 
                        className="text-gray-400 hover:text-red-600 bg-white/50 hover:bg-white rounded p-0.5 cursor-pointer ml-1 flex-shrink-0 transition-colors"
                        onClick={onDelete}
                        title="Remove column"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" strokeWidth="2.5" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </div>
                )}
            </div>
            <div 
                className="absolute right-0 top-0 w-3 -mr-1.5 h-full flex flex-col justify-center items-center cursor-col-resize z-50 group-hover/header:bg-blue-400 opacity-100 transition-colors"
                onMouseDown={startDrag}
            >
                <div className="w-px h-4 bg-gray-400 group-hover/header:bg-white border-none pointer-events-none" />
                <div className="w-px h-4 bg-gray-400 group-hover/header:bg-white border-none pointer-events-none mt-1" />
            </div>
        </th>
    );
};

const getFieldConfig = (colName: string, defs: DefinitionCollection | null): { type: string, description: string, guidance: string, options?: string[], required?: boolean } | null => {
    if (!defs) return null;
    const lowerName = colName.trim().toLowerCase();
    const isReq = (key: string) => defs.requiredFields?.includes(key) ? true : false;

    // System fields
    if (lowerName === "salary identifier (payroll id)") return { type: "Text", description: "Payroll ID", guidance: "Do not edit. Used for identification." };
    if (lowerName === "email") return { type: "Text (Email)", description: "Email Address", guidance: "Email is used as Username. Updates trigger verification email.", required: isReq("email") };
    if (lowerName.includes("birth date")) return { type: "Date", description: "Birth Date", guidance: "Date must be in YYYY-MM-DD format, when editing in the table.", required: isReq("birthDate") };
    if (lowerName === "gender") return { type: "Dropdown", description: "Gender", guidance: "Male or Female", options: ["Male", "Female"], required: isReq("gender") };
    if (lowerName === "tax id") return { type: "Text", description: "SSN / Tax ID", guidance: "Social Security Number or Tax ID", required: isReq("ssn") };
    if (lowerName === "street 1") return { type: "Text", description: "Address Line 1", guidance: "Street Address", required: isReq("street1") };
    if (lowerName === "street 2") return { type: "Text", description: "Address Line 2", guidance: "Apt, Suite, Unit, etc.", required: isReq("street2") };
    if (lowerName === "zip") return { type: "Text", description: "Postal Code", guidance: "Zip / Postal Code", required: isReq("zip") };
    if (lowerName === "city") return { type: "Text", description: "City", guidance: "City", required: isReq("city") };
    if (lowerName === "country code") return { type: "Text", description: "Mobile Country Code", guidance: "Options: DK, UK, NO, SE, DE, US, PL, VN, FR, ES, GL, IT, NL, CH, BE, Etc.", required: isReq("cellPhoneCountryCode") };
    if (lowerName === "mobile") return { type: "Text", description: "Mobile Number", guidance: "e.g., 12345678 (digits only, no country code prefix). Do not input +45, etc.). Country code is set via the field \"Country Code\".", required: isReq("cellPhone") };
    if (lowerName.includes("start/hired date")) return { type: "Date", description: "Hired Date", guidance: "Date must be in YYYY-MM-DD format, when editing in the table.", required: isReq("hiredFrom") };
    if (lowerName === "job title" || lowerName === "jobtitle") return { type: "Text", description: "Job Title", guidance: "Job Title", required: isReq("jobTitle") };
    if (lowerName === "employee type") return { type: "Dropdown", description: "Employee Type", guidance: `Options: ${defs.employeeTypes.map(t => t.name).join(', ')}`, options: defs.employeeTypes.map(t => t.name), required: isReq("employeeTypeId") };
    if (lowerName === "system bank reg") return { type: "Text", description: "Bank Registration No.", guidance: "Bank Registration Number" };
    if (lowerName === "system bank account nr") return { type: "Text", description: "Bank Account No.", guidance: "Bank Account Number" };

    // Contract Rule
    if (lowerName === "contract rule") return { type: "Dropdown", description: "Contract Rule", guidance: `Options: ${defs.contractRules.map(r => r.name).join(', ')}. Enter REMOVE to unassign.`, options: [...defs.contractRules.map(r => r.name), "REMOVE"] };

    // Supervisors
    if (lowerName === "assign supervisor") return { type: "Dropdown", description: "Assigned Supervisor", guidance: defs.supervisors.length > 0 ? `Options: ${defs.supervisors.map(s => s.name).join(', ')}. Enter REMOVE to unassign.` : "No supervisors available in the portal.", options: [...defs.supervisors.map(s => s.name), "REMOVE"] };
    if (lowerName === "is supervisor" || lowerName === "is supervisor (x)") return { type: "Checkbox", description: "Is Supervisor Status", guidance: "X to assign. REMOVE to unassign. Leave empty to skip. Please check this field is enabled in your portal before filling out.", options: ["X", "REMOVE"] };

    // Skills
    if (lowerName.startsWith("skill - ")) return { type: "Checkbox", description: `Skill Assignment`, guidance: `X to assign. REMOVE to unassign. Leave empty to skip.`, options: ["X", "REMOVE"] };
    
    // Departments
    if (lowerName.startsWith("department - ")) return { type: "Dropdown", description: `Department Membership`, guidance: `x = member, xx = primary. Enter REMOVE to unassign.`, options: ["x", "xx", "REMOVE"] };
    
    // Salaries
    if (lowerName === "fixed salary - period") return { type: "Dropdown", description: "Salary Period", guidance: `Options: Monthly, Fortnightly, Weekly, Annual, FourWeekly. Remember to fill out the other required fields when updating Fixed Salary: Amount and Expected working hours.`, options: ["Monthly", "Fortnightly", "Weekly", "Annual", "FourWeekly"] };
    if (lowerName.includes("expected working hours")) return { type: "Numeric", description: "Salary Hours", guidance: "e.g., 160 for monthly, 37.5 or 37,5 for weekly. Both . and , accepted as decimal separator. Remember to fill out the other required fields when updating Fixed Salary: Period and Amount." };
    if (lowerName === "fixed salary - amount") return { type: "Numeric", description: "Salary Amount", guidance: "e.g., 30000 or 30000,50 (numeric value, no currency symbol). Both . and , accepted as decimal separator. Remember to fill out the other required fields when updating Fixed Salary: Period and Expected working hours." };
    if (lowerName === "fixed salary - salary code") return { type: "Text", description: "Salary Code", guidance: "Only input a personal salary code, if the code should differ from the general salary code. If in doubt, leave it blank." };
    if (lowerName.includes("fixed salary") && lowerName.includes("valid from")) return { type: "Date", description: "Salary Valid From", guidance: "Date must be in YYYY-MM-DD format, when editing in the table. If left blank, and rate is inputted, then the rate will be assigned from today’s date." };

    // Groups / Wages
    if (lowerName.startsWith("group rate - ") && !lowerName.includes("wage type") && !lowerName.includes("valid from") && !lowerName.includes("salary code")) return { type: "Numeric", description: "Group Rate Amount", guidance: "X or 0 = assign without rate, or enter hourly rate (e.g., 15.50 or 15,50). Both . and , accepted. Leave empty to skip. Remember that Wage Type is required to be filled out when updating rates." };
    if (lowerName.startsWith("group wage type - ")) return { type: "Dropdown", description: "Group Wage Type", guidance: "HourlyRate or ShiftRate. Input HourlyRate to assign the employee group with an hourly rate; input ShiftRate if the employee is paid a fixed amount per shift.", options: ["HourlyRate", "ShiftRate"] };
    if (lowerName.startsWith("group valid from - ")) return { type: "Date", description: "Group Valid From", guidance: "Date must be in YYYY-MM-DD format, when editing in the table. If left blank, and rate is inputted, then the rate will be assigned from today’s date." };
    if (lowerName.startsWith("group salary code - ")) return { type: "Text", description: "Group Salary Code", guidance: "Only input a personal salary code, if the code should differ from the general or employee group salary code. If in doubt, leave it blank." };

    // Custom fields
    const customDef = defs.customFields.find(f => f.description.toLowerCase() === lowerName);
    if (customDef) {
        let guidance = "";
        let options: string[] | undefined = undefined;
        let pType: string = customDef.type;
        if (pType === 'Boolean') { 
            guidance = "X to assign. REMOVE to unassign. Leave empty to skip."; 
            pType = 'Checkbox'; 
            options = ["X", "REMOVE"];
        }
        else if (pType === 'Numeric') guidance = "Enter a numeric value.";
        else if (pType === 'Dropdown') {
            options = customDef.dropdownOptions || [];
            guidance = options.length > 0 ? "Enter one of the following options: " + options.join(', ') : "Enter an available option from the list.";
        }
        else if (pType === 'Text') guidance = "Accepts text form input.";
        else if (pType === 'Date') guidance = "Date must be in YYYY-MM-DD format, when editing in the table.";
        else {
            guidance = `Type: ${pType}.`;
            if (customDef.dropdownOptions) guidance += ` Options: ${customDef.dropdownOptions.join(', ')}`;
        }
        return { type: pType, description: customDef.description, guidance, options, required: isReq(customDef.originalName) };
    }

    return { type: "Text", description: colName, guidance: "" };
};

const EditableCell = React.memo(({
    isSelect,
    options,
    initialValue,
    isFormatError,
    errorMessage,
    employeeId,
    col,
    isDate,
    originalIdx,
    ambiguousDates,
    detectedUSFormat,
    onCellEdit,
    onCellFocus,
    onCellBlur,
    setFocusedCol
}: {
    isSelect: boolean;
    options?: string[];
    initialValue: string;
    isFormatError: boolean;
    errorMessage?: string;
    employeeId: number;
    col: string;
    isDate: boolean;
    originalIdx: number;
    ambiguousDates: any[];
    detectedUSFormat: boolean;
    onCellEdit: (id: number, col: string, val: string) => void;
    onCellFocus: (id: number, col: string) => void;
    onCellBlur: (id: number, col: string) => void;
    setFocusedCol: (col: string | null) => void;
}) => {
    const [draftValue, setDraftValue] = useState(initialValue);
    const [isHovered, setIsHovered] = useState(false);
    const cellRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isSelect && options && initialValue) {
            const match = options.find(o => o.toLowerCase() === String(initialValue).toLowerCase());
            setDraftValue(match !== undefined ? match : initialValue);
        } else {
            setDraftValue(initialValue);
        }
    }, [initialValue, isSelect, options]);

    const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFocusedCol(null);
        onCellBlur(employeeId, col);
        
        let finalVal = draftValue;
        if (isDate) {
            const val = finalVal.trim();
            if (val) {
                const correctionKey = `${originalIdx}-${col}`;
                const ambiguousMatch = ambiguousDates.find(a => a.id === correctionKey);
                const correctedYear = ambiguousMatch ? ambiguousMatch.selectedCentury + ambiguousMatch.year2Digit : undefined;
                const parsed = parseDateWithFormat(val, detectedUSFormat, correctedYear);
                if (parsed && parsed !== val) {
                    finalVal = parsed;
                }
            }
        }
        
        if (finalVal !== initialValue) {
            onCellEdit(employeeId, col, finalVal);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        }
    };

    const renderTooltip = () => {
        if (!isFormatError || !isHovered || !cellRef.current) return null;
        
        const rect = cellRef.current.getBoundingClientRect();
        
        return createPortal(
            <div 
                className="fixed w-48 p-2 bg-red-800 text-white text-xs rounded shadow-lg z-[9999] whitespace-normal text-center pointer-events-none"
                style={{
                    left: rect.left + rect.width / 2,
                    top: rect.top - 4,
                    transform: 'translate(-50%, -100%)'
                }}
            >
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-red-800"></div>
                {errorMessage}
            </div>,
            document.body
        );
    };

    if (isSelect) {
        const isInvalidValue = draftValue && options && !options.some(o => o.toLowerCase() === String(draftValue).toLowerCase());

        return (
            <div className="relative group/cell" ref={cellRef} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
                <select
                    className={`w-full min-w-[100px] bg-white border ${isFormatError ? 'border-red-600 bg-red-100 focus:ring-red-600 focus:border-red-600 outline-none ring-1 ring-red-600 text-red-900' : 'border-gray-300 shadow-sm hover:border-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500'} rounded px-3 py-1.5 transition-colors text-gray-900`}
                    value={draftValue}
                    onFocus={() => {
                        setFocusedCol(col);
                        onCellFocus(employeeId, col);
                    }}
                    onBlur={handleBlur}
                    onChange={(e) => setDraftValue(e.target.value)}
                >
                    <option value=""></option>
                    {isInvalidValue && <option value={draftValue} className="text-red-600 italic">Invalid: {draftValue}</option>}
                    {options?.map((opt: string) => (
                        <option key={opt} value={opt} className="text-gray-900 not-italic">{opt}</option>
                    ))}
                </select>
                {renderTooltip()}
            </div>
        );
    }

    return (
        <div className="relative group/cell" ref={cellRef} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
            <input 
                type="text" 
                className={`w-full min-w-[40px] bg-white border ${isFormatError ? 'border-red-600 bg-red-100 focus:ring-red-600 focus:border-red-600 outline-none ring-1 ring-red-600 text-red-900' : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500 hover:border-gray-400'} shadow-sm focus:outline-none focus:ring-1 rounded px-3 py-1.5 transition-colors text-gray-900`} 
                value={draftValue} 
                onChange={(e) => setDraftValue(e.target.value)} 
                onFocus={() => {
                    setFocusedCol(col);
                    onCellFocus(employeeId, col);
                }}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
            />
            {renderTooltip()}
        </div>
    );
});

const TableRow = React.memo(({ 
    review, 
    rowData, 
    originalIdx,
    getUpdateColumns, 
    dateColumns, 
    columnMeta, 
    ambiguousDates, 
    detectedUSFormat, 
    bulkEditField, 
    selected, 
    rowErrors,
    salaryIdentifier,
    onSelectRow, 
    onCellEdit,
    onCellFocus,
    onCellBlur
}: {
    review: EmployeeUpdateReview,
    rowData: any,
    originalIdx: number,
    getUpdateColumns: string[],
    dateColumns: Set<string>,
    columnMeta: Record<string, any>,
    ambiguousDates: any[],
    detectedUSFormat: boolean,
    bulkEditField: string,
    selected: boolean,
    rowErrors?: Record<string, string>,
    salaryIdentifier?: string | null,
    onSelectRow: (id: number, checked: boolean) => void,
    onCellEdit: (id: number, col: string, val: string) => void,
    onCellFocus: (id: number, col: string) => void,
    onCellBlur: (id: number, col: string) => void
}) => {
    const [focusedCol, setFocusedCol] = useState<string | null>(null);

    const pendingCount = getUpdateColumns.filter(col => {
        const rawVal = rowData[col];
        return rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== "";
    }).length;

    return (
        <tr className="border-t hover:bg-gray-200 transition-colors">
            <td className="p-3 bg-gray-50 flex-none sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] border-r border-gray-200">
                <div className="flex items-center justify-between w-full h-full gap-4">
                    <div className="flex items-center gap-2 min-w-0">
                        <input 
                            type="checkbox" 
                            className="rounded text-blue-600 focus:ring-blue-500 bg-white border-gray-300 min-w-[16px]"
                            checked={selected}
                            onChange={e => onSelectRow(review.employeeId, e.target.checked)}
                        />
                        <div className="flex flex-col min-w-0">
                            <span className="font-medium truncate text-gray-800" title={review.employeeName}>{review.employeeName}</span>
                            {salaryIdentifier && <span className="text-xs text-gray-500 truncate">SID: {salaryIdentifier}</span>}
                        </div>
                    </div>
                    <div className="shrink-0 flex items-center justify-end whitespace-nowrap">
                        {review.status === 'success' && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">Success</span>}
                        {review.status === 'error' && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-800" title={review.resultMessage}>Error</span>}
                        {review.status === 'partial' && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-800" title={review.resultMessage}>Partial</span>}
                        {review.status === 'no_updates' ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-500 whitespace-nowrap">No updates</span>
                        ) : (!review.status || review.status === 'pending') ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-600 whitespace-nowrap">Updates pending: {pendingCount}</span>
                        ) : null}
                    </div>
                </div>
            </td>
            {getUpdateColumns.map(col => {
                const isDate = dateColumns.has(col);
                const rawVal = rowData[col] !== undefined && rowData[col] !== null ? rowData[col] : "";
                let displayVal = String(rawVal);
                
                if (isDate && rawVal && originalIdx >= 0 && focusedCol !== col) {
                    const correctionKey = `${originalIdx}-${col}`;
                    const ambiguousMatch = ambiguousDates.find(a => a.id === correctionKey);
                    const correctedYear = ambiguousMatch ? ambiguousMatch.selectedCentury + ambiguousMatch.year2Digit : undefined;
                    const parsed = parseDateWithFormat(rawVal, detectedUSFormat, correctedYear);
                    if (parsed) displayVal = parsed;
                }

                const colInfo = columnMeta[col] || { config: null, bgColor: 'bg-[#dee6f0]' };
                const options = colInfo.config?.options;
                
                const isDateFormatError = isDate && focusedCol !== col && displayVal && !/^\d{4}-\d{2}-\d{2}$/.test(displayVal);
                const serverValidationError = focusedCol !== col ? rowErrors?.[col] : undefined;
                const isFormatError = isDateFormatError || !!serverValidationError;
                const errorMessage = isDateFormatError ? "Must be in the format YYYY-MM-DD" : serverValidationError;

                return (
                    <td key={col} className={`p-2 border-x border-gray-200 ${colInfo.bgColor}`}>
                        <EditableCell
                            isSelect={!!options}
                            options={options}
                            initialValue={displayVal}
                            isFormatError={isFormatError}
                            errorMessage={errorMessage}
                            employeeId={review.employeeId}
                            col={col}
                            isDate={isDate}
                            originalIdx={originalIdx}
                            ambiguousDates={ambiguousDates}
                            detectedUSFormat={detectedUSFormat}
                            onCellEdit={onCellEdit}
                            onCellFocus={onCellFocus}
                            onCellBlur={onCellBlur}
                            setFocusedCol={setFocusedCol}
                        />
                    </td>
                );
            })}
            {getUpdateColumns.length === 0 && (
                <td className="p-8 border-x border-gray-200 bg-gray-50/20 text-gray-400 italic text-center w-full align-middle">
                    Please add fields to the update table using the dropdown selector at the top of the page.
                </td>
            )}
            {getUpdateColumns.length > 0 && <td className="w-full bg-white"></td>}
        </tr>
    );
});

const App: React.FC = () => {
    const [currentStep, setCurrentStep] = useState<AppStep>('auth');
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingText, setLoadingText] = useState('');
    const [progress, setProgress] = useState(0); 
    const [totalItems, setTotalItems] = useState(0);
    const [completedCount, setCompletedCount] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [generatedWorkbook, setGeneratedWorkbook] = useState<XLSX.WorkBook | null>(null);
    const [updateMethod, setUpdateMethod] = useState<'excel' | 'editor'>('excel');
    const [showEditorEditorInstructions, setShowEditorEditorInstructions] = useState(false);
    const [portalName, setPortalName] = useState<string | null>(null);
    const [showHelpModal, setShowHelpModal] = useState(false);
    
    // Stop process references
    const abortProcessRef = useRef(false);
    const [isStopModalOpen, setIsStopModalOpen] = useState(false);

    const [definitions, setDefinitions] = useState<DefinitionCollection | null>(null);
    // Add allEmployees state to cache fetching for mapping
    const [allEmployees, setAllEmployees] = useState<Employee[]>([]);

    const [selectedSections, setSelectedSections] = useState({
        system: true,
        departments: false,
        custom: false,
        wages: false,
        salary: false,
        contract: false,
        skills: false,
        supervisor: false
    });
    
    // New states for specific field selection
    const [selectedSystemFields, setSelectedSystemFields] = useState<Set<string>>(new Set());
    const [selectedCustomFields, setSelectedCustomFields] = useState<Set<string>>(new Set());
    const [selectedDepartments, setSelectedDepartments] = useState<Set<number>>(new Set());
    const [selectedWages, setSelectedWages] = useState<Set<number>>(new Set());
    const [selectedSkills, setSelectedSkills] = useState<Set<number>>(new Set());
    
    const [populateData, setPopulateData] = useState(false);

    const [rawFileJson, setRawFileJson] = useState<any[] | null>(null);
    const [ambiguousDates, setAmbiguousDates] = useState<AmbiguousDateItem[]>([]);
    const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
    const [validationSource, setValidationSource] = useState<'upload' | 'review'>('upload');

    const [reviews, setReviews] = useState<EmployeeUpdateReview[]>([]);
    
    const [dateReport, setDateReport] = useState<DateLogItem[]>([]);
    const [detectedUSFormat, setDetectedUSFormat] = useState(false);

    // Review step filters
    const [searchReview, setSearchReview] = useState('');
    const [filterDepartment, setFilterDepartment] = useState<number[]>([]);
    const [filterPrimaryDepartment, setFilterPrimaryDepartment] = useState(false);
    const [filterGroup, setFilterGroup] = useState<number[]>([]);
    const [filterType, setFilterType] = useState<number[]>([]);
    const [showOnlyIssues, setShowOnlyIssues] = useState(false);

    // Export step filters
    const [exportFilterDepartment, setExportFilterDepartment] = useState<number[]>([]);
    const [exportFilterPrimaryDepartment, setExportFilterPrimaryDepartment] = useState(false);
    const [exportFilterGroup, setExportFilterGroup] = useState<number[]>([]);
    const [exportFilterType, setExportFilterType] = useState<number[]>([]);

    const [bulkEditField, setBulkEditField] = useState('');
    const [columnToDelete, setColumnToDelete] = useState<string | null>(null);
    const [showClearTableConfirm, setShowClearTableConfirm] = useState(false);
    const [showRemoveSelectedConfirm, setShowRemoveSelectedConfirm] = useState(false);
    const [bulkEditValue, setBulkEditValue] = useState('');
    const [selectedReviewIds, setSelectedReviewIds] = useState<Set<number>>(new Set());
    const [addFieldKey, setAddFieldKey] = useState('');
    const [explicitAddedCols, setExplicitAddedCols] = useState<Set<string>>(new Set());
    const [columnToRemap, setColumnToRemap] = useState<string | null>(null);
    
    // Live update tracking & Abort
    const [liveStats, setLiveStats] = useState({ success: 0, partial: 0, error: 0, aborted: 0 });
    const [abortedCount, setAbortedCount] = useState(0);
    const [showAbortConfirm, setShowAbortConfirm] = useState(false);
    const abortRef = useRef(false);

    const enrichError = useCallback((msg: string, defsToUse?: any) => {
        if (!msg || typeof msg !== 'string') return msg;
        const activeDefs = defsToUse || definitions;
        if (!activeDefs?.customFields) return msg;
        let enhanced = msg;
        for (const cf of activeDefs.customFields) {
            if (enhanced.toLowerCase().includes(cf.originalName.toLowerCase()) && !enhanced.includes(`(${cf.description})`)) {
                // Escape original name for regex
                const escapedName = cf.originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                
                // Track if we matched the strict boundary version
                const prevEnhanced = enhanced;
                
                // Use \b (word boundary) which is non-consuming, so it catches all occurrences perfectly
                const strictRegex = new RegExp(`\\b${escapedName}\\b`, 'gi');
                enhanced = enhanced.replace(strictRegex, `${cf.originalName} (${cf.description})`);
                
                // Fallback: If strict boundary didn't catch it anywhere (which is rare but possible if it's attached to weird chars), use a global direct replace
                if (enhanced === prevEnhanced) {
                    const fallbackRegex = new RegExp(escapedName, 'gi');
                    enhanced = enhanced.replace(fallbackRegex, `${cf.originalName} (${cf.description})`);
                }
            }
        }
        return enhanced;
    }, [definitions]);

    // Undo / Redo history
    const [history, setHistory] = useState<{ rawFileJson: any[] | null, explicitAddedCols: string[] }[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    const recordChange = (newJson: any[] | null, newCols: Set<string>) => {
        setHistory(prev => {
            const nextState = {
                rawFileJson: newJson ? JSON.parse(JSON.stringify(newJson)) : null,
                explicitAddedCols: Array.from(newCols)
            };
            
            let baseHistory = prev.slice(0, historyIndex + 1);
            if (baseHistory.length === 0) {
                baseHistory.push({
                    rawFileJson: rawFileJson ? JSON.parse(JSON.stringify(rawFileJson)) : null,
                    explicitAddedCols: Array.from(explicitAddedCols)
                });
            }
            
            baseHistory.push(nextState);
            if (baseHistory.length > 5) {
                baseHistory = baseHistory.slice(baseHistory.length - 5);
            }
            return baseHistory;
        });
        
        setHistoryIndex(prev => {
            if (prev === -1) return 1;
            return Math.min(prev + 1, 4);
        });

        setRawFileJson(newJson);
        setExplicitAddedCols(newCols);
        
        if (newJson) {
            processRows(newJson, ambiguousDates, detectedUSFormat);
        } else {
            setReviews([]);
            // setUnmappedJson([]);
        }
    };

    const handleUndo = () => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            const targetState = history[newIndex];
            setHistoryIndex(newIndex);
            
            const newJson = targetState.rawFileJson ? JSON.parse(JSON.stringify(targetState.rawFileJson)) : null;
            const newCols = new Set(targetState.explicitAddedCols);
            setRawFileJson(newJson);
            setExplicitAddedCols(newCols);
            if (newJson) processRows(newJson, ambiguousDates, detectedUSFormat);
            else setReviews([]);
        }
    };

    const handleRedo = () => {
        if (historyIndex < history.length - 1 && historyIndex > -1) {
            const newIndex = historyIndex + 1;
            const targetState = history[newIndex];
            setHistoryIndex(newIndex);
            
            const newJson = targetState.rawFileJson ? JSON.parse(JSON.stringify(targetState.rawFileJson)) : null;
            const newCols = new Set(targetState.explicitAddedCols);
            setRawFileJson(newJson);
            setExplicitAddedCols(newCols);
            if (newJson) processRows(newJson, ambiguousDates, detectedUSFormat);
            else setReviews([]);
        }
    };

    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState<number | 'ALL'>(50);


    // New state for custom file mapping
    const [unmappedJson, setUnmappedJson] = useState<any[]>([]);
    const [employeeMapping, setEmployeeMapping] = useState<Map<number, number>>(new Map());
    const [initialAutoMapping, setInitialAutoMapping] = useState<Map<number, number | null>>(new Map());
    const [selectedIdentityMethod, setSelectedIdentityMethod] = useState<'NAME' | 'ID'>('NAME');
    const [fieldMapping, setFieldMapping] = useState<Map<string, string>>(new Map());

    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [isMissingFieldsExpanded, setIsMissingFieldsExpanded] = useState(false);

    const wakeLockRef = useRef<any>(null);

    useEffect(() => {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed?.clientId === EXPECTED_CLIENT_ID) handleAuthSuccess(parsed);
            else sessionStorage.removeItem(STORAGE_KEY);
        }
    }, []);

    useEffect(() => {
        // Clear bulk edit fields when navigating across steps
        setBulkEditField('');
        setBulkEditValue('');

        if (currentStep === 'review' && allEmployees.length === 0) {
            fetchEmployees().then(emp => {
                setAllEmployees(emp);
            }).catch(console.error);
        }
        if (currentStep === 'configure' && !definitions) {
            setIsLoading(true);
            setLoadingText('Fetching data...');
            Promise.all([
                fetchAllDefinitions(),
                fetchPortalInfo()
            ]).then(([defs, info]) => {
                setDefinitions(defs);
                if (info && info.name) setPortalName(info.name);
            }).catch(console.error).finally(() => setIsLoading(false));
        }
    }, [currentStep, allEmployees.length, definitions]);

    const handleAuthSuccess = (creds: PlandayApiCredentials) => {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
        initializeService(creds);
        setCurrentStep('configure');
        setError(null);
    };

    const handleManualRefresh = async () => {
        setIsLoading(true);
        setLoadingText("Refreshing portal data...");
        try {
            const [defs, info, employees] = await Promise.all([
                fetchAllDefinitions(),
                fetchPortalInfo(),
                fetchEmployees()
            ]);
            setDefinitions(defs);
            if (info && info.name) setPortalName(info.name);
            setAllEmployees(employees);

            // Prune selection sets from any fields that no longer exist in the portal
            if (defs) {
                setSelectedSystemFields(prev => {
                    const updated = new Set<string>();
                    prev.forEach(key => {
                        if (['email', 'bankReg', 'bankAcc', 'salaryIdentifier'].includes(key)) {
                            updated.add(key);
                        } else if (defs.availableSystemFields.includes(key) || 
                                  (key === 'cellPhoneCountryCode' && defs.availableSystemFields.includes('phoneCountryCode')) ||
                                  (key === 'cellPhone' && defs.availableSystemFields.includes('phone'))) {
                            updated.add(key);
                        }
                    });
                    return updated;
                });
                setSelectedCustomFields(prev => {
                    const updated = new Set<string>();
                    prev.forEach(id => {
                        if (defs.customFields.some(f => String(f.id) === id)) updated.add(id);
                    });
                    return updated;
                });
                setSelectedDepartments(prev => {
                    const updated = new Set<number>();
                    prev.forEach(id => {
                        if (defs.departments.some(d => d.id === id)) updated.add(id);
                    });
                    return updated;
                });
                setSelectedWages(prev => {
                    const updated = new Set<number>();
                    prev.forEach(id => {
                        if (defs.employeeGroups.some(g => g.id === id)) updated.add(id);
                    });
                    return updated;
                });
                setSelectedSkills(prev => {
                    const updated = new Set<number>();
                    prev.forEach(id => {
                        if (defs.skills.some(s => s.id === id)) updated.add(id);
                    });
                    return updated;
                });
            }
        } catch (err: any) {
            setError("Failed to refresh data: " + err.message);
        } finally {
            setIsLoading(false);
            setLoadingText("");
        }
    };

    const handleRemapColumn = (oldColumnId: string, newColumnId: string) => {
        if (!rawFileJson || !newColumnId) return;
        const newCols = new Set<string>(explicitAddedCols);
        if (newCols.has(oldColumnId)) {
            newCols.delete(oldColumnId);
            newCols.add(newColumnId);
        }
        
        const updatedJson = rawFileJson.map(row => {
            const rowCopy = { ...row };
            if (rowCopy.hasOwnProperty(oldColumnId)) {
                rowCopy[newColumnId] = rowCopy[oldColumnId];
                delete rowCopy[oldColumnId];
            }
            return rowCopy;
        });
        setColumnToRemap(null);
        recordChange(updatedJson, newCols);
    };

    const handleChangeCredentials = () => {
        sessionStorage.removeItem(STORAGE_KEY);
        resetService();
        setDefinitions(null);
        setAllEmployees([]);
        setSelectedSections({
            system: true,
            custom: false,
            salary: false,
            contract: false,
            skills: false,
            supervisor: false
        });
        setPopulateData(false);
        setReviews([]);
        setRawFileJson(null);
        setExplicitAddedCols(new Set());
        setHistory([]);
        setHistoryIndex(-1);
        setUnmappedJson([]);
        setEmployeeMapping(new Map());
        setInitialAutoMapping(new Map());
        setFieldMapping(new Map());
        setAmbiguousDates([]);
        setValidationErrors([]);
        setValidationSource('upload');
        setDateReport([]); 
        setError(null);
        setIsLoading(false);
        setLoadingText('');
        setProgress(0);
        setTotalItems(0);
        setCompletedCount(0);
        setShowConfirmModal(false);
        setCurrentStep('auth');
    };

    const handleDownloadTemplate = async () => {
        setIsLoading(true);
        setLoadingText("Fetching definitions...");
        setError(null);
        setProgress(0);
        setTotalItems(0);
        
        try {
            let defs = definitions;
            if (!defs) {
                defs = await fetchAllDefinitions();
                setDefinitions(defs); 
            }
            setProgress(50);
            
            if (updateMethod === 'excel') {
                if (selectedSections.system || selectedSections.custom || selectedSections.departments || selectedSections.wages || selectedSections.skills) {
                    // Initialize default selection based on available fields
                    const sys = new Set<string>();
                    const possibleSys = ['email', 'birthDate', 'gender', 'ssn', 'street1', 'street2', 'zip', 'city', 'cellPhoneCountryCode', 'cellPhone', 'hiredFrom', 'jobTitle', 'employeeTypeId', 'bankReg', 'bankAcc', 'salaryIdentifier'];
                    possibleSys.forEach(s => {
                         if (['email', 'bankReg', 'bankAcc', 'salaryIdentifier'].includes(s)) sys.add(s);
                         else if (defs!.availableSystemFields.includes(s)) sys.add(s);
                         else if (s === 'cellPhoneCountryCode' && defs!.availableSystemFields.includes('phoneCountryCode')) sys.add(s);
                         else if (s === 'cellPhone' && defs!.availableSystemFields.includes('phone')) sys.add(s);
                    });
                    setSelectedSystemFields(sys);
                    
                    const cus = new Set<string>();
                    defs.customFields.forEach(f => cus.add(String(f.id)));
                    setSelectedCustomFields(cus);
                    
                    const depts = new Set<number>();
                    defs.departments.forEach(d => depts.add(d.id));
                    setSelectedDepartments(depts);

                    const wages = new Set<number>();
                    defs.employeeGroups.forEach(g => wages.add(g.id));
                    setSelectedWages(wages);
                    
                    const skills = new Set<number>();
                    defs.skills.forEach(s => skills.add(s.id));
                    setSelectedSkills(skills);

                    setCurrentStep('select_fields');
                    setIsLoading(false);
                    return;
                }

                // If no field selection is required, immediately prepare for template download or upload
                setLoadingText("Fetching employee list...");
                const employees = await fetchEmployees();
                setAllEmployees(employees);
                setCurrentStep('generate_template');
                await generateAndDownloadTemplate();
            } else {
                // updateMethod === 'editor'
                setLoadingText("Fetching employee list...");
                const employeesRaw = allEmployees.length > 0 ? allEmployees : await fetchEmployees();
                if (allEmployees.length === 0) setAllEmployees(employeesRaw);

                const employees = employeesRaw.filter(emp => {
                    if (exportFilterPrimaryDepartment) {
                        const primDept = (emp as any).primaryDepartmentId;
                        if (!primDept) return false;
                        if (exportFilterDepartment.length > 0 && !exportFilterDepartment.includes(primDept)) return false;
                    } else {
                        const deps = (emp as any).departments || emp.departmentIds || [];
                        if (exportFilterDepartment.length > 0 && !exportFilterDepartment.some(d => deps.includes(d))) return false;
                    }
                    
                    const groups = (emp as any).employeeGroups || emp.employeeGroupIds || [];
                    if (exportFilterGroup.length > 0 && !exportFilterGroup.some(g => groups.includes(g))) return false;
                    
                    if (exportFilterType.length > 0 && !exportFilterType.includes(emp.employeeTypeId || -1)) return false;
                    
                    return true;
                });

                // Initialize Editor mode by faking parsed Excel rows with just Employee IDs!
                const initialFileJson = employees.map(emp => ({
                    "First Name": emp.firstName || "",
                    "Last Name": emp.lastName || "",
                    "Planday Employee ID": emp.id.toString(),
                }));
                
                setRawFileJson(initialFileJson);
                setUnmappedJson([]);
                setExplicitAddedCols(new Set());
                setHistory([]);
                setHistoryIndex(-1);
                setAmbiguousDates([]);
                setDetectedUSFormat(false);
                
                await processRows(initialFileJson, [], false);
                
                setShowEditorEditorInstructions(true);
                setCurrentStep('review');
                setIsLoading(false);
            }

        } catch (e: any) {
            setError("Failed to fetch definitions needed. Please check your connection or re-authenticate.");
            setIsLoading(false);
        }
    };

    const handleGoToUpload = async () => {
        if (definitions) {
            setCurrentStep('upload');
            return;
        }

        setIsLoading(true);
        setLoadingText("Fetching definitions...");
        setError(null);

        try {
            const defs = await fetchAllDefinitions();
            setDefinitions(defs);
            setCurrentStep('upload');
        } catch (e: any) {
            setError("Failed to fetch definitions needed. Please check your connection or re-authenticate.");
        } finally {
            setIsLoading(false);
        }
    };

    const generateAndDownloadTemplate = async () => {
        if (!definitions) return;
        const defs = definitions;
        setIsLoading(true);
        setLoadingText("Fetching employee list...");
        setError(null);
        setProgress(0);
        abortProcessRef.current = false;
        setIsStopModalOpen(false);
        
        try {
            const employeesRaw = allEmployees.length > 0 ? allEmployees : await fetchEmployees();
            if (abortProcessRef.current) {
                setIsLoading(false);
                setCurrentStep('configure');
                return;
            }
            if (allEmployees.length === 0) setAllEmployees(employeesRaw);
            
            const employees = employeesRaw.filter(emp => {
                if (exportFilterPrimaryDepartment) {
                    const primDept = (emp as any).primaryDepartmentId;
                    if (!primDept) return false;
                    if (exportFilterDepartment.length > 0 && !exportFilterDepartment.includes(primDept)) return false;
                } else {
                    const deps = (emp as any).departments || emp.departmentIds || [];
                    if (exportFilterDepartment.length > 0 && !exportFilterDepartment.some(d => deps.includes(d))) return false;
                }
                
                const groups = (emp as any).employeeGroups || emp.employeeGroupIds || [];
                if (exportFilterGroup.length > 0 && !exportFilterGroup.some(g => groups.includes(g))) return false;
                
                if (exportFilterType.length > 0 && !exportFilterType.includes(emp.employeeTypeId || -1)) return false;
                
                return true;
            });

            setTotalItems(employees.length);
            setProgress(10);

            const employeeDataMap = new Map<number, any>();
            if (populateData) {
                setLoadingText(`Fetching details for ${employees.length} employees (this may take time)...`);
                const BATCH = 3; 
                for (let i = 0; i < employees.length; i += BATCH) {
                    if (abortProcessRef.current) {
                        setIsLoading(false);
                        setCurrentStep('configure');
                        return;
                    }
                    const batch = employees.slice(i, i + BATCH);
                    const currentCount = Math.min(i + BATCH, employees.length);
                    const p = Math.round((currentCount / employees.length) * 80) + 10;
                    setProgress(p);
                    setLoadingText(`Fetching details: ${currentCount}/${employees.length}`);
                    
                    const promises = batch.map(async (emp) => {
                        const baseData = { ...emp }; 
                        let details = {};
                        if (selectedSections.custom) {
                            details = await fetchEmployeeDetails(emp.id) || {};
                        }
                        
                        let contract = null;
                        if (selectedSections.contract) contract = await fetchEmployeeContractRule(emp.id);
                        
                        let salary = null;
                        if (selectedSections.salary) salary = await fetchEmployeeSalary(emp.id);
                        
                        let rates: any[] = [];
                        if (selectedSections.salary) rates = await fetchEmployeePayRates(emp.id);

                        employeeDataMap.set(emp.id, { ...baseData, ...details, contractRule: contract, salary, payRates: rates });
                    });
                    await Promise.all(promises);
                    await new Promise(r => setTimeout(r, 250)); 
                }
            } else {
                setProgress(50);
            }
            
            setProgress(90);
            setLoadingText("Building Excel file...");
            const headers: string[] = ["Planday Employee ID", "First Name", "Last Name"];
            
            // --- NEW INSTRUCTION SHEET STRUCTURE (5 Columns) ---
            const instructionHeaders = ["Field Name", "Description", "Required", "Field Type", "Guidance"];
            const instructionRows: string[][] = [
                ["IMPORTANT NOTES", "* Only input your edits in the coloured columns (headers starting with UPDATE - )\n* Leave cells blank to keep existing values, or type 'REMOVE' to clear a value.\n* DO NOT modify or input edits in the identification columns.", "", "", ""],
                ["", "", "", "", ""], 
                instructionHeaders,
                ["Planday Employee ID", "System ID", "REQUIRED", "Integer", "Do not edit. Used for identification."],
                ["First Name", "First Name", "REQUIRED", "Text", "Do not edit. Used for identification."],
                ["Last Name", "Last Name", "REQUIRED", "Text", "Do not edit. Used for identification."],
                ["Salary Identifier (Payroll ID)", "Payroll ID", "", "Text", "Do not edit. Used for identification."]
            ];
            
            // Salary Identifier (Always included)
            headers.push("Salary Identifier (Payroll ID)");

            if (selectedSections.system && selectedSystemFields.has('salaryIdentifier')) {
                headers.push("UPDATE - Salary Identifier (Payroll ID)");
                instructionRows.push(["UPDATE - Salary Identifier (Payroll ID)", "Payroll ID", "", "Text", "Payroll ID"]);
            }

            const isReq = (key: string) => defs.requiredFields?.includes(key) ? true : false;
            
            // Helper to check if a system field is available in this portal (or mandatory)
            const isSystemFieldAvailable = (key: string) => defs.availableSystemFields.includes(key);

            const addCol = (name: string, description: string, type: string, required: boolean, guidance: string) => {
                const cleanName = name
                    .replace(" (YYYY-MM-DD)", "")
                    .replace(" (x)", "")
                    .replace(" (x/xx)", "");

                const displayType = type === 'Boolean' ? 'Checkbox' : type;
                const displayRequired = required ? "REQUIRED" : "";

                if (populateData) {
                    headers.push(cleanName);
                }
                const updateHeader = "UPDATE - " + cleanName;
                headers.push(updateHeader);
                instructionRows.push([updateHeader, description, displayRequired, displayType, guidance]);
            };

            // Order: System HR fields -> Contract Rule -> Custom fields -> Supervisors -> Skills -> Departments -> Salaries/Groups
            
            // 1. System HR fields (Standard)
            if (selectedSections.system) {
                // Mandatory fields that should always appear regardless of API definition list
                if (selectedSystemFields.has('email')) addCol("Email", "Email Address", "Text (Email)", isReq('email'), "Email is used as Username. Updates trigger verification email.");

                // Optional standard fields (Check availability)
                if (isSystemFieldAvailable('birthDate') && selectedSystemFields.has('birthDate')) addCol("Birth Date (YYYY-MM-DD)", "Birth Date", "Date", isReq('birthDate'), "Various date formats supported, e.g. DD/MM/YYYY");
                if (isSystemFieldAvailable('gender') && selectedSystemFields.has('gender')) addCol("Gender", "Gender", "Dropdown", isReq('gender'), "Male or Female");
                if (isSystemFieldAvailable('ssn') && selectedSystemFields.has('ssn')) addCol("Tax ID", "SSN / Tax ID", "Text", isReq('ssn'), "Social Security Number or Tax ID");
                if (isSystemFieldAvailable('street1') && selectedSystemFields.has('street1')) addCol("Street 1", "Address Line 1", "Text", isReq('street1'), "Street Address");
                if (isSystemFieldAvailable('street2') && selectedSystemFields.has('street2')) addCol("Street 2", "Address Line 2", "Text", isReq('street2'), "Apt, Suite, Unit, etc.");
                if (isSystemFieldAvailable('zip') && selectedSystemFields.has('zip')) addCol("Zip", "Postal Code", "Text", isReq('zip'), "Zip / Postal Code");
                if (isSystemFieldAvailable('city') && selectedSystemFields.has('city')) addCol("City", "City", "Text", isReq('city'), "City");
                if ((isSystemFieldAvailable('cellPhoneCountryCode') || isSystemFieldAvailable('phoneCountryCode')) && selectedSystemFields.has('cellPhoneCountryCode')) addCol("Country Code", "Mobile Country Code", "Text", isReq('cellPhoneCountryCode'), "Options: DK, UK, NO, SE, DE, US, PL, VN, FR, ES, GL, IT, NL, CH, BE, Etc.");
                if (isSystemFieldAvailable('cellPhone') && selectedSystemFields.has('cellPhone')) addCol("Mobile", "Mobile Number", "Text", isReq('cellPhone'), "e.g., 12345678 (digits only, no country code prefix). Do not input +45, etc.). Country code is set via the field “Country Code”.");
                if (isSystemFieldAvailable('hiredFrom') && selectedSystemFields.has('hiredFrom')) addCol("Start/hired Date (YYYY-MM-DD)", "Hired Date", "Date", isReq('hiredFrom'), "Various date formats supported, e.g. DD/MM/YYYY");
                if (isSystemFieldAvailable('jobTitle') && selectedSystemFields.has('jobTitle')) addCol("jobTitle", "Job Title", "Text", isReq('jobTitle'), "Job Title");
                if (isSystemFieldAvailable('employeeTypeId') && selectedSystemFields.has('employeeTypeId')) addCol("Employee Type", "Employee Type", "Dropdown", isReq('employeeTypeId'), `Options: ${defs.employeeTypes.map(t => t.name).join(', ')}`);
                
                // Bank info often doesn't appear in simple definitions but users expect it. Keeping as optional default.
                if (selectedSystemFields.has('bankReg')) addCol("System Bank Reg", "Bank Registration No.", "Text", false, "Bank Registration Number");
                if (selectedSystemFields.has('bankAcc')) addCol("System Bank Account Nr", "Bank Account No.", "Text", false, "Bank Account Number");
            }

            // 1. System / HR Fields (Already added above)

            // 2. Custom fields
            if (selectedSections.custom) {
                defs.customFields.forEach(f => {
                    if (!selectedCustomFields.has(String(f.id))) return;
                    let guidance = "";
                    switch(f.type) {
                        case 'Boolean':
                            guidance = "X to assign. REMOVE to unassign. Leave empty to skip.";
                            break;
                        case 'Numeric':
                            guidance = "Enter a numeric value.";
                            break;
                        case 'Dropdown':
                            if (f.dropdownOptions && f.dropdownOptions.length > 0) {
                                guidance = "Enter one of the following options: " + f.dropdownOptions.join(', ');
                            } else {
                                guidance = "Enter an available option from the list.";
                            }
                            break;
                        case 'Text':
                            guidance = "Accepts text form input.";
                            break;
                        case 'Date':
                            guidance = "Various date formats supported, e.g. DD/MM/YYYY.";
                            break;
                        default:
                            guidance = `Type: ${f.type}.`;
                            if (f.dropdownOptions) guidance += ` Options: ${f.dropdownOptions.join(', ')}`;
                    }
                    addCol(f.description, f.description, f.type, isReq(f.originalName), guidance);
                });
            }

            // 3. Supervisors
            if (selectedSections.supervisor) {
                addCol("Is Supervisor (x)", "Is Supervisor Status", "Checkbox", false, "X to assign. REMOVE to unassign. Leave empty to skip. Please check this field is enabled in your portal before filling out.");
                addCol("Assign Supervisor", "Assigned Supervisor", "Dropdown", false, `Options: ${defs.supervisors.length > 0 ? defs.supervisors.map(s => s.name).join(', ') : "No supervisors available in the portal."}. Enter REMOVE to unassign.`);
            }

            // 4. Contract Rule
            if (selectedSections.contract) {
                addCol("Contract Rule", "Contract Rule", "Dropdown", false, `Options: ${defs.contractRules.map(r => r.name).join(', ')}. Enter REMOVE to unassign.`);
            }

            // 5. Salaries
            if (selectedSections.salary) {
                addCol("Fixed Salary - Period", "Salary Period", "Dropdown", false, `Options: Monthly, Fortnightly, Weekly, Annual, FourWeekly. Remember to fill out the other required fields when updating Fixed Salary: Amount and Expected working hours.`);
                addCol("Fixed Salary - Expected working hours", "Salary Hours", "Numeric", false, "e.g., 160 for monthly, 37.5 or 37,5 for weekly. Both . and , accepted as decimal separator. Remember to fill out the other required fields when updating Fixed Salary: Period and Amount.");
                addCol("Fixed Salary - Amount", "Salary Amount", "Numeric", false, "e.g., 30000 or 30000,50 (numeric value, no currency symbol). Both . and , accepted as decimal separator. Remember to fill out the other required fields when updating Fixed Salary: Period and Expected working hours.");
                addCol("Fixed Salary - Salary Code", "Salary Code", "Text", false, "Only input a personal salary code, if the code should differ from the general salary code. If in doubt, leave it blank.");
                addCol("Fixed Salary - valid from (YYYY-MM-DD)", "Salary Valid From", "Date", false, "Various date formats supported, e.g. DD/MM/YYYY. If left blank, and rate is inputted, then the rate will be assigned from today’s date.");
            }

            // 6. Skills
            if (selectedSections.skills) {
                defs.skills.forEach(s => {
                    if (selectedSkills.has(s.id)) {
                        addCol(`Skill - ${s.name} (x)`, `Skill Assignment: ${s.name}`, "Checkbox", false, `X to assign. REMOVE to unassign. Leave empty to skip.`);
                    }
                });
            }

            // 7. Departments
            if (selectedSections.departments) {
                defs.departments.forEach(d => {
                    if (selectedDepartments.has(d.id)) {
                        addCol(`Department - ${d.name} (x/xx)`, `Department Membership: ${d.name}`, "Dropdown", false, `x = member, xx = primary. Enter REMOVE to unassign.`);
                    }
                });
            }

            // 8. Wages
            if (selectedSections.wages) {
                defs.employeeGroups.forEach(g => {
                    if (!selectedWages.has(g.id)) return;
                    
                    if (populateData) {
                        headers.push(`Group Rate - ${g.name}`);
                    }

                    const rateHeader = `UPDATE - Group Rate - ${g.name}`;
                    headers.push(rateHeader);
                    instructionRows.push([rateHeader, "Group Rate Amount", "", "Numeric", "X or 0 = assign without rate, or enter hourly rate (e.g., 15.50 or 15,50). Both . and , accepted. Leave empty to skip. Remember that Wage Type is required to be filled out when updating rates."]);
                    
                    const wageHeader = `UPDATE - Group Wage Type - ${g.name}`;
                    headers.push(wageHeader);
                    instructionRows.push([wageHeader, "Group Wage Type", "", "Dropdown", "HourlyRate or ShiftRate. Input HourlyRate to assign the employee group with an hourly rate; input ShiftRate if the employee is paid a fixed amount per shift."]);
                    
                    const validFromHeader = `UPDATE - Group Valid From - ${g.name}`;
                    headers.push(validFromHeader);
                    instructionRows.push([validFromHeader, "Group Rate Valid From", "", "Date", "Various date formats supported, e.g. DD/MM/YYYY. If left blank, and rate is inputted, then the rate will be assigned from today’s date."]);

                    const salaryCodeHeader = `UPDATE - Group Salary Code - ${g.name}`;
                    headers.push(salaryCodeHeader);
                    instructionRows.push([salaryCodeHeader, "Group Salary Code", "", "Text", "Only input a personal salary code, if the code should differ from the general or employee group salary code. If in doubt, leave it blank."]);
                });
            }

            const dataForSheet = employees.map(emp => {
                const row: any = {};
                const data = employeeDataMap.get(emp.id) || emp;

                row["Planday Employee ID"] = emp.id;
                row["First Name"] = emp.firstName;
                row["Last Name"] = emp.lastName;
                
                // Always populate Salary Identifier
                row["Salary Identifier (Payroll ID)"] = data.salaryIdentifier || "";

                if (populateData) {
                    if (selectedSections.system) {
                        row["Email"] = data.email || "";
                        if (isSystemFieldAvailable('birthDate')) row["Birth Date"] = formatDateToYYYYMMDD(data.birthDate);
                        if (isSystemFieldAvailable('gender')) row["Gender"] = data.gender || "";
                        if (isSystemFieldAvailable('ssn')) row["Tax ID"] = data.ssn || "";
                        if (isSystemFieldAvailable('street1')) row["Street 1"] = data.street1 || "";
                        if (isSystemFieldAvailable('street2')) row["Street 2"] = data.street2 || "";
                        if (isSystemFieldAvailable('zip')) row["Zip"] = data.zip || "";
                        if (isSystemFieldAvailable('city')) row["City"] = data.city || "";
                        if (isSystemFieldAvailable('cellPhoneCountryCode') || isSystemFieldAvailable('phoneCountryCode')) row["Country Code"] = data.cellPhoneCountryCode || data.phoneCountryCode || "";
                        if (isSystemFieldAvailable('cellPhone')) row["Mobile"] = data.cellPhone || data.phone || "";
                        if (isSystemFieldAvailable('hiredFrom')) row["Start/hired Date"] = formatDateToYYYYMMDD(data.hiredFrom || data.hiredDate);
                        if (isSystemFieldAvailable('jobTitle')) row["jobTitle"] = data.jobTitle || "";
                        if (isSystemFieldAvailable('employeeTypeId')) row["Employee Type"] = defs.employeeTypes.find(t => t.id === data.employeeTypeId)?.name || data.employeeTypeId || "";
                        
                        row["System Bank Reg"] = data.bankAccount?.registrationNumber || "";
                        row["System Bank Account Nr"] = data.bankAccount?.accountNumber || "";
                    }

                    if (selectedSections.departments) {
                        const deptIds = data.departments || [];
                        defs.departments.forEach(d => {
                             if (!selectedDepartments.has(d.id)) return;
                             if (data.primaryDepartmentId === d.id) row[`Department - ${d.name}`] = "xx";
                             else if (deptIds.includes(d.id)) row[`Department - ${d.name}`] = "x";
                        });
                    }

                    if (selectedSections.custom) {
                        defs.customFields.forEach(f => {
                            let val = data[f.originalName];
                            if (val && typeof val === 'object' && 'value' in val) val = val.value;
                            
                            if (f.type === 'Date') row[f.description] = formatDateToYYYYMMDD(val);
                            else if (f.type === 'Boolean') {
                                if (val === true) row[f.description] = "x";
                                else if (val === false) row[f.description] = "";
                                else row[f.description] = "";
                            }
                            else row[f.description] = val || "";
                        });
                    }

                    if (selectedSections.skills) {
                        // Normalize skills (could be skillIds array or skills object array)
                        let skillIds: number[] = [];
                        if (data.skills && Array.isArray(data.skills) && data.skills.length > 0) {
                            skillIds = data.skills.map((s: any) => parseInt(String(s.id || s.skillId), 10));
                        } else if (data.skillIds && Array.isArray(data.skillIds)) {
                            skillIds = data.skillIds.map((id: any) => parseInt(String(id), 10));
                        }
                        
                        defs.skills.forEach(s => {
                            if (selectedSkills.has(s.id) && skillIds.includes(s.id)) row[`Skill - ${s.name}`] = "x";
                        });
                    }

                    if (selectedSections.contract) {
                        row["Contract Rule"] = data.contractRule?.name || "";
                    }

                    if (selectedSections.supervisor) {
                        const sup = defs.supervisors.find(s => s.employeeId === emp.id);
                        if (sup) row["Is Supervisor"] = "x";
                        
                        if (data.supervisorId) {
                            const assignedSup = defs.supervisors.find(s => s.id === data.supervisorId);
                            row["Assign Supervisor"] = assignedSup?.name || "";
                        }
                    }

                    if (selectedSections.salary) {
                        if (data.salary) {
                            row["Fixed Salary - Period"] = defs.salaryTypes.find(t => t.id === data.salary.salaryTypeId)?.name || "";
                            row["Fixed Salary - Expected working hours"] = data.salary.hours;
                            row["Fixed Salary - Amount"] = data.salary.salary;
                            row["Fixed Salary - Salary Code"] = data.salary.salaryCode || "";
                            row["Fixed Salary - valid from"] = formatDateToYYYYMMDD(data.salary.validFrom);
                        }
                    }

                    if (selectedSections.wages) {
                        if (data.payRates && Array.isArray(data.payRates)) {
                            data.payRates.forEach((r: any) => {
                                const group = defs.employeeGroups.find(g => g.id === r.employeeGroupId);
                                if (group && selectedWages.has(group.id)) {
                                    let val = r.rate !== undefined && r.rate !== null ? String(r.rate) : '';
                                    if (r.wageType === 'ShiftRate') val += " - Shift Rate";
                                    row[`Group Rate - ${group.name}`] = val;
                                }
                            });
                        }
                    }
                }

                return row;
            });
            
            const ws = XLSX.utils.json_to_sheet(dataForSheet, { header: headers });

            // Add Note/Comment to A1
            if (ws['A1']) {
                ws['A1'].c = [{
                    t: "Note: These are NOT Salary/Payroll IDs. Please read the instructions found in the second sheet before filling out the template. Right-click cell A1 to hide/delete this note.",
                    a: "Planday Updater",
                    hidden: true
                }];
            }
            
            // --- Apply Styling for Main Sheet ---
            const range = XLSX.utils.decode_range(ws['!ref']);
            const headerStyle = {
                fill: { fgColor: { rgb: "162C34" } },
                font: { color: { rgb: "FFFFFF" }, bold: true },
                border: {
                    top: { style: 'thin', color: { rgb: "D9D9D9" } },
                    bottom: { style: 'thin', color: { rgb: "D9D9D9" } },
                    left: { style: 'thin', color: { rgb: "D9D9D9" } },
                    right: { style: 'thin', color: { rgb: "D9D9D9" } }
                }
            };
            const updateHeaderStyle = {
                fill: { fgColor: { rgb: "2663EB" } }, 
                font: { color: { rgb: "FFFFFF" }, bold: true },
                border: {
                    top: { style: 'thin', color: { rgb: "D9D9D9" } },
                    bottom: { style: 'thin', color: { rgb: "D9D9D9" } },
                    left: { style: 'thin', color: { rgb: "D9D9D9" } },
                    right: { style: 'thin', color: { rgb: "D9D9D9" } }
                }
            };
            const updateStyle = {
                fill: { fgColor: { rgb: "DEE6F0" } },
                border: {
                    top: { style: 'thin', color: { rgb: "D9D9D9" } },
                    bottom: { style: 'thin', color: { rgb: "D9D9D9" } },
                    left: { style: 'thin', color: { rgb: "D9D9D9" } },
                    right: { style: 'thin', color: { rgb: "D9D9D9" } }
                }
            };
            const normalStyle = {
                font: { bold: true },
                border: {
                    top: { style: 'thin', color: { rgb: "D9D9D9" } },
                    bottom: { style: 'thin', color: { rgb: "D9D9D9" } },
                    left: { style: 'thin', color: { rgb: "D9D9D9" } },
                    right: { style: 'thin', color: { rgb: "D9D9D9" } }
                }
            };
            const prePopulatedStyle = {
                font: { color: { rgb: "A6A6A6" }, bold: true }, 
                border: {
                    top: { style: 'thin', color: { rgb: "D9D9D9" } },
                    bottom: { style: 'thin', color: { rgb: "D9D9D9" } },
                    left: { style: 'thin', color: { rgb: "D9D9D9" } },
                    right: { style: 'thin', color: { rgb: "D9D9D9" } }
                }
            };
            
            // New Alternate Colors
            const tealHeaderStyle = {
                fill: { fgColor: { rgb: "32869C" } },
                font: { color: { rgb: "FFFFFF" }, bold: true },
                border: headerStyle.border
            };
            const tealUpdateStyle = {
                fill: { fgColor: { rgb: "DEEDF2" } },
                border: updateStyle.border
            };

            const contrastHeaderStyle = {
                fill: { fgColor: { rgb: "366092" } },
                font: { color: { rgb: "FFFFFF" }, bold: true },
                border: headerStyle.border
            };
            const contrastUpdateStyle = {
                fill: { fgColor: { rgb: "D0DEF0" } },
                border: updateStyle.border
            };

            // Calculate Style Map for columns
            let deptCount = 0;
            let skillCount = 0;
            let groupCount = 0;
            const groupSeen = new Set<string>();
            
            const getColStyle = (headerName: string) => {
                 if (!headerName || !headerName.startsWith("UPDATE - ")) return null;
                 
                 let useTeal = false;
                 let isAlternating = false;
                 
                 if (headerName.startsWith("UPDATE - Department - ")) {
                     isAlternating = true;
                     deptCount++;
                     if (deptCount % 2 === 0) useTeal = true;
                 } else if (headerName.startsWith("UPDATE - Skill - ")) {
                     isAlternating = true;
                     skillCount++;
                     if (skillCount % 2 === 0) useTeal = true;
                 } else if (headerName.includes("Group Rate - ") || headerName.includes("Group Wage Type - ") || headerName.includes("Group Valid From - ") || headerName.includes("Group Salary Code - ")) {
                     isAlternating = true;
                     // Extract Group Name. 
                     // Format: UPDATE - Group [Type] - Name
                     const parts = headerName.split(' - ');
                     const name = parts[parts.length - 1];
                     
                     if (!groupSeen.has(name)) {
                         groupCount++;
                         groupSeen.add(name);
                     }
                     // Current group count determines color
                     if (groupCount % 2 === 0) useTeal = true;
                 } else if (headerName.startsWith("UPDATE - Fixed Salary - ")) {
                     return { 
                         h: { ...normalStyle, fill: { fgColor: { rgb: "C0C2E8" } } }, 
                         b: { ...updateStyle, fill: { fgColor: { rgb: "D9DAF0" } } } 
                     };
                 }
                 
                 if (isAlternating) {
                     return useTeal ? { h: tealHeaderStyle, b: tealUpdateStyle } : { h: contrastHeaderStyle, b: contrastUpdateStyle };
                 }

                 return null;
            };

            const colStyleMap = headers.map(h => getColStyle(h));

            for (let R = range.s.r; R <= range.e.r; ++R) {
                for (let C = range.s.c; C <= range.e.c; ++C) {
                    const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
                    if (!ws[cellRef]) ws[cellRef] = { t: 's', v: '' }; 
                    
                    const headerName = headers[C];
                    const isUpdateCol = headerName && headerName.startsWith("UPDATE - ");
                    const customStyles = colStyleMap[C];
                    
                    if (R === 0) {
                        if (customStyles) {
                            ws[cellRef].s = customStyles.h;
                        } else if (isUpdateCol) {
                            ws[cellRef].s = updateHeaderStyle;
                        } else {
                            if (C === 0) { // Planday Employee ID
                                ws[cellRef].s = {
                                    ...headerStyle,
                                    font: { ...headerStyle.font, color: { rgb: "FFC046" } }
                                };
                            } else {
                                ws[cellRef].s = headerStyle;
                            }
                        }
                    } else {
                        // For data rows (and the instruction row at R=1)
                        if (customStyles) {
                            ws[cellRef].s = customStyles.b;
                        } else if (isUpdateCol) {
                            ws[cellRef].s = updateStyle;
                        } else if (C <= 2) { // 0=ID, 1=First Name, 2=Last Name
                            ws[cellRef].s = normalStyle;
                        } else {
                            // Pre-populated old values
                            ws[cellRef].s = prePopulatedStyle;
                        }
                    }
                }
            }

            ws['!freeze'] = { xSplit: 3, ySplit: 1 };
            ws['!cols'] = headers.map(h => ({ wch: h.length + 5 }));

            // --- Instructions Sheet ---
            const wsInfo = XLSX.utils.aoa_to_sheet(instructionRows);
            wsInfo['!cols'] = [{ wch: 35 }, { wch: 30 }, { wch: 10 }, { wch: 20 }, { wch: 60 }];
            
            const infoRange = XLSX.utils.decode_range(wsInfo['!ref']);
            const fieldDefStyle = {
                alignment: { wrapText: true, vertical: "top" },
                border: {
                    top: { style: 'thin', color: { rgb: "D9D9D9" } },
                    bottom: { style: 'thin', color: { rgb: "D9D9D9" } },
                    left: { style: 'thin', color: { rgb: "D9D9D9" } },
                    right: { style: 'thin', color: { rgb: "D9D9D9" } }
                }
            };
            const noteStyle = { font: { bold: true, color: { rgb: "C00000" } }, alignment: { wrapText: true, vertical: "top" } };

            for (let R = 0; R <= infoRange.e.r; ++R) {
                for (let C = 0; C <= 4; ++C) {
                    const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
                    if (!wsInfo[cellRef]) wsInfo[cellRef] = { t: 's', v: '' };

                    if (R === 2) {
                        wsInfo[cellRef].s = headerStyle;
                    } else if (R === 0) {
                        wsInfo[cellRef].s = noteStyle;
                    } else if (R > 2) {
                        wsInfo[cellRef].s = fieldDefStyle;
                        // Bold the "REQUIRED" cells in column 2
                        if (C === 2 && wsInfo[cellRef].v === "REQUIRED") {
                             wsInfo[cellRef].s = { ...fieldDefStyle, font: { bold: true } };
                        }
                    }
                }
            }

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Employee Updates");
            XLSX.utils.book_append_sheet(wb, wsInfo, "Instructions"); 
            
            setGeneratedWorkbook(wb);
            XLSX.writeFile(wb, "Planday_Employee_Update_Template.xlsx");
            setProgress(100);

        } catch (e: any) { setError(e.message); }
        finally { setIsLoading(false); }
    };

    const processUploadedFile = async (file: File) => {
        if (!definitions) { setError("Definitions missing. Please go back to Configure step."); return; }
        
        setIsLoading(true);
        setLoadingText("Parsing file...");
        setError(null);
        setDateReport([]); 
        
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const data = new Uint8Array(evt.target?.result as ArrayBuffer);
                const wb = XLSX.read(data, { type: 'array', cellDates: true });
                const ws = wb.Sheets[wb.SheetNames[0]]; 
                const json: any[] = XLSX.utils.sheet_to_json(ws, { raw: true });
                
                if (json.length === 0) {
                    throw new Error("File is empty");
                }
                
                // Clear previous custom mapping state
                setUnmappedJson([]);
                
                const headers = Object.keys(json[0]);
                const hasIdColumn = headers.includes("Planday Employee ID");

                // --- NEW PATH: Custom file without ID ---
                if (!hasIdColumn) {
                    setUnmappedJson(json);
                    
                    // Need employees list for mapping
                    if (allEmployees.length === 0) {
                        setLoadingText("Fetching current employees for mapping...");
                        const employees = await fetchEmployees();
                        setAllEmployees(employees);
                    }
                    
                    setIsLoading(false);
                    // Route to Identity Selection Method
                    setCurrentStep('identity_method'); 
                    return;
                }

                // --- EXISTING PATH: Standard Template ---
                processStandardJson(json);

            } catch (e: any) { setError(e.message); setIsLoading(false); }
        };
        reader.readAsArrayBuffer(file);
    };

    const generateTargetFields = (defs: DefinitionCollection): TargetField[] => {
        const targets: TargetField[] = [];
        
        const add = (label: string) => targets.push({ key: `UPDATE - ${label}`, label: label });

        const isSystemFieldAvailable = (key: string) => {
            if (['email', 'bankReg', 'bankAcc', 'salaryIdentifier'].includes(key)) return true;
            if (defs.availableSystemFields.includes(key)) return true;
            if (key === 'cellPhoneCountryCode' && defs.availableSystemFields.includes('phoneCountryCode')) return true;
            if (key === 'cellPhone' && defs.availableSystemFields.includes('phone')) return true;
            return false;
        };

        // Standard System
        if (isSystemFieldAvailable('email')) add("Email");
        if (isSystemFieldAvailable('birthDate')) add("Birth Date");
        if (isSystemFieldAvailable('gender')) add("Gender");
        if (isSystemFieldAvailable('ssn')) add("Tax ID");
        if (isSystemFieldAvailable('street1')) add("Street 1");
        if (isSystemFieldAvailable('street2')) add("Street 2");
        if (isSystemFieldAvailable('zip')) add("Zip");
        if (isSystemFieldAvailable('city')) add("City");
        if (isSystemFieldAvailable('cellPhoneCountryCode')) add("Country Code");
        if (isSystemFieldAvailable('cellPhone')) add("Mobile");
        if (isSystemFieldAvailable('hiredFrom')) add("Start/hired Date");
        if (isSystemFieldAvailable('jobTitle')) add("jobTitle");
        if (isSystemFieldAvailable('employeeTypeId')) add("Employee Type");
        if (isSystemFieldAvailable('bankReg')) add("System Bank Reg");
        if (isSystemFieldAvailable('bankAcc')) add("System Bank Account Nr");
        if (isSystemFieldAvailable('salaryIdentifier')) add("Salary Identifier (Payroll ID)");

        // Custom
        defs.customFields.forEach(f => add(f.description));

        // Supervisor
        add("Is Supervisor");
        add("Assign Supervisor");

        // Contract
        add("Contract Rule");

        // Fixed Salary
        add("Fixed Salary - Period");
        add("Fixed Salary - Expected working hours");
        add("Fixed Salary - Amount");
        add("Fixed Salary - Salary Code");
        add("Fixed Salary - valid from");

        // Skills
        defs.skills.forEach(s => add(`Skill - ${s.name.trim()}`));

        // Departments
        targets.push({ key: 'ALL_DEPARTMENTS', label: '✨ All Departments (split by comma/semicolon)' });
        defs.departments.forEach(d => add(`Department - ${d.name.trim()}`));

        // Groups (Generic for custom mapping is tricky, stick to simple ones first or list them all)
        targets.push({ key: 'ALL_EMPLOYEE_GROUPS', label: '✨ All Employee groups (split by comma/semicolon)' });
        targets.push({ key: 'ALL_EMPLOYEE_GROUPS_RATES', label: '✨ All Employee groups rates (split by comma/semicolon)' });
        targets.push({ key: 'ALL_WAGE_SALARY_VALID_FROM', label: '✨ All Wage and Salaries valid from' });
        defs.employeeGroups.forEach(g => {
            add(`Group Rate - ${g.name.trim()}`);
            add(`Group Wage Type - ${g.name.trim()}`);
            add(`Group Valid From - ${g.name.trim()}`);
            add(`Group Salary Code - ${g.name.trim()}`);
        });

        return targets;
    };

    const handleIdentityMethodSelection = (method: 'NAME' | 'ID', config?: any) => {
        setSelectedIdentityMethod(method);
        const autoMap = new Map<number, number | null>();
        
        // Build employee lookup map (name -> id)
        const empMap = new Map<string, number>();
        allEmployees.forEach(e => {
            empMap.set(`${e.firstName.toLowerCase()} ${e.lastName.toLowerCase()}`, e.id);
            empMap.set(`${e.firstName} ${e.lastName}`.toLowerCase(), e.id); // redundancy check
        });

        if (method === 'NAME') {
            const mode = config?.mode || 'AUTO';
            
            unmappedJson.forEach((row, idx) => {
                let nameToMatch = "";
                
                if (mode === 'AUTO') {
                    const keys = Object.keys(row);
                    const kLower = keys.map(k => ({ key: k, lower: k.toLowerCase().replace(/[^a-z0-9]/g, '') }));

                    const findAliasedKey = (aliases: string[]) => {
                         const match = kLower.find(k => aliases.includes(k.lower));
                         return match ? row[match.key] : null;
                    };

                    const firstName = findAliasedKey(['firstname', 'first', 'givenname']);
                    const lastName = findAliasedKey(['lastname', 'last', 'surname', 'familyname']);

                    if (firstName && lastName) {
                         nameToMatch = `${firstName} ${lastName}`;
                    } else {
                         const fullName = findAliasedKey(['name', 'employee', 'fullname', 'employeename']);
                         if (fullName) {
                             nameToMatch = fullName;
                         } else if (firstName) {
                             nameToMatch = firstName;
                         } else if (lastName) {
                             nameToMatch = lastName;
                         } else {
                             const nameKey = Object.keys(row).find(k => k.toLowerCase().includes('name'));
                             if (nameKey) nameToMatch = row[nameKey];
                         }
                    }
                } else if (mode === 'SINGLE') {
                    nameToMatch = row[config.col1] || "";
                } else if (mode === 'SPLIT') {
                    const first = row[config.col1] || "";
                    const last = row[config.col2] || "";
                    if (first || last) nameToMatch = `${first} ${last}`.trim();
                }

                if (nameToMatch) {
                     const cleanName = String(nameToMatch).toLowerCase().trim().replace(/\s+/g, ' '); // normalize spaces
                     const matchedId = empMap.get(cleanName);
                     autoMap.set(idx, matchedId || null);
                } else {
                    autoMap.set(idx, null);
                }
            });
        } else if (method === 'ID' && config) {
            // ID Matching Logic
            // config is column name string in this case
            const idMap = new Map<string, number>();
            allEmployees.forEach(e => {
                if (e.salaryIdentifier) {
                    idMap.set(String(e.salaryIdentifier).trim().toLowerCase(), e.id);
                }
            });
            unmappedJson.forEach((row, idx) => {
                const val = row[config];
                if (val !== undefined && val !== null) {
                    const cleanVal = String(val).trim().toLowerCase();
                    const matchedId = idMap.get(cleanVal);
                    autoMap.set(idx, matchedId || null);
                } else {
                    autoMap.set(idx, null);
                }
            });
        }

        setInitialAutoMapping(autoMap);
        setCurrentStep('map_employees');
    };

    const handleEmployeeMappingComplete = (mapping: Map<number, number>) => {
        setEmployeeMapping(mapping);
        setCurrentStep('map_fields');
    };

    const handleRevalidate = () => {
        if (!rawFileJson) return;
        setIsLoading(true);
        setLoadingText("Re-validating...");
        setTimeout(() => {
            const valErrors = validateData(rawFileJson);
            if (valErrors.length > 0) {
                setValidationErrors(valErrors);
                setIsLoading(false);
            } else {
                continueAfterValidation(rawFileJson);
            }
        }, 100);
    };

    const handleSkipInvalidFields = () => {
        if (!rawFileJson) return;
        const newJson = [...rawFileJson].map(row => ({...row}));
        validationErrors.forEach(err => {
            if (err.fullKey === 'FIXED_SALARY_MISSING') {
                Object.keys(newJson[err.rawRowIndex]).forEach(k => {
                    if (k.toLowerCase().includes('fixed salary')) delete newJson[err.rawRowIndex][k];
                });
            } else if (err.fullKey?.startsWith('GROUP_MISSING_')) {
                const gName = err.fullKey.replace('GROUP_MISSING_', '').toLowerCase();
                Object.keys(newJson[err.rawRowIndex]).forEach(k => {
                    if (k.toLowerCase().includes('group') && k.toLowerCase().includes(gName)) delete newJson[err.rawRowIndex][k];
                });
            } else if (err.fullKey) {
                delete newJson[err.rawRowIndex][err.fullKey];
            }
        });
        setRawFileJson(newJson);
        continueAfterValidation(newJson);
    };

    const handleContinueWithInvalidFields = () => {
        if (!rawFileJson) return;
        continueAfterValidation(rawFileJson);
    };

    const handleUpdateErrorValue = (rawRowIndex: number, fullKey: string, newValue: string) => {
        if (!rawFileJson) return;
        const newJson = [...rawFileJson];
        newJson[rawRowIndex] = { ...newJson[rawRowIndex], [fullKey]: newValue };
        setRawFileJson(newJson);
        
        // Optimistically update validation errors value display
        setValidationErrors(errors => errors.map(err => 
            err.rawRowIndex === rawRowIndex && err.fullKey === fullKey 
                ? { ...err, value: newValue } 
                : err
        ));
    };

    const handleFieldMappingComplete = (mapping: Map<string, string>) => {
        setFieldMapping(mapping);
        setIsLoading(true);
        setLoadingText("Applying mappings...");

        setTimeout(() => {
            try {
                // Transform Unmapped Data to Standard Data
                const mappedRows: any[] = [];
                
                unmappedJson.forEach((row, idx) => {
                    // Only process rows where we found an employee ID
                    const empId = employeeMapping.get(idx);
                    if (!empId) return;

                    const emp = allEmployees.find(e => e.id === empId);
                    if (!emp) return;

                    const newRow: any = {
                        "Planday Employee ID": empId,
                        "First Name": emp.firstName,
                        "Last Name": emp.lastName
                    };

                    const groupOrderForRates: string[] = [];
                    // Map fields
                    Object.keys(row).forEach(header => {
                        const targetKey = mapping.get(header);
                        if (targetKey === 'ALL_DEPARTMENTS') {
                            const val = String(row[header] || '');
                            const deptNames = val.split(/[,;]/).map(d => d.trim()).filter(Boolean);
                            deptNames.forEach(deptName => {
                                const matchingDept = definitions?.departments.find(d => d.name.toLowerCase() === deptName.toLowerCase());
                                if (matchingDept) {
                                    newRow[`UPDATE - Department - ${matchingDept.name.trim()}`] = "x";
                                }
                            });
                        } else if (targetKey === 'ALL_EMPLOYEE_GROUPS') {
                            const val = String(row[header] || '');
                            const groupNames = val.split(/[,;]/).map(d => d.trim()).filter(Boolean);
                            groupNames.forEach(groupName => {
                                const matchingGroup = definitions?.employeeGroups.find(g => g.name.toLowerCase() === groupName.toLowerCase());
                                if (matchingGroup) {
                                    newRow[`UPDATE - Group Rate - ${matchingGroup.name.trim()}`] = "x";
                                    groupOrderForRates.push(matchingGroup.name.trim());
                                }
                            });
                        } else if (targetKey && targetKey !== 'ALL_EMPLOYEE_GROUPS_RATES' && targetKey !== 'ALL_WAGE_SALARY_VALID_FROM') {
                            newRow[targetKey] = row[header];
                        }
                    });

                    // Map rates after groups are processed
                    Object.keys(row).forEach(header => {
                        const targetKey = mapping.get(header);
                        if (targetKey === 'ALL_EMPLOYEE_GROUPS_RATES') {
                            const val = String(row[header] || '');
                            const rates = val.split(/[,;]/).map(r => r.trim()).filter(Boolean);
                            if (rates.length === 1 && groupOrderForRates.length > 0) {
                                const rate = rates[0];
                                groupOrderForRates.forEach(groupName => {
                                    newRow[`UPDATE - Group Rate - ${groupName}`] = rate;
                                });
                            } else {
                                groupOrderForRates.forEach((groupName, i) => {
                                    if (rates[i] && rates[i] !== "") {
                                        newRow[`UPDATE - Group Rate - ${groupName}`] = rates[i];
                                    }
                                });
                            }
                        } else if (targetKey === 'ALL_WAGE_SALARY_VALID_FROM') {
                            const val = String(row[header] || '').trim();
                            if (val) {
                                groupOrderForRates.forEach(groupName => {
                                    newRow[`UPDATE - Group Valid From - ${groupName}`] = val;
                                });
                                newRow[`UPDATE - Fixed Salary - valid from`] = val;
                            }
                        }
                    });

                    // Ensure Group Wage Type is 'HourlyRate' by default if a Group Rate is set
                    Object.keys(newRow).forEach(key => {
                        if (key.startsWith('UPDATE - Group Rate - ')) {
                            const val = String(newRow[key]).trim();
                            if (val && val !== 'REMOVE') {
                                const groupName = key.replace('UPDATE - Group Rate - ', '');
                                const wageTypeKey = `UPDATE - Group Wage Type - ${groupName}`;
                                const wageTypeVal = String(newRow[wageTypeKey] || '').trim();
                                if (!wageTypeVal) {
                                    newRow[wageTypeKey] = "HourlyRate";
                                }
                            }
                        }
                    });

                    mappedRows.push(newRow);
                });

                if (mappedRows.length === 0) {
                     throw new Error("No valid rows mapped. Please ensure employees are selected.");
                }

                processStandardJson(mappedRows);
            } catch (e: any) {
                setError(e.message);
                setIsLoading(false);
            }
        }, 100);
    };

        const processStandardJson = (json: any[]) => {
        if (!definitions) return;

        // Ensure Group Wage Type is 'HourlyRate' by default if a Group Rate is set
        json.forEach(row => {
            Object.keys(row).forEach(key => {
                if (key.startsWith('UPDATE - Group Rate - ')) {
                    const val = String(row[key]).trim();
                    if (val && val !== 'REMOVE') {
                        const groupName = key.replace('UPDATE - Group Rate - ', '');
                        const wageTypeKey = `UPDATE - Group Wage Type - ${groupName}`;
                        const wageTypeVal = String(row[wageTypeKey] || '').trim();
                        if (!wageTypeVal) {
                            row[wageTypeKey] = "HourlyRate";
                        }
                    }
                }
            });
        });
        
        const customFieldMap = new Map<string, FieldDefinition>(definitions.customFields.map(f => [f.description.toLowerCase(), f] as [string, FieldDefinition]));

        const dateKeys: string[] = [];
        if (json.length > 0) {
            Object.keys(json[0]).forEach(key => {
                if (!key.startsWith('UPDATE - ')) return;
                const headerName = key.substring(9).trim().toLowerCase();
                
                if (headerName.includes('birth date') || headerName.includes('start/hired date') || headerName.includes('valid from')) {
                    dateKeys.push(key);
                }
                if (customFieldMap.has(headerName)) {
                    if (customFieldMap.get(headerName)?.type === 'Date') dateKeys.push(key);
                }
            });
        }

        // --- NEW: Validate Data ---
        const valErrors = validateData(json);
        if (valErrors.length > 0) {
            setRawFileJson(json); // save it to state so we can edit it
            setValidationErrors(valErrors);
            setValidationSource('upload');
            setCurrentStep('validation_errors');
            setIsLoading(false);
            return;
        }

        continueAfterValidation(json);
    };

    const continueAfterValidation = (json: any[]) => {
        if (!definitions) return;
        const customFieldMap = new Map<string, FieldDefinition>(definitions.customFields.map(f => [f.description.toLowerCase(), f] as [string, FieldDefinition]));

        const dateKeys: string[] = [];
        if (json.length > 0) {
            Object.keys(json[0]).forEach(key => {
                if (!key.startsWith('UPDATE - ')) return;
                const headerName = key.substring(9).trim().toLowerCase();
                
                if (headerName.includes('birth date') || headerName.includes('start/hired date') || headerName.includes('valid from')) {
                    dateKeys.push(key);
                }
                if (customFieldMap.has(headerName)) {
                    if (customFieldMap.get(headerName)?.type === 'Date') dateKeys.push(key);
                }
            });
        }

        const isUSFormat = checkForUSDateFormat(json, dateKeys);
        setDetectedUSFormat(isUSFormat);

        const ambiguities: AmbiguousDateItem[] = [];
        json.forEach((row, rowIndex) => {
            dateKeys.forEach(key => {
                const val = row[key];
                if (val && typeof val === 'string') {
                    // Skip ambiguity checks for 4-digit years (Year-First or Year-Last)
                    if (/^\d{4}[\/\.\-]/.test(val)) return;
                    if (/[\/\.\-]\d{4}$/.test(val)) return;

                    const match = val.match(/[\/\.\-](\d{2})$/);
                    if (match) {
                        const yearPart = parseInt(match[1], 10);
                        const fieldName = key.substring(9).trim();
                        
                        const centuryStart = guessCentury(yearPart, fieldName);
                        
                        ambiguities.push({
                            id: `${rowIndex}-${key}`,
                            rowNum: rowIndex + 2,
                            empName: `${row["First Name"]} ${row["Last Name"]}`,
                            field: fieldName,
                            input: val,
                            year2Digit: yearPart,
                            suggestion1900: 1900 + yearPart,
                            suggestion2000: 2000 + yearPart,
                            selectedCentury: centuryStart === 1900 ? 1900 : 2000
                        });
                    }
                }
            });
        });

        setRawFileJson(json);

        if (ambiguities.length > 0) {
            setAmbiguousDates(ambiguities);
            setCurrentStep('resolve_dates');
        } else {
            processRows(json, [], isUSFormat, true); 
        }
        
        setIsLoading(false);
    };

    const validateData = (rows: any[]): ValidationError[] => {
        if (!definitions) return [];
        const errors: ValidationError[] = [];

        // Build sets and maps (case insensitive matching)
        const validGenders = ['Male', 'Female'];
        const genderSet = new Set(validGenders.map(g => g.toLowerCase()));

        const empTypeMap = new Map<string, string>(definitions.employeeTypes.map(e => [e.name.toLowerCase(), e.name]));
        const empTypeNames = Array.from(empTypeMap.values());

        const ruleMap = new Map<string, string>(definitions.contractRules.map(c => [c.name.toLowerCase(), c.name]));
        const ruleNames = Array.from(ruleMap.values());
        
        const supervisorMap = new Map<string, string>(definitions.supervisors.map(s => [s.name.toLowerCase(), s.name]));
        const supervisorNames = Array.from(supervisorMap.values());

        const salaryTypeMap = new Map<string, string>(definitions.salaryTypes.map(s => [s.name.toLowerCase(), s.name]));
        const salaryTypeNames = Array.from(salaryTypeMap.values());

        const customFieldMap = new Map<string, FieldDefinition>(definitions.customFields.map(f => [f.description.toLowerCase(), f] as [string, FieldDefinition]));

        const SUPPORTED_COUNTRIES = ["DK", "UK", "NO", "SE", "DE", "US", "PL", "VN", "FR", "ES", "GL", "IT", "NL", "CH", "BE", "AT", "FI", "IS", "AU", "LT", "AR", "BS", "BB", "BY", "BR", "BG", "KH", "CA", "CL", "CN", "CZ", "DO", "EC", "EG", "EE", "FK", "GE", "GR", "GD", "HK", "HU", "IN", "IE", "IL", "JM", "JP", "KR", "KW", "LV", "LB", "LU", "MO", "MY", "MV", "MT", "MX", "MA", "NZ", "PY", "PE", "PH", "PT", "PR", "RO", "RU", "SG", "ZA", "LK", "TW", "TH", "TN", "TR", "UA", "AE", "UY", "VE", "GI", "FO", "NG", "SK", "NP", "GH", "ER", "ML", "TZ", "IR", "PK", "SY", "AL", "ID", "RS", "HR", "SI", "TT", "BA", "MK", "ME", "XK", "SL", "BO", "DZ", "CI", "BD", "CY", "MW", "MN", "CM", "UG", "QA", "CG", "KE", "SA", "CO", "MM", "GM", "FJ", "ZW", "SD", "AO", "YE", "MU", "RW", "BW", "RE", "HN", "ET", "LY", "MD", "SO", "AF", "CU", "CR", "ZM", "IQ", "LC", "SN", "LA", "GN"];
        const countryCodeList: string[] = SUPPORTED_COUNTRIES;
        const countryCodeSet = new Set(countryCodeList.map(c => c.toLowerCase()));

        // --- NEW: Email & Tax ID Validation Maps ---
        const fileEmailCounts = new Map<string, number>();
        const fileTaxIdCounts = new Map<string, number>();
        
        rows.forEach(r => {
            Object.keys(r).forEach(key => {
                 const keyLower = key.trim().toLowerCase();
                 if (keyLower === 'update - email') {
                     const rawVal = r[key];
                     if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== "") {
                         const emailLow = String(rawVal).trim().toLowerCase();
                         if (emailLow !== 'remove' && emailLow !== 'delete') {
                             fileEmailCounts.set(emailLow, (fileEmailCounts.get(emailLow) || 0) + 1);
                         }
                     }
                 }
                 if (keyLower === 'update - tax id') {
                     const rawVal = r[key];
                     if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== "") {
                         const taxLow = String(rawVal).trim().toLowerCase();
                         if (taxLow !== 'remove' && taxLow !== 'delete') {
                             fileTaxIdCounts.set(taxLow, (fileTaxIdCounts.get(taxLow) || 0) + 1);
                         }
                     }
                 }
            });
        });

        const existingEmailsMap = new Map<string, number>();
        const existingTaxIdsMap = new Map<string, number>();
        
        allEmployees.forEach(emp => {
            if (emp.email) {
                existingEmailsMap.set(emp.email.toLowerCase().trim(), emp.id);
            }
            if (emp.ssn) {
                existingTaxIdsMap.set(emp.ssn.toLowerCase().trim(), emp.id);
            }
        });

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        rows.forEach((row, rowIndex) => {
            const empName = `${row["First Name"] || ""} ${row["Last Name"] || ""}`.trim();
            const empIdStr = row["Planday Employee ID"];
            const empId = empIdStr ? parseInt(empIdStr, 10) : null;
            const rowNum = rowIndex + 2;

            let hasFixedSalary = false;
            const fixedSalaryFields = { period: false, hours: false, amount: false };
            const groupPresence = new Map<string, { rate: boolean, wageType: boolean }>();

            Object.keys(row).forEach(key => {
                if (!key.startsWith('UPDATE - ')) return;
                
                const rawVal = row[key];
                if (rawVal === undefined || rawVal === null || String(rawVal).trim() === "") return;
                
                const val = String(rawVal).trim();
                const lowerVal = val.toLowerCase();
                const headerName = key.substring(9).trim();
                const lowerHeader = headerName.toLowerCase();

                // Track Fixed Salary fields
                if (lowerHeader.startsWith('fixed salary')) {
                    hasFixedSalary = true;
                    if (lowerHeader.includes('period')) fixedSalaryFields.period = true;
                    if (lowerHeader.includes('hours')) fixedSalaryFields.hours = true;
                    if (lowerHeader.includes('amount')) fixedSalaryFields.amount = true;
                }

                // Track Group fields
                if (lowerHeader.startsWith('group ')) {
                    const parts = headerName.split(' - ');
                    if (parts.length > 1) {
                        const action = parts[0].toLowerCase(); // 'group rate', 'group wage type', etc.
                        const gName = parts.slice(1).join(' - ');
                        if (!groupPresence.has(gName)) groupPresence.set(gName, { rate: false, wageType: false });
                        
                        if (action === 'group rate') groupPresence.get(gName)!.rate = true;
                        if (action === 'group wage type') groupPresence.get(gName)!.wageType = true;
                    }
                }

                const isRemove = lowerVal === 'remove' || lowerVal === 'delete';
                if (isRemove) return; 

                // 1. Gender
                if (lowerHeader === 'gender') {
                    if (!genderSet.has(lowerVal)) {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: 'Gender',
                            value: val,
                            allowed: validGenders
                        });
                    }
                }
                
                // 2. Employee Type
                else if (lowerHeader === 'employee type') {
                    if (!empTypeMap.has(lowerVal)) {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: 'Employee Type',
                            value: val,
                            allowed: empTypeNames
                        });
                    }
                }

                // 3. Contract Rule
                else if (lowerHeader === 'contract rule') {
                    if (!ruleMap.has(lowerVal)) {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: 'Contract Rule',
                            value: val,
                            allowed: ruleNames
                        });
                    }
                }

                // 4. Country Code
                else if (lowerHeader === 'country code') {
                    if (countryCodeList.length > 0 && !countryCodeSet.has(lowerVal)) {
                         errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: 'Country Code',
                            value: val,
                            allowed: countryCodeList
                        });
                    }
                }

                // 5. Departments (x or xx)
                else if (lowerHeader.startsWith('department -')) {
                    if (lowerVal !== 'x' && lowerVal !== 'xx') {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: headerName, 
                            value: val,
                            allowed: ['x', 'xx']
                        });
                    }
                }

                // 6. Skills (x)
                else if (lowerHeader.startsWith('skill -')) {
                    if (lowerVal !== 'x') {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: headerName,
                            value: val,
                            allowed: ['x']
                        });
                    }
                }

                // 7. Is Supervisor (x)
                else if (lowerHeader === 'is supervisor' || lowerHeader === 'is supervisor (x)') {
                     if (val && lowerVal !== 'x' && lowerVal !== 'remove') {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: 'Is Supervisor',
                            value: val,
                            allowed: ['X', 'REMOVE']
                        });
                    }
                }

                // 8. Custom Dropdowns & Checkboxes
                else if (customFieldMap.has(lowerHeader)) {
                    const def = customFieldMap.get(lowerHeader);
                    if (def) {
                        if (def.type === 'Dropdown' && def.dropdownOptions && def.dropdownOptions.length > 0) {
                            const validOptions = def.dropdownOptions;
                            const validOptionsLower = new Set(validOptions.map(o => o.toLowerCase()));
                            
                            if (!validOptionsLower.has(lowerVal)) {
                                 errors.push({
                                    rawRowIndex: rowIndex,
                                    fullKey: key,
                                    row: rowNum,
                                    employeeName: empName,
                                    field: def.description,
                                    value: val,
                                    allowed: validOptions
                                });
                            }
                        } else if (def.type === 'Boolean') {
                            // Checkbox type
                            if (lowerVal !== 'x') {
                                errors.push({
                                    rawRowIndex: rowIndex,
                                    fullKey: key,
                                    row: rowNum,
                                    employeeName: empName,
                                    field: def.description,
                                    value: val,
                                    allowed: ['x']
                                });
                            }
                        } else if (def.type === 'Date') {
                            if (!parseDateWithFormat(rawVal, false) && !parseDateWithFormat(rawVal, true)) {
                                errors.push({
                                    rawRowIndex: rowIndex,
                                    fullKey: key,
                                    row: rowNum,
                                    employeeName: empName,
                                    field: headerName,
                                    value: val,
                                    allowed: ['Valid Date format (e.g. YYYY-MM-DD or DD.MM.YYYY)']
                                });
                            }
                        }
                    }
                }

                // 9. Assign Supervisor
                else if (lowerHeader === 'assign supervisor') {
                    if (!supervisorMap.has(lowerVal)) {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: 'Assign Supervisor',
                            value: val,
                            allowed: [...supervisorNames, 'REMOVE']
                        });
                    }
                }

                // 10. Date Fields validation
                else if (lowerHeader.includes('birth date') || lowerHeader.includes('start/hired date') || lowerHeader.includes('valid from')) {
                    if (!parseDateWithFormat(rawVal, false) && !parseDateWithFormat(rawVal, true)) {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: headerName,
                            value: val,
                            allowed: ['Valid Date format (e.g. YYYY-MM-DD or DD.MM.YYYY)']
                        });
                    }
                }

                // 11. Fixed Salary - Period
                else if (lowerHeader === 'fixed salary - period') {
                    if (!salaryTypeMap.has(lowerVal)) {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: 'Fixed Salary - Period',
                            value: val,
                            allowed: salaryTypeNames
                        });
                    }
                }
                
                // Fixed Salary - Amount
                else if (lowerHeader === 'fixed salary - amount') {
                    if (!/^\d+([.,]\d+)?$/.test(val)) {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: 'Fixed Salary - Amount',
                            value: val,
                            allowed: ['Numeric amount without currency symbol (e.g. 25000 or 25000.50)']
                        });
                    }
                }

                // Fixed Salary - Expected working hours
                else if (lowerHeader === 'fixed salary - expected working hours') {
                    if (!/^\d+([.,]\d+)?$/.test(val)) {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: 'Fixed Salary - Expected working hours',
                            value: val,
                            allowed: ['Numeric hours without letters (e.g. 160 or 160.5)']
                        });
                    }
                }

                // 12. Group Wage Type
                else if (lowerHeader.startsWith('group wage type - ')) {
                    if (lowerVal !== 'hourlyrate' && lowerVal !== 'shiftrate') {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: headerName,
                            value: val,
                            allowed: ['HourlyRate', 'ShiftRate']
                        });
                    }
                }

                // Group Rate
                else if (lowerHeader.startsWith('group rate - ')) {
                    if (!/^\d+([.,]\d+)?$/.test(val)) {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: headerName,
                            value: val,
                            allowed: ['Numeric wage rate without currency (e.g. 15 or 15.50)']
                        });
                    }
                }

                // Mobile validation
                else if (lowerHeader === 'mobile') {
                    if (!/^\d+$/.test(val)) {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: 'Mobile',
                            value: val,
                            allowed: ['Digits only, without area code (no +45 or spaces)']
                        });
                    }
                }

                // 13. Email Validation
                else if (lowerHeader === 'email') {
                    if (!emailRegex.test(val)) {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: 'Email',
                            value: val,
                            allowed: ['Valid Email Address (e.g. user@example.com)']
                        });
                    } else {
                        // Check for duplicates in file
                        if ((fileEmailCounts.get(lowerVal) || 0) > 1) {
                            errors.push({
                                rawRowIndex: rowIndex,
                                fullKey: key,
                                row: rowNum,
                                employeeName: empName,
                                field: 'Email',
                                value: val,
                                allowed: ['Unique Email (another row in this update has the same email)']
                            });
                        } else {
                            // Check for duplicates in existing DB
                            if (existingEmailsMap.has(lowerVal)) {
                                const existingEmpId = existingEmailsMap.get(lowerVal);
                                if (existingEmpId !== empId) {
                                    errors.push({
                                        rawRowIndex: rowIndex,
                                        fullKey: key,
                                        row: rowNum,
                                        employeeName: empName,
                                        field: 'Email',
                                        value: val,
                                        allowed: [`Unique Email (currently used by employee ID: ${existingEmpId})`]
                                    });
                                }
                            }
                        }
                    }
                } else if (lowerHeader === 'tax id') {
                    if ((fileTaxIdCounts.get(lowerVal) || 0) > 1) {
                        errors.push({
                            rawRowIndex: rowIndex,
                            fullKey: key,
                            row: rowNum,
                            employeeName: empName,
                            field: 'Tax ID',
                            value: val,
                            allowed: ['Unique Tax ID (another row in this update has the same Tax ID)']
                        });
                    } else {
                        // Check for duplicates in existing DB
                        if (existingTaxIdsMap.has(lowerVal)) {
                            const existingEmpId = existingTaxIdsMap.get(lowerVal);
                            if (existingEmpId !== empId) {
                                errors.push({
                                    rawRowIndex: rowIndex,
                                    fullKey: key,
                                    row: rowNum,
                                    employeeName: empName,
                                    field: 'Tax ID',
                                    value: val,
                                    allowed: [`Unique Tax ID (currently used by employee ID: ${existingEmpId})`]
                                });
                            }
                        }
                    }
                }
            });

            // Post-row validation checks
            if (hasFixedSalary) {
                if (!fixedSalaryFields.period || !fixedSalaryFields.amount || !fixedSalaryFields.hours) {
                    errors.push({
                        rawRowIndex: rowIndex,
                        fullKey: 'FIXED_SALARY_MISSING',
                        row: rowNum,
                        employeeName: empName,
                        field: "Fixed Salary",
                        value: "Missing Required Fields",
                        allowed: ["Must provide Period, Expected working hours, and Amount if updating Fixed Salary"]
                    });
                }
            }

            groupPresence.forEach((presence, groupName) => {
                if (!presence.rate || !presence.wageType) {
                    errors.push({
                        rawRowIndex: rowIndex,
                        fullKey: `GROUP_MISSING_${groupName}`,
                        row: rowNum,
                        employeeName: empName,
                        field: `Group - ${groupName}`,
                        value: "Missing Required Fields",
                        allowed: [`Must provide Group Rate - ${groupName} and Group Wage Type - ${groupName} if updating Group Wages`]
                    });
                }
            });
        });

        return errors;
    };

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            processUploadedFile(e.target.files[0]);
            e.target.value = '';
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files?.[0]) {
            processUploadedFile(e.dataTransfer.files[0]);
        }
    };

    const processRows = async (json: any[], dateResolutions: AmbiguousDateItem[], isUSFormat: boolean, refetch: boolean = false) => {
        if (!definitions) return;

        if (refetch) {
            setIsLoading(true);
            setLoadingText("Fetching latest employee data...");
            try {
                const latestEmployees = await fetchEmployees();
                setAllEmployees(latestEmployees);
            } catch (e) {
                console.error("Failed to re-fetch employees", e);
            }
        }

        setLoadingText("Processing data...");

        const deptMap = new Map<string, number>(definitions.departments.map(d => [d.name.trim().toLowerCase(), d.id] as [string, number]));
        const groupMap = new Map<string, number>(definitions.employeeGroups.map(g => [g.name.trim().toLowerCase(), g.id] as [string, number]));
        const skillMap = new Map<string, number>(definitions.skills.map(s => [s.name.trim().toLowerCase(), s.id] as [string, number]));
        const typeMap = new Map<string, number>(definitions.employeeTypes.map(t => [t.name.trim().toLowerCase(), t.id] as [string, number]));
        const salaryTypeMap = new Map<string, number>(definitions.salaryTypes.map(t => [t.name.trim().toLowerCase(), t.id] as [string, number]));
        const ruleMap = new Map<string, number>(definitions.contractRules.map(r => [r.name.trim().toLowerCase(), r.id] as [string, number]));
        const supervisorMap = new Map<string, number>(definitions.supervisors.map(s => [s.name.trim().toLowerCase(), s.id] as [string, number]));
        const customFieldMap = new Map<string, FieldDefinition>(definitions.customFields.map(f => [f.description.trim().toLowerCase(), f] as [string, FieldDefinition]));

        // Pre-scan for pending supervisors (marked with 'x' in this file)
        const pendingSupervisors = new Set<string>();
        json.forEach(row => {
            const keys = Object.keys(row);
            const isSupKey = keys.find(k => k.toLowerCase() === 'update - is supervisor');
            if (isSupKey) {
                const val = String(row[isSupKey]).trim().toLowerCase();
                if (val === 'x' || val === 'true') {
                    const firstName = row["First Name"] || "";
                    const lastName = row["Last Name"] || "";
                    pendingSupervisors.add(`${firstName} ${lastName}`.trim().toLowerCase());
                }
            }
        });

        const report: DateLogItem[] = [];
        const parsedReviews: EmployeeUpdateReview[] = [];

        const resolutionMap = new Map<string, number>();
        dateResolutions.forEach(r => resolutionMap.set(r.id, r.selectedCentury + r.year2Digit));

        json.forEach((row, rowIndex) => {
            const empId = parseInt(row["Planday Employee ID"]);
            if (!empId) return;

            const review: EmployeeUpdateReview = {
                employeeId: empId,
                employeeName: `${row["First Name"]} ${row["Last Name"]}`,
                changes: [],
                payloads: {},
                validationErrors: {}
            };

            const mainPayload: any = {};

            const parseAndLogDate = (raw: any, fieldName: string, fullKey: string) => {
                const correctionKey = `${rowIndex}-${fullKey}`;
                const correctedYear = resolutionMap.get(correctionKey);

                const parsed = parseDateWithFormat(raw, isUSFormat, correctedYear);
                if (parsed && raw) {
                    report.push({
                        rowNum: rowIndex + 2, 
                        field: fieldName,
                        original: formatOriginalDateForDisplay(raw, isUSFormat),
                        payload: parsed
                    });
                }
                return parsed;
            };

            if (definitions.employeeGroups) {
                definitions.employeeGroups.forEach(g => {
                    const rateHeader = `UPDATE - Group Rate - ${g.name.trim()}`;
                    const wageHeader = `UPDATE - Group Wage Type - ${g.name.trim()}`;
                    const fromHeader = `UPDATE - Group Valid From - ${g.name.trim()}`;
                    const codeHeader = `UPDATE - Group Salary Code - ${g.name.trim()}`;

                    if (row[rateHeader] !== undefined && row[rateHeader] !== null && String(row[rateHeader]).trim() !== "") {
                        const rateVal = parseDecimal(row[rateHeader]);
                        const wageTypeRaw = String(row[wageHeader] || 'HourlyRate').trim();
                        const wageType = wageTypeRaw.toLowerCase().includes('shift') ? 'ShiftRate' : 'HourlyRate';
                        
                        let validFrom = parseAndLogDate(row[fromHeader], fromHeader.replace('UPDATE - ', ''), fromHeader);
                        if (!validFrom) validFrom = getTodayYYYYMMDD();

                        const salaryCode = (row[codeHeader] && String(row[codeHeader]).trim() !== "") 
                            ? String(row[codeHeader]).trim() 
                            : "";

                        if (!review.payloads.groupRates) review.payloads.groupRates = [];
                        review.payloads.groupRates.push({
                            wageType: wageType,
                            rate: rateVal,
                            employeeIds: [empId],
                            validFrom: validFrom,
                            salaryCode: salaryCode
                        });
                        (review.payloads.groupRates[review.payloads.groupRates.length - 1] as any).groupId = g.id;

                        if (!review.payloads.groups) review.payloads.groups = { employeeGroups: [] };
                        (review.payloads.groups as any)[g.id] = 'add';
                        
                        review.changes.push(`Rate: ${g.name} -> ${rateVal}`);
                    }
                });
            }

            Object.keys(row).forEach(key => {
                if (!key.startsWith("UPDATE - ")) return;
                if (key.includes("Group Rate - ") || key.includes("Group Wage Type - ") || key.includes("Group Valid From - ") || key.includes("Group Salary Code - ")) return;

                const rawVal = row[key];
                if (rawVal === undefined || rawVal === null || String(rawVal).trim() === "") return;
                
                const val = String(rawVal).trim();
                const isDelete = val.toUpperCase() === 'REMOVE' || val.toUpperCase() === 'DELETE';
                const isRemove = val.toUpperCase() === 'REMOVE';
                const headerName = key.substring(9).trim();
                const lowerHeader = headerName.toLowerCase();

                if (lowerHeader === 'email') { mainPayload.email = val; review.changes.push(`Email -> ${val}`); review.payloads.username = val; }
                else if (lowerHeader === 'jobtitle') { mainPayload.jobTitle = isDelete ? "" : val; review.changes.push(`Job Title -> ${isDelete ? 'REMOVE' : val}`); }
                else if (lowerHeader === 'birth date') { 
                    mainPayload.birthDate = isDelete ? null : parseAndLogDate(rawVal, headerName, key); 
                    review.changes.push(`Birth Date -> ${isDelete ? 'REMOVE' : (mainPayload.birthDate || val)}`); 
                }
                else if (lowerHeader === 'gender') { mainPayload.gender = isDelete ? "" : val; review.changes.push(`Gender -> ${isDelete ? 'REMOVE' : val}`); }
                else if (lowerHeader === 'tax id') { mainPayload.ssn = isDelete ? "" : val; review.changes.push(`SSN -> ${isDelete ? 'REMOVE' : val}`); }
                else if (lowerHeader === 'street 1') { mainPayload.street1 = isDelete ? "" : val; review.changes.push(`Street 1 -> ${isDelete ? 'REMOVE' : val}`); }
                else if (lowerHeader === 'street 2') { mainPayload.street2 = isDelete ? "" : val; review.changes.push(`Street 2 -> ${isDelete ? 'REMOVE' : val}`); }
                else if (lowerHeader === 'zip') { mainPayload.zip = isDelete ? "" : val; review.changes.push(`Zip -> ${isDelete ? 'REMOVE' : val}`); }
                else if (lowerHeader === 'city') { mainPayload.city = isDelete ? "" : val; review.changes.push(`City -> ${isDelete ? 'REMOVE' : val}`); }
                else if (lowerHeader === 'country code') { mainPayload.cellPhoneCountryCode = isDelete ? "" : val; review.changes.push(`Country Code -> ${isDelete ? 'REMOVE' : val}`); }
                else if (lowerHeader === 'mobile') { mainPayload.cellPhone = isDelete ? "" : val; review.changes.push(`Mobile -> ${isDelete ? 'REMOVE' : val}`); }
                else if (lowerHeader === 'start/hired date') { 
                    mainPayload.hiredFrom = isDelete ? null : parseAndLogDate(rawVal, headerName, key); 
                    review.changes.push(`Start Date -> ${isDelete ? 'REMOVE' : (mainPayload.hiredFrom || val)}`); 
                }
                else if (lowerHeader === 'salary identifier (payroll id)') { mainPayload.salaryIdentifier = isDelete ? "" : val; review.changes.push(`Payroll ID -> ${isDelete ? 'REMOVE' : val}`); }
                else if (lowerHeader === 'employee type') {
                    const id = typeMap.get(val.toLowerCase());
                    if (id) { mainPayload.employeeTypeId = id; review.changes.push(`Employee Type -> ${val}`); }
                }
                else if (lowerHeader === 'system bank reg') { 
                    if (!mainPayload.bankAccount) mainPayload.bankAccount = {};
                    mainPayload.bankAccount.registrationNumber = isDelete ? "" : val;
                    review.changes.push(`Bank Reg -> ${isDelete ? 'REMOVE' : val}`);
                }
                else if (lowerHeader === 'system bank account nr') { 
                    if (!mainPayload.bankAccount) mainPayload.bankAccount = {};
                    mainPayload.bankAccount.accountNumber = isDelete ? "" : val;
                    review.changes.push(`Bank Acc -> ${isDelete ? 'REMOVE' : val}`);
                }
                else if (lowerHeader === 'contract rule') {
                    if (isDelete) {
                        review.payloads.contractRule = null;
                        review.changes.push(`Contract Rule: Unassigned`);
                    } else {
                        const ruleId = ruleMap.get(val.toLowerCase());
                        if (ruleId) {
                            review.payloads.contractRule = ruleId;
                            review.changes.push(`Contract Rule: ${val}`);
                        } else {
                            if (!review.validationErrors) review.validationErrors = {};
                            review.validationErrors.contract = `Rule '${val}' not found`;
                            review.changes.push(`Contract Rule: Invalid '${val}'`);
                        }
                    }
                }
                else if (lowerHeader === 'is supervisor') {
                    const isSup = isDelete ? false : (val.toLowerCase() === 'x' || val.toLowerCase() === 'true');
                    mainPayload.isSupervisor = isSup;
                    review.changes.push(`Is Supervisor: ${isSup}`);
                }
                else if (lowerHeader === 'assign supervisor') {
                    if (isDelete) {
                        review.payloads.supervisor = null;
                        review.changes.push('Supervisor: Unassigned');
                    } else {
                        const supId = supervisorMap.get(val.toLowerCase());
                        if (supId) {
                            review.payloads.supervisor = supId;
                            review.changes.push(`Supervisor: ${val}`);
                        } else {
                            // Check if this supervisor is being created in the current batch
                            if (pendingSupervisors.has(val.toLowerCase())) {
                                review.payloads.pendingSupervisorName = val;
                                review.changes.push(`Supervisor: ${val} (Pending Creation)`);
                            } else {
                                if (!review.validationErrors) review.validationErrors = {};
                                review.validationErrors.supervisor = `Name '${val}' not found`;
                                review.changes.push(`Supervisor: Invalid '${val}'`);
                            }
                        }
                    }
                }
                else if (lowerHeader.startsWith('fixed salary -')) {
                    if (!review.payloads.fixedSalary) review.payloads.fixedSalary = { isDelete: false, data: { salaryTypeId: 0, hours: 0, salary: 0, from: '' } };
                    if (isDelete) review.payloads.fixedSalary.isDelete = true;
                    
                    const salData = review.payloads.fixedSalary.data!;
                    if (lowerHeader.includes('period')) {
                        const typeId = salaryTypeMap.get(val.toLowerCase());
                        if (typeId) salData.salaryTypeId = typeId;
                    }
                    if (lowerHeader.includes('expected working hours')) salData.hours = parseDecimal(val);
                    if (lowerHeader.includes('amount')) salData.salary = parseDecimal(val);
                    if (lowerHeader.includes('salary code')) salData.salaryCode = val;
                    if (lowerHeader.includes('valid from')) salData.from = parseAndLogDate(rawVal, headerName, key) || '';
                    
                    let salField = "";
                    if (lowerHeader.includes('period')) salField = "Period";
                    if (lowerHeader.includes('expected working hours')) salField = "Hours";
                    if (lowerHeader.includes('amount')) salField = "Amount";
                    if (lowerHeader.includes('salary code')) salField = "Code";
                    if (lowerHeader.includes('valid from')) salField = "Valid From";
                    
                    review.changes.push(`Fixed Salary (${salField}) -> ${isDelete ? 'REMOVE' : val}`);
                }
                else if (customFieldMap.has(lowerHeader)) {
                    const def = customFieldMap.get(lowerHeader)!;
                    let apiVal: any = val;
                    
                    if (def.type === 'Boolean') {
                         const v = val.toLowerCase();
                         apiVal = (v === 'true' || v === 'x' || v === 'yes');
                    }
                    
                    if (def.type === 'Numeric') apiVal = parseDecimal(val);
                    if (def.type === 'Date') apiVal = parseAndLogDate(rawVal, def.description, key);
                    if (isDelete) apiVal = (def.type === 'Boolean' ? false : "");
                    
                    mainPayload[def.originalName] = apiVal;
                    review.changes.push(`Custom: ${def.description} -> ${isDelete ? 'REMOVE' : val}`);
                }
                else if (lowerHeader.startsWith('department -')) {
                    const deptName = lowerHeader.replace('department -', '').trim();
                    const deptId = deptMap.get(deptName);
                    if (deptId) {
                        const action = isRemove ? 'remove' : (val.toLowerCase() === 'xx' ? 'primary' : 'add');
                        if (!review.payloads.departments) review.payloads.departments = { departments: [], primaryDepartmentId: null };
                        (review.payloads.departments as any)[deptId] = action;
                        review.changes.push(`Dept: ${deptName} (${action})`);
                    }
                }
                else if (lowerHeader.startsWith('skill -')) {
                    const skillName = lowerHeader.replace('skill -', '').trim();
                    const skillId = skillMap.get(skillName);
                    if (skillId) {
                        const action = isRemove ? 'remove' : 'add';
                        if (!review.payloads.skills) review.payloads.skills = { skillIds: [] };
                        (review.payloads.skills as any)[skillId] = action;
                        review.changes.push(`Skill: ${skillName} (${action})`);
                    }
                }
                else if (lowerHeader.startsWith('group -')) {
                     const groupName = lowerHeader.replace('group -', '').trim();
                     const groupId = groupMap.get(groupName);
                     if (groupId) {
                         const action = isRemove ? 'remove' : 'add';
                         if (!review.payloads.groups) review.payloads.groups = { employeeGroups: [] };
                         (review.payloads.groups as any)[groupId] = action;
                         review.changes.push(`Group: ${groupName} (${action})`);
                     }
                }
            });

            if (Object.keys(mainPayload).length > 0) review.payloads.main = mainPayload;
            
            if (review.changes.length === 0) {
                review.status = 'no_updates';
            }
            parsedReviews.push(review);
        });

        if (parsedReviews.filter(r => r.changes.length > 0).length === 0) {
            if (updateMethod !== 'editor') {
                setError("No changes detected in UPDATE columns.");
            } else {
                setError(null);
            }
        }
        setReviews(parsedReviews);
        setDateReport(report);
        setSelectedReviewIds(new Set(parsedReviews.map(r => r.employeeId)));
        setCurrentStep('review');
    };

    const processEmployeeUpdate = async (item: EmployeeUpdateReview): Promise<EmployeeUpdateReview> => {
        const { payloads } = item;
        const updateResults = item.results || {
            main: { success: true, message: 'Skipped' },
            username: { success: true, message: 'Skipped' },
            supervisor: { success: true, message: 'Skipped' },
            contract: { success: true, message: 'Skipped' },
            salary: { success: true, message: 'Skipped' },
            rates: { success: true, message: 'Skipped' }
        };
        let overallSuccess = true;
        let failureMessages: string[] = [];

        try {
            // Pre-fetch current data for merges if needed (Departments, Skills, Groups)
            // Optimization: Only fetch if we are updating these fields OR if we need padding for supervisor unassignment
            let current: any = {};
            
            // Check if Main payload is "destructive only" (all values are null or empty strings)
            // In this case, we MUST fetch current data to pad with FirstName
            const mainIsDestructive = payloads.main && Object.values(payloads.main).every(v => v === null || v === "");

            if (payloads.departments || payloads.skills || payloads.groups || payloads.supervisor === null || mainIsDestructive) {
                current = await fetchEmployeeDetails(item.employeeId);
                // CRITICAL FIX: If fetch failed, stop immediately to avoid wiping data
                if (!current) {
                    throw new Error("Failed to fetch current details. Aborting to prevent data loss.");
                }
            }
            
            const finalMainPayload = { ...payloads.main };

            if (payloads.departments && definitions?.departments) {
                const deptActions = payloads.departments as any; 
                const currentDepts = (current.departments || []) as number[];
                const finalDepts = new Set<number>();
                let primary = current.primaryDepartmentId;

                definitions.departments.forEach(d => {
                    const action = deptActions[d.id];
                    if (action === 'add' || action === 'primary') {
                        finalDepts.add(d.id);
                        if (action === 'primary') primary = d.id;
                    } else if (action === 'remove') {
                    } else {
                        if (currentDepts.includes(d.id)) finalDepts.add(d.id);
                    }
                });
                
                finalMainPayload.departments = Array.from(finalDepts);
                finalMainPayload.primaryDepartmentId = primary;
            }

            if (payloads.skills && definitions?.skills) {
                const skillActions = payloads.skills as any;
                // Fix: Robustly handle skillIds OR skills array from API
                let currentSkills: number[] = [];
                if (current.skills && Array.isArray(current.skills) && current.skills.length > 0) {
                    currentSkills = current.skills.map((s: any) => parseInt(String(s.id || s.skillId), 10));
                } else if (current.skillIds && Array.isArray(current.skillIds)) {
                    currentSkills = current.skillIds.map((id: any) => parseInt(String(id), 10));
                }

                const finalSkills = new Set<number>();
                
                definitions.skills.forEach(s => {
                    const action = skillActions[s.id];
                    if (action === 'add') finalSkills.add(s.id);
                    else if (action === 'remove') { }
                    else if (currentSkills.includes(s.id)) finalSkills.add(s.id);
                });
                finalMainPayload.skillIds = Array.from(finalSkills);
                finalMainPayload.userName = current.userName; 
            }

            if (payloads.groups && definitions?.employeeGroups) {
                const groupActions = payloads.groups as any;
                const currentGroups = (current.employeeGroups || []) as number[];
                const finalGroups = new Set<number>();

                definitions.employeeGroups.forEach(g => {
                    const action = groupActions[g.id];
                    if (action === 'add') finalGroups.add(g.id);
                    else if (action === 'remove') { }
                    else if (currentGroups.includes(g.id)) finalGroups.add(g.id);
                });
                finalMainPayload.employeeGroups = Array.from(finalGroups);
            }

            // Sequential Update Logic
            
            // 1. Main Update
            if (Object.keys(finalMainPayload).length > 0) {
                // If payload contains ONLY null/empty values (destructive), we pad with FirstName to satisfy API
                if (mainIsDestructive) {
                    let nameToUse = current.firstName;
                    
                    // Fallback to Excel name if current details fetch somehow failed but didn't throw
                    if (!nameToUse) {
                         nameToUse = item.employeeName.split(' ')[0];
                    }
                    
                    finalMainPayload.firstName = nameToUse;
                }

                try {
                    await updateEmployee(item.employeeId, finalMainPayload);
                    updateResults.main = { success: true, message: 'Success' };
                } catch (e: any) {
                    const errMsg = enrichError(e.message);
                    updateResults.main = { success: false, message: errMsg };
                    overallSuccess = false;
                    failureMessages.push(`Main: ${errMsg}`);
                }
            }

            // 2. Supervisor Update (Separate)
            if (item.validationErrors?.supervisor) {
                updateResults.supervisor = { success: false, message: item.validationErrors.supervisor };
                overallSuccess = false;
                failureMessages.push(`Supervisor: ${item.validationErrors.supervisor}`);
            } else if (payloads.pendingSupervisorName) {
                // Skip for Phase 1, marking as pending
                updateResults.supervisor = { success: true, message: 'Pending Creation...' }; 
            } else if (payloads.supervisor !== undefined && payloads.supervisor !== null) {
                try {
                    await updateEmployee(item.employeeId, { supervisorId: payloads.supervisor });
                    updateResults.supervisor = { success: true, message: 'Success' };
                } catch (e: any) {
                    const errMsg = enrichError(e.message);
                    updateResults.supervisor = { success: false, message: errMsg };
                    overallSuccess = false;
                    failureMessages.push(`Supervisor: ${errMsg}`);
                }
            } else if (payloads.supervisor === null) { // Unassign
                 try {
                    // API requires a non-null payload for partial updates in some contexts. 
                    // We pad with firstName (which shouldn't change) to ensure the payload is valid.
                    const payload: any = { supervisorId: null };
                    if (current && current.firstName) {
                        payload.firstName = current.firstName;
                    } else {
                        // Fallback using the name from Excel if current details weren't fetched
                        payload.firstName = item.employeeName.split(' ')[0];
                    }

                    await updateEmployee(item.employeeId, payload);
                    updateResults.supervisor = { success: true, message: 'Success' };
                } catch (e: any) {
                    const errMsg = enrichError(e.message);
                    updateResults.supervisor = { success: false, message: errMsg };
                    overallSuccess = false;
                    failureMessages.push(`Supervisor: ${errMsg}`);
                }
            }

            // 3. Contract Rule
            if (item.validationErrors?.contract) {
                updateResults.contract = { success: false, message: item.validationErrors.contract };
                overallSuccess = false;
                failureMessages.push(`Contract: ${item.validationErrors.contract}`);
            } else if (payloads.contractRule !== undefined) {
                try {
                    await assignContractRule(item.employeeId, payloads.contractRule);
                    updateResults.contract = { success: true, message: 'Success' };
                } catch (e: any) {
                    const errMsg = enrichError(e.message);
                    updateResults.contract = { success: false, message: errMsg };
                    overallSuccess = false;
                    failureMessages.push(`Contract: ${errMsg}`);
                }
            }

            // 4. Username
            if (payloads.username) {
                try {
                    await changeUsername(item.employeeId, payloads.username);
                    updateResults.username = { success: true, message: 'Success' };
                } catch (e: any) {
                    const errMsg = enrichError(e.message);
                    updateResults.username = { success: false, message: errMsg };
                    overallSuccess = false;
                    failureMessages.push(`Username: ${errMsg}`);
                }
            }

            // 5. Fixed Salary
            if (payloads.fixedSalary) {
                try {
                    if (payloads.fixedSalary.isDelete) {
                        await updateFixedSalary(item.employeeId, {} as any, true);
                    } else {
                        await updateFixedSalary(item.employeeId, payloads.fixedSalary.data!, false);
                    }
                    updateResults.salary = { success: true, message: 'Success' };
                } catch (e: any) {
                    const errMsg = enrichError(e.message);
                    updateResults.salary = { success: false, message: errMsg };
                    overallSuccess = false;
                    failureMessages.push(`Salary: ${errMsg}`);
                }
            }

            // 6. Group Rates
            if (payloads.groupRates && payloads.groupRates.length > 0) {
                try {
                    for (const ratePayload of payloads.groupRates) {
                        const payloadWithGroupId = ratePayload as any;
                        if (payloadWithGroupId.groupId) {
                            await updateWageRate(payloadWithGroupId.groupId, ratePayload);
                        }
                    }
                    updateResults.rates = { success: true, message: 'Success' };
                } catch (e: any) {
                    const errMsg = enrichError(e.message);
                    updateResults.rates = { success: false, message: errMsg };
                    overallSuccess = false;
                    failureMessages.push(`Rates: ${errMsg}`);
                }
            }

            item.results = updateResults;
            
            // Determine overall status
            const hasPending = Object.values(updateResults).some((r: any) => r && r.message && r.message.includes('Pending'));
            if (hasPending) {
                 item.status = 'partial'; // Keep as partial/active if pending
            } else if (overallSuccess && failureMessages.length === 0) {
                item.status = 'success';
                item.resultMessage = 'All updates successful';
            } else {
                const anySuccess = Object.values(updateResults).some((r: any) => r && r.success && r.message === 'Success');
                item.status = anySuccess ? 'partial' : 'error';
                item.resultMessage = failureMessages.join('; ');
            }

        } catch (e: any) {
            item.status = 'error';
            item.resultMessage = `Pre-fetch failed: ${enrichError(e.message)}`;
        }

        return item;
    };

    const handleUpdate = async () => {
        if (!rawFileJson) return;

        abortRef.current = false;
        setShowAbortConfirm(false);
        setAbortedCount(0);
        setLiveStats({ success: 0, partial: 0, error: 0, aborted: 0 });

        const valErrors = validateData(rawFileJson);
        if (valErrors.length > 0) {
            setValidationErrors(valErrors);
            setValidationSource('review');
            setCurrentStep('validation_errors');
            setShowConfirmModal(false);
            return;
        }

        setIsLoading(true);
        setCurrentStep('processing');
        setProgress(0);
        setCompletedCount(0); // Reset count

        // Request Wake Lock
        try {
            if ('wakeLock' in navigator) {
                wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
                console.log('Wake Lock active');
            }
        } catch (err) {
            console.warn('Could not acquire wake lock:', err);
        }
        
        const validReviews = reviews.filter(r => r.status !== 'no_updates');
        const queue = [...validReviews]; 
        
        // Calculate total units of work:
        // 1 unit per employee row (Phase 1)
        // 1 additional unit per row that has a pending supervisor resolution (Phase 2)
        const potentialPendingCount = queue.filter(r => r.payloads.pendingSupervisorName).length;
        const totalUnits = queue.length + potentialPendingCount;
        let unitsProcessed = 0;
        
        const tickProgress = () => {
            unitsProcessed++;
            // Calculate percentage based on total units of work
            setProgress(Math.round((unitsProcessed / totalUnits) * 100));
        };

        const worker = async (iterator: IterableIterator<[number, EmployeeUpdateReview]>) => {
            for (const [index, item] of iterator) {
                if (abortRef.current) {
                    item.status = 'aborted';
                    item.resultMessage = 'Aborted by user';
                    queue[index] = item;
                    setAbortedCount(prev => prev + 1);
                    tickProgress(); // 1 unit done
                    setCompletedCount(prev => prev + 1);
                    setLiveStats(prev => ({ ...prev, aborted: (prev.aborted || 0) + 1 }));
                    continue; // Skip processing
                }

                const updatedItem = await processEmployeeUpdate(item);
                queue[index] = updatedItem; 
                
                tickProgress(); // 1 unit done (Phase 1)
                
                // If NO pending supervisor, this row is fully complete visually
                if (!updatedItem.payloads.pendingSupervisorName) {
                    setCompletedCount(prev => prev + 1);
                    setLiveStats(prev => ({
                        ...prev,
                        [updatedItem.status || 'pending']: (prev[(updatedItem.status || 'pending') as keyof typeof prev] || 0) + 1
                    }));
                }
                
                // Add a small delay to prevent browser connection throttling/NetworkErrors
                await new Promise(r => setTimeout(r, 200));
            }
        };

        // PHASE 1: Main Updates
        const CONCURRENCY = 3; 
        const iterator = queue.entries();
        const workers = Array.from({ length: CONCURRENCY }, () => worker(iterator));

        await Promise.all(workers);

        // PHASE 2: Pending Supervisor Resolutions
        const pendingItems = queue.filter(item => item.payloads.pendingSupervisorName && item.results?.supervisor?.message.includes('Pending'));
        
        if (pendingItems.length > 0) {
            setLoadingText("Resolving new supervisors...");
            // Re-fetch supervisors to get new IDs
            let newSupervisors: any[] = [];
            try {
                if (!abortRef.current) {
                    newSupervisors = await fetchPaginatedData('/hr/v1.0/employees/supervisors');
                }
            } catch (e) { console.error("Failed to re-fetch supervisors", e); }

            const newSupervisorMap = new Map(newSupervisors.map((s: any) => [s.name.toLowerCase(), s.id]));

            for (const item of pendingItems) {
                if (abortRef.current) {
                    item.status = 'aborted';
                    item.resultMessage = 'Aborted by user';
                    setAbortedCount(prev => prev + 1);
                    tickProgress();
                    setCompletedCount(prev => prev + 1);
                    setLiveStats(prev => ({ ...prev, aborted: (prev.aborted || 0) + 1 }));
                    continue;
                }

                const name = item.payloads.pendingSupervisorName!.toLowerCase();
                const supId = newSupervisorMap.get(name);
                
                if (supId) {
                    try {
                        await updateEmployee(item.employeeId, { supervisorId: supId });
                        item.results!.supervisor = { success: true, message: 'Success' };
                        // Re-evaluate overall status
                        const failures = Object.values(item.results!).filter((r: any) => r && !r.success);
                        if (failures.length === 0) {
                            item.status = 'success';
                            item.resultMessage = 'All updates successful';
                        } else {
                            const anySuccess = Object.values(item.results!).some((r: any) => r && r.success && r.message === 'Success');
                            item.status = anySuccess ? 'partial' : 'error';
                        }
                    } catch (e: any) {
                        item.results!.supervisor = { success: false, message: `Assign failed: ${enrichError(e.message)}` };
                        item.status = 'partial'; // downgraded
                    }
                } else {
                    item.results!.supervisor = { success: false, message: `New Supervisor '${item.payloads.pendingSupervisorName}' not found after update.` };
                    item.status = 'partial';
                }
                
                tickProgress(); // 1 unit done (Phase 2)
                setCompletedCount(prev => prev + 1); // Row fully complete
                setLiveStats(prev => ({
                    ...prev,
                    [item.status || 'pending']: (prev[(item.status || 'pending') as keyof typeof prev] || 0) + 1
                }));
            }
        }

        // Release Wake Lock
        if (wakeLockRef.current) {
            try {
                await wakeLockRef.current.release();
                wakeLockRef.current = null;
                console.log('Wake Lock released');
            } catch (e) { console.error(e); }
        }

        // Merge back the no_updates reviews
        const finalReviews = reviews.map(r => {
            if (r.status === 'no_updates') return r;
            const processed = queue.find(q => q.employeeId === r.employeeId);
            return processed || r;
        });

        // Re-fetch field definitions just for resolving latest custom fields in errors
        try {
            setLoadingText("Fetching field definitions...");
            const { customFields } = await fetchFieldDefinitions();
            if (definitions) {
                const updatedDefs = { ...definitions, customFields };
                setDefinitions(updatedDefs);

                // Run a pass to enhance all error messages in finalReviews
                for (const r of finalReviews) {
                    if (r.status === 'error' || r.status === 'partial') {
                        r.resultMessage = enrichError(r.resultMessage || '', updatedDefs);
                        if (r.results) {
                            Object.keys(r.results).forEach(k => {
                                if (r.results![k] && !r.results![k].success) {
                                    r.results![k].message = enrichError(r.results![k].message, updatedDefs);
                                }
                            });
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("Could not refetch definitions for error enhancement", e);
        }

        setReviews(finalReviews); 
        
        // Ensure progress bar completes visually
        setProgress(100);
        await new Promise(r => setTimeout(r, 500));

        setIsLoading(false);
        setCurrentStep('summary');
    };

    const handleBackToTable = () => {
        if (rawFileJson) {
            processRows(rawFileJson, ambiguousDates, detectedUSFormat, false);
        }
        setCurrentStep('review');
    };

    const handleExportResults = () => {
        if (!definitions) return;

        // --- Styles ---
        const headerStyle = {
            fill: { fgColor: { rgb: "162C34" } },
            font: { color: { rgb: "FFFFFF" }, bold: true },
            border: {
                top: { style: 'thin', color: { rgb: "D9D9D9" } },
                bottom: { style: 'thin', color: { rgb: "D9D9D9" } },
                left: { style: 'thin', color: { rgb: "D9D9D9" } },
                right: { style: 'thin', color: { rgb: "D9D9D9" } }
            }
        };
        const successStyle = { fill: { fgColor: { rgb: "CAFFCE" } }, border: { top: { style: 'thin', color: { rgb: "D9D9D9" } }, bottom: { style: 'thin', color: { rgb: "D9D9D9" } }, left: { style: 'thin', color: { rgb: "D9D9D9" } }, right: { style: 'thin', color: { rgb: "D9D9D9" } } } };
        const errorStyle = { fill: { fgColor: { rgb: "FFDBCA" } }, border: { top: { style: 'thin', color: { rgb: "D9D9D9" } }, bottom: { style: 'thin', color: { rgb: "D9D9D9" } }, left: { style: 'thin', color: { rgb: "D9D9D9" } }, right: { style: 'thin', color: { rgb: "D9D9D9" } } } };
        const abortedStyle = { fill: { fgColor: { rgb: "FFEAE6" } }, border: { top: { style: 'thin', color: { rgb: "D9D9D9" } }, bottom: { style: 'thin', color: { rgb: "D9D9D9" } }, left: { style: 'thin', color: { rgb: "D9D9D9" } }, right: { style: 'thin', color: { rgb: "D9D9D9" } } } };
        const partialStyle = { fill: { fgColor: { rgb: "FFFDAC" } }, border: { top: { style: 'thin', color: { rgb: "D9D9D9" } }, bottom: { style: 'thin', color: { rgb: "D9D9D9" } }, left: { style: 'thin', color: { rgb: "D9D9D9" } }, right: { style: 'thin', color: { rgb: "D9D9D9" } } } };
        const boldDeleteStyle = { font: { bold: true } };
        const fireErrorStyle = { 
            fill: { fgColor: { rgb: "FF3333" } }, 
            font: { color: { rgb: "FFFFFF" }, bold: true },
            border: { top: { style: 'thin', color: { rgb: "D9D9D9" } }, bottom: { style: 'thin', color: { rgb: "D9D9D9" } }, left: { style: 'thin', color: { rgb: "D9D9D9" } }, right: { style: 'thin', color: { rgb: "D9D9D9" } } } 
        };

        // Text Styles for Status Columns
        const textSuccessStyle = { font: { bold: true, color: { rgb: "006400" } } };
        const textSkippedStyle = { font: { italic: true, color: { rgb: "666666" } } };
        const textErrorStyle = { font: { bold: true, color: { rgb: "8B0000" } } };
        const textAbortedStyle = { font: { bold: true, color: { rgb: "FF8C8C" } } };

        // --- HR Field Mapping ---
        const fieldToApiMap: Record<string, string[]> = {
            'sys_email': ['Email'],
            'sys_jobTitle': ['JobTitle'],
            'sys_birthDate': ['BirthDate'],
            'sys_gender': ['Gender'],
            'sys_ssn': ['Ssn', 'TaxId'],
            'sys_street1': ['Street1'],
            'sys_street2': ['Street2'],
            'sys_zip': ['Zip', 'ZipCode'],
            'sys_city': ['City'],
            'sys_cellPhoneCountryCode': ['CellPhoneCountryCode', 'PhoneCountryCode'],
            'sys_cellPhone': ['CellPhone', 'Mobile', 'Phone'],
            'sys_hiredFrom': ['HiredFrom', 'HiredDate'],
            'sys_salaryIdentifier': ['SalaryIdentifier'],
            'sys_employeeTypeId': ['EmployeeTypeId'],
            'sys_bankReg': ['RegistrationNumber', 'BankAccount.RegistrationNumber'],
            'sys_bankAcc': ['AccountNumber', 'BankAccount.AccountNumber'],
        };

        const wb = XLSX.utils.book_new();

        // --- SHEET 1: Update Results (Summary) ---
        const headers1 = [
            "Employee Name", 
            "Overall Status", 
            "Result Message", 
            "HR Fields Status",
            "Supervisor Status", 
            "Contract Rule Status",
            "Wages & Salaries Status"
        ];
        
        const data1 = reviews.map(r => {
            const res = r.results || {};
            let statusText = 'Failed';
            if (r.status === 'success') statusText = 'Success';
            else if (r.status === 'partial') statusText = 'Partial Success';
            else if (r.status === 'aborted') statusText = 'Aborted';

            // HR Fields
            let hrStatus = 'Skipped';
            const mainActive = res.main && res.main.message !== 'Skipped';
            const userActive = res.username && res.username.message !== 'Skipped';
            if (mainActive || userActive) {
                const errs = [];
                if (res.main && !res.main.success) errs.push(`${res.main.message}`);
                if (res.username && !res.username.success) errs.push(`Username: ${res.username.message}`);
                hrStatus = errs.length > 0 ? errs.join('; ') : 'Success';
            }

            // Supervisor
            let supStatus = 'Skipped';
            if (res.supervisor && res.supervisor.message !== 'Skipped') {
                supStatus = res.supervisor.message;
            }

            // Contract
            let conStatus = 'Skipped';
            if (res.contract && res.contract.message !== 'Skipped') {
                conStatus = res.contract.message;
            }

            // Wages & Salaries
            let wsStatus = 'Skipped';
            const salActive = res.salary && res.salary.message !== 'Skipped';
            const ratesActive = res.rates && res.rates.message !== 'Skipped';
            if (salActive || ratesActive) {
                const errs = [];
                if (res.salary && !res.salary.success) errs.push(`Salary: ${res.salary.message}`);
                if (res.rates && !res.rates.success) errs.push(`Wages: ${res.rates.message}`);
                wsStatus = errs.length > 0 ? errs.join('; ') : 'Success';
            }

            return {
                "Employee Name": r.employeeName,
                "Overall Status": statusText,
                "Result Message": r.resultMessage || '',
                "HR Fields Status": hrStatus,
                "Supervisor Status": supStatus,
                "Contract Rule Status": conStatus,
                "Wages & Salaries Status": wsStatus
            };
        });

        const ws1 = XLSX.utils.json_to_sheet(data1, { header: headers1 });
        
        // Styling Sheet 1
        const range1 = XLSX.utils.decode_range(ws1['!ref']);
        
        // Header Row Style
        for (let C = range1.s.c; C <= range1.e.c; ++C) {
            const cellRef = XLSX.utils.encode_cell({ r: 0, c: C });
            if (!ws1[cellRef]) ws1[cellRef] = { v: "" };
            ws1[cellRef].s = headerStyle;
        }

        // Data Rows Style
        for (let R = 1; R <= range1.e.r; ++R) {
            // Overall Status is now index 1 (was 2)
            const statusRef = XLSX.utils.encode_cell({ r: R, c: 1 });
            const cell = ws1[statusRef];
            if (cell) {
                if (cell.v === 'Success') cell.s = successStyle;
                else if (cell.v === 'Partial Success') cell.s = partialStyle;
                else if (cell.v === 'Failed') cell.s = errorStyle;
                else if (cell.v === 'Aborted') cell.s = abortedStyle;
            }

            // Text Styles for specific columns (Indices: 3, 4, 5, 6)
            [3, 4, 5, 6].forEach(C => {
                const ref = XLSX.utils.encode_cell({ r: R, c: C });
                const c = ws1[ref];
                if (c) {
                    if (c.v === 'Success') c.s = textSuccessStyle;
                    else if (c.v === 'Skipped') c.s = textSkippedStyle;
                    else if (c.v === 'Aborted') c.s = textAbortedStyle;
                    else c.s = textErrorStyle;
                }
            });
        }
        ws1['!cols'] = headers1.map(() => ({ wch: 25 }));
        XLSX.utils.book_append_sheet(wb, ws1, "Update Results");


        // --- SHEET 2: Fields Updated ---

        // 1. Identify all columns used across all reviews
        const usedKeys = new Set<string>();
        reviews.forEach(r => {
            if (r.payloads.main) {
                Object.keys(r.payloads.main).forEach(k => {
                    if (['departments', 'skillIds', 'employeeGroups', 'userName'].includes(k)) return; // Handled separately
                    if (k === 'bankAccount') { usedKeys.add('sys_bankReg'); usedKeys.add('sys_bankAcc'); return; }
                    usedKeys.add(`sys_${k}`);
                });
                // Check if main has array updates
                if (r.payloads.main.departments) r.payloads.main.departments.forEach((id: number) => usedKeys.add(`dept_${id}`));
                if (r.payloads.main.skillIds) r.payloads.main.skillIds.forEach((id: number) => usedKeys.add(`skill_${id}`));
                // if (r.payloads.main.employeeGroups) r.payloads.main.employeeGroups.forEach((id: number) => usedKeys.add(`group_${id}`)); // Removed Group membership tracking in export
            }
            // Other payloads
            if (r.payloads.departments) Object.keys(r.payloads.departments).forEach(id => { if(id !== 'departments' && id !== 'primaryDepartmentId') usedKeys.add(`dept_${id}`); });
            if (r.payloads.skills) Object.keys(r.payloads.skills).forEach(id => { if(id !== 'skillIds' && id !== 'userName') usedKeys.add(`skill_${id}`); });
            // if (r.payloads.groups) Object.keys(r.payloads.groups).forEach(id => { if(id !== 'employeeGroups') usedKeys.add(`group_${id}`); // Removed Group membership tracking in export

            if (r.payloads.contractRule !== undefined) usedKeys.add('contract');
            if (r.payloads.supervisor !== undefined || r.payloads.pendingSupervisorName) usedKeys.add('supervisor');
            if (r.payloads.fixedSalary) {
                usedKeys.add('salary_period');
                usedKeys.add('salary_hours');
                usedKeys.add('salary_amount');
                usedKeys.add('salary_code');
                usedKeys.add('salary_from');
            }
            if (r.payloads.groupRates) {
                r.payloads.groupRates.forEach((gr: any) => {
                    if(gr.groupId) usedKeys.add(`rate_${gr.groupId}`);
                });
            }
        });

        // 2. Map Keys to Headers (Ordered)
        const sysMap: any = {
            'sys_email': 'Email', 'sys_jobTitle': 'Job Title', 'sys_birthDate': 'Birth Date', 
            'sys_gender': 'Gender', 'sys_ssn': 'Tax ID', 'sys_street1': 'Street 1', 'sys_street2': 'Street 2',
            'sys_zip': 'Zip', 'sys_city': 'City', 'sys_cellPhoneCountryCode': 'Country Code', 'sys_cellPhone': 'Mobile',
            'sys_hiredFrom': 'Start Date', 'sys_salaryIdentifier': 'Salary Identifier', 'sys_employeeTypeId': 'Employee Type',
            'sys_bankReg': 'Bank Reg', 'sys_bankAcc': 'Bank Account'
        };

        const colDefs: { key: string, label: string }[] = [];
        
        // 1. System
        Object.keys(sysMap).forEach(k => { if(usedKeys.has(k)) colDefs.push({ key: k, label: sysMap[k] }); });
        
        // 2. Custom Fields
        definitions.customFields.forEach(f => {
            const k = `sys_${f.originalName}`;
            if(usedKeys.has(k)) colDefs.push({ key: k, label: f.description });
        });

        // 3. Supervisors
        if(usedKeys.has('sys_isSupervisor')) colDefs.push({ key: 'sys_isSupervisor', label: 'Is Supervisor' });
        if(usedKeys.has('supervisor')) colDefs.push({ key: 'supervisor', label: 'Assign Supervisor' });

        // 4. Contract Rule
        if(usedKeys.has('contract')) colDefs.push({ key: 'contract', label: 'Contract Rule' });

        // 5. Salaries
        if(usedKeys.has('salary_period')) colDefs.push({ key: 'salary_period', label: 'Fixed Salary - Period' });
        if(usedKeys.has('salary_hours')) colDefs.push({ key: 'salary_hours', label: 'Fixed Salary - Hours' });
        if(usedKeys.has('salary_amount')) colDefs.push({ key: 'salary_amount', label: 'Fixed Salary - Amount' });
        if(usedKeys.has('salary_code')) colDefs.push({ key: 'salary_code', label: 'Fixed Salary - Code' });
        if(usedKeys.has('salary_from')) colDefs.push({ key: 'salary_from', label: 'Fixed Salary - From' });

        // 6. Skills
        definitions.skills.forEach(s => {
            const k = `skill_${s.id}`;
            if(usedKeys.has(k)) colDefs.push({ key: k, label: `Skill - ${s.name}` });
        });

        // 7. Departments
        definitions.departments.forEach(d => {
            const k = `dept_${d.id}`;
            if(usedKeys.has(k)) colDefs.push({ key: k, label: `Department - ${d.name}` });
        });

        // 8. Group Rates ONLY (Removed Group Memberships)
        definitions.employeeGroups.forEach(g => {
            const k = `rate_${g.id}`;
            if(usedKeys.has(k)) colDefs.push({ key: k, label: `Group Rate - ${g.name}` });
        });

        // 3. Build Sheet 2 Rows
        const sheet2Rows: any[][] = [];
        
        // Header Row (Removed ID)
        const headerRow = [
            { v: "Date", s: headerStyle },
            // { v: "Planday Employee ID", s: headerStyle }, // Removed
            { v: "First Name", s: headerStyle },
            { v: "Last Name", s: headerStyle },
            ...colDefs.map(c => ({ v: c.label, s: headerStyle }))
        ];
        sheet2Rows.push(headerRow);

        const execTime = new Date().toLocaleString();

        reviews.forEach(r => {
            const row: any[] = [];
            row.push({ v: execTime });
            // row.push({ v: r.employeeId }); // Removed
            const nameParts = r.employeeName.split(' ');
            row.push({ v: nameParts[0] });
            row.push({ v: nameParts.slice(1).join(' ') });

            const mainRes: UpdateActionResult = r.results?.main || { success: true, message: '' };

            colDefs.forEach(def => {
                let cellVal = "";
                let isBold = false;
                let isError = false;
                let errorMsg = "";
                let isSpecificFieldFailure = false;
                
                // Determine Value and Status based on payload key type
                if (def.key.startsWith('sys_')) {
                    const field = def.key.replace('sys_', '');
                    if (r.payloads.main && (field in r.payloads.main || (field === 'bankReg' && r.payloads.main.bankAccount) || (field === 'bankAcc' && r.payloads.main.bankAccount))) {
                        if (!mainRes.success) { 
                            isError = true; 
                            errorMsg = mainRes.message;

                            // Check if specific error targets this field
                            const errorString = mainRes.message.toLowerCase();
                            // Standard fields
                            const apiKeys = fieldToApiMap[def.key];
                            if (apiKeys && apiKeys.some(k => errorString.includes(k.toLowerCase()))) {
                                isSpecificFieldFailure = true;
                            }
                            
                            // Custom fields
                            if (!apiKeys && errorString.includes(field.toLowerCase())) {
                                isSpecificFieldFailure = true;
                            }
                        }
                        
                        let raw = r.payloads.main[field];
                        // Bank Account specifics
                        if (field === 'bankReg') raw = r.payloads.main.bankAccount?.registrationNumber;
                        if (field === 'bankAcc') raw = r.payloads.main.bankAccount?.accountNumber;

                        if (raw === "" || raw === null) { cellVal = "REMOVE"; isBold = true; }
                        else if (field === 'isSupervisor') { 
                            if (raw === false) { cellVal = "REMOVE"; isBold = true; } 
                            else cellVal = "x";
                        }
                        else if (field === 'employeeTypeId') {
                            // Map ID to Name
                            const typeId = parseInt(raw);
                            const typeObj = definitions.employeeTypes.find(t => t.id === typeId);
                            cellVal = typeObj ? typeObj.name : String(raw);
                        }
                        else if (typeof raw === 'boolean') { cellVal = raw ? "x" : "REMOVE"; if(!raw) isBold = true; }
                        else cellVal = String(raw);
                    }
                }
                else if (def.key.startsWith('dept_')) {
                    const id = def.key.split('_')[1];
                    const action = (r.payloads.departments as any)?.[id];
                    if (action) {
                        if (!mainRes.success) { isError = true; errorMsg = mainRes.message; }
                        if (action === 'remove') { cellVal = "REMOVE"; isBold = true; }
                        else if (action === 'primary') cellVal = "xx";
                        else cellVal = "x";
                    }
                }
                else if (def.key.startsWith('skill_')) {
                    const id = def.key.split('_')[1];
                    const action = (r.payloads.skills as any)?.[id];
                    if (action) {
                        if (!mainRes.success) { isError = true; errorMsg = mainRes.message; }
                        if (action === 'remove') { cellVal = "REMOVE"; isBold = true; }
                        else cellVal = "x";
                    }
                }
                // Removed group_ logic
                else if (def.key === 'contract') {
                    if (r.payloads.contractRule !== undefined) {
                        const res = r.results?.contract;
                        if (res && !res.success) { isError = true; errorMsg = res.message; }
                        
                        if (r.payloads.contractRule === null) { cellVal = "REMOVE"; isBold = true; }
                        else {
                            const cr = definitions.contractRules.find(x => x.id === r.payloads.contractRule);
                            cellVal = cr ? cr.name : String(r.payloads.contractRule);
                        }
                    }
                }
                else if (def.key === 'supervisor') {
                    if (r.payloads.supervisor !== undefined || r.payloads.pendingSupervisorName) {
                        const res = r.results?.supervisor;
                        if (res && !res.success) { isError = true; errorMsg = res.message; }

                        if (r.payloads.pendingSupervisorName) cellVal = r.payloads.pendingSupervisorName;
                        else if (r.payloads.supervisor === null) { cellVal = "REMOVE"; isBold = true; }
                        else {
                            const s = definitions.supervisors.find(x => x.id === r.payloads.supervisor);
                            cellVal = s ? s.name : String(r.payloads.supervisor);
                        }
                    }
                }
                else if (def.key.startsWith('salary_')) {
                    if (r.payloads.fixedSalary) {
                        const res = r.results?.salary;
                        if (res && !res.success) { isError = true; errorMsg = res.message; }

                        if (r.payloads.fixedSalary.isDelete) { cellVal = "REMOVE"; isBold = true; }
                        else if (r.payloads.fixedSalary.data) {
                            const d = r.payloads.fixedSalary.data;
                            const sub = def.key.split('_')[1];
                            if (sub === 'period') { const t = definitions.salaryTypes.find(x => x.id === d.salaryTypeId); cellVal = t ? t.name : String(d.salaryTypeId); }
                            if (sub === 'hours') cellVal = String(d.hours);
                            if (sub === 'amount') cellVal = String(d.salary);
                            if (sub === 'code') cellVal = d.salaryCode || "";
                            if (sub === 'from') cellVal = d.from;
                        }
                    }
                }
                else if (def.key.startsWith('rate_')) {
                    const id = parseInt(def.key.split('_')[1]);
                    const item = r.payloads.groupRates?.find((x: any) => x.groupId === id);
                    if (item) {
                        const res = r.results?.rates;
                        if (res && !res.success) { isError = true; errorMsg = res.message; }
                        
                        cellVal = `${item.rate} (${item.wageType})`;
                        if (item.salaryCode) cellVal += ` Code: ${item.salaryCode}`;
                    }
                }

                // Construct Cell
                if (cellVal === "" && !isError) {
                    row.push({ v: "" });
                } else {
                    const cell: any = { v: cellVal };
                    let baseStyle = successStyle;
                    
                    if (r.status === 'aborted') {
                        baseStyle = abortedStyle;
                    } else if (isError) {
                         baseStyle = errorStyle;
                         cell.v = `ERROR: ${errorMsg}`;
                         
                         // Apply Fire Red style if matched
                         if (isSpecificFieldFailure) {
                             baseStyle = fireErrorStyle;
                         }
                    }
                    
                    // If bold is needed for remove/boolean but it's not a fire error, apply bold
                    if (isBold && !isSpecificFieldFailure) {
                        baseStyle = { ...baseStyle, ...boldDeleteStyle };
                    }

                    cell.s = baseStyle;
                    row.push(cell);
                }
            });
            sheet2Rows.push(row);
        });

        // Convert Rows to Sheet
        const ws2 = XLSX.utils.aoa_to_sheet([]);
        sheet2Rows.forEach((row, rowIndex) => {
            row.forEach((cell, colIndex) => {
                const ref = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
                ws2[ref] = cell;
            });
        });
        ws2['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sheet2Rows.length - 1, c: headerRow.length - 1 } });
        ws2['!cols'] = headerRow.map(() => ({ wch: 20 }));

        XLSX.utils.book_append_sheet(wb, ws2, "Fields Updated");
        XLSX.writeFile(wb, "Planday_Update_Results.xlsx");
    };

    const allEmployeesMap = useMemo(() => {
        const map = new Map<number, Employee>();
        allEmployees.forEach(e => map.set(e.id, e));
        return map;
    }, [allEmployees]);

    const rawFileJsonMap = useMemo(() => {
        const map = new Map<number, { index: number; data: any }>();
        rawFileJson?.forEach((row: any, index: number) => {
            const empId = parseInt(row["Planday Employee ID"]);
            if (!isNaN(empId)) {
                map.set(empId, { index, data: row });
            }
        });
        return map;
    }, [rawFileJson]);



    useEffect(() => {
        setCurrentPage(1);
    }, [searchReview, filterDepartment, filterGroup, filterType]);

    const getUpdateColumns = useMemo(() => {
        const cols = new Set<string>();
        let hasFixedSalary = false;
        const groupsSeen = new Set<string>();

        if (rawFileJson) {
            rawFileJson.forEach((row: any) => {
                Object.keys(row).forEach(key => {
                    if (key.startsWith("UPDATE - ")) {
                       const val = row[key];
                       if ((val !== undefined && val !== null && String(val).trim() !== "") || explicitAddedCols.has(key)) {
                           cols.add(key);

                           const lowerKey = key.toLowerCase();
                           if (lowerKey.includes("fixed salary")) hasFixedSalary = true;
                           if (lowerKey.includes("update - group ")) {
                               const cleanKey = key.substring(9).trim();
                               const parts = cleanKey.split(" - ");
                               if (parts.length > 1) {
                                   groupsSeen.add(parts.slice(1).join(" - "));
                               }
                           }
                       }
                    }
                });
            });
        }
        explicitAddedCols.forEach(col => {
            cols.add(col);
            const lowerKey = col.toLowerCase();
            if (lowerKey.includes("fixed salary")) hasFixedSalary = true;
            if (lowerKey.includes("update - group ")) {
                const cleanKey = col.substring(9).trim();
                const parts = cleanKey.split(" - ");
                if (parts.length > 1) {
                    groupsSeen.add(parts.slice(1).join(" - "));
                }
            }
        });

        if (hasFixedSalary) {
            cols.add("UPDATE - Fixed Salary - Period");
            cols.add("UPDATE - Fixed Salary - Expected working hours");
            cols.add("UPDATE - Fixed Salary - Amount");
            cols.add("UPDATE - Fixed Salary - Salary Code");
            cols.add("UPDATE - Fixed Salary - valid from");
        }

        groupsSeen.forEach(gName => {
            cols.add(`UPDATE - Group Rate - ${gName}`);
            cols.add(`UPDATE - Group Wage Type - ${gName}`);
            cols.add(`UPDATE - Group Valid From - ${gName}`);
            cols.add(`UPDATE - Group Salary Code - ${gName}`);
        });
        
        const arr = Array.from(cols);
        arr.sort((a, b) => {
            const aClean = a.replace("UPDATE - ", "");
            const bClean = b.replace("UPDATE - ", "");
            
            const systemFields = [
                "Email", "Birth Date", "Gender", "Tax ID", "Street 1", "Street 2", "Zip", "City", 
                "Country Code", "Mobile", "Start/hired Date", "jobTitle", "Employee Type", 
                "System Bank Reg", "System Bank Account Nr", "Salary Identifier (Payroll ID)"
            ];

            const getGroup = (str: string) => {
                const sysIdx = systemFields.indexOf(str);
                if (sysIdx !== -1) return `01_System_${sysIdx.toString().padStart(2, '0')}`;
                if (str === "Is Supervisor") return "03_Supervisor_0";
                if (str === "Assign Supervisor") return "03_Supervisor_1";
                if (str === "Contract Rule") return "04_Contract";
                if (str.startsWith("Fixed Salary")) return "05_FixedSalary";
                if (str.startsWith("Skill - ")) return "06_Skills_" + str;
                if (str.startsWith("Department - ")) return "07_Departments_" + str;
                if (str.startsWith("Group ")) {
                    const parts = str.split(" - ");
                    if (parts.length > 1) return `08_Group_${parts.slice(1).join(" - ")}`;
                }
                return "02_Custom_" + str;
            };

            const aGroup = getGroup(aClean);
            const bGroup = getGroup(bClean);

            if (aGroup !== bGroup) return aGroup.localeCompare(bGroup);
            
            if (aGroup === "05_FixedSalary") {
                const parts = ["Fixed Salary - Period", "Fixed Salary - Expected working hours", "Fixed Salary - Amount", "Fixed Salary - Salary Code", "Fixed Salary - valid from"];
                return parts.indexOf(aClean) - parts.indexOf(bClean);
            }
            if (aGroup.startsWith("08_Group_")) {
                const gName = aGroup.replace("08_Group_", "");
                const parts = [`Group Rate - ${gName}`, `Group Wage Type - ${gName}`, `Group Valid From - ${gName}`, `Group Salary Code - ${gName}`];
                return parts.indexOf(aClean) - parts.indexOf(bClean);
            }
            return aClean.localeCompare(bClean);
        });
        return arr;
    }, [rawFileJson, explicitAddedCols]);

    const dateColumns = useMemo(() => {
        const cols = new Set<string>();
        if (!definitions || !getUpdateColumns.length) return cols;
        const customFieldMap = new Map<string, FieldDefinition>(definitions.customFields.map(f => [f.description.toLowerCase(), f] as [string, FieldDefinition]));
        
        getUpdateColumns.forEach(col => {
            const headerName = col.replace("UPDATE - ", "").trim().toLowerCase();
            if (headerName.includes('birth date') || headerName.includes('start/hired date') || headerName.includes('valid from')) {
                cols.add(col);
            } else {
                const customDef = customFieldMap.get(headerName);
                if (customDef && customDef.type === 'Date') {
                    cols.add(col);
                }
            }
        });
        return cols;
    }, [definitions, getUpdateColumns]);

    const columnMeta = useMemo(() => {
        const meta: Record<string, { config: ReturnType<typeof getFieldConfig>, bgColor: string, isMissingInPortal: boolean }> = {};
        
        // Pre-compute array unique lookups once to avoid O(N^2) calculations per cell
        const allDepts = Array.from(new Set(
            getUpdateColumns
                .filter(c => c.toLowerCase().startsWith("update - department - "))
                .map(c => c.replace("UPDATE - ", "").toLowerCase().trim().replace("department - ", "").trim())
        ));
        const allSkills = Array.from(new Set(
            getUpdateColumns
                .filter(c => c.toLowerCase().startsWith("update - skill - "))
                .map(c => c.replace("UPDATE - ", "").toLowerCase().trim().replace("skill - ", "").trim())
        ));
        const allGroups = Array.from(new Set(
            getUpdateColumns
                .filter(c => c.toLowerCase().startsWith("update - group "))
                .map(c => {
                    const clean = c.replace("UPDATE - ", "").toLowerCase().trim();
                    const parts = clean.split(" - ");
                    return parts.length > 1 ? parts.slice(1).join(" - ").trim() : clean;
                })
        ));

        getUpdateColumns.forEach(col => {
            const cleanTitle = col.replace("UPDATE - ", "");
            const config = getFieldConfig(cleanTitle, definitions);
            
            const name = cleanTitle.toLowerCase().trim();
            let bgColor = "bg-[#dee6f0]";
            let isMissingInPortal = false;
            
            if (definitions) {
                if (name.startsWith("department - ")) {
                    const dName = name.replace("department - ", "").trim();
                    if (!definitions.departments.some(d => d.name.trim().toLowerCase() === dName)) isMissingInPortal = true;
                } else if (name.startsWith("skill - ")) {
                    const sName = name.replace("skill - ", "").trim();
                    if (!definitions.skills.some(s => s.name.trim().toLowerCase() === sName)) isMissingInPortal = true;
                } else if (name.startsWith("group ")) {
                    const parts = name.split(" - ");
                    if (parts.length > 1) {
                        const gName = parts.slice(1).join(" - ").trim();
                        if (!definitions.employeeGroups.some(g => g.name.trim().toLowerCase() === gName)) isMissingInPortal = true;
                    }
                } else if (!name.startsWith("fixed salary") && !name.startsWith("group rate - ") && !name.startsWith("group wage type - ") && !name.startsWith("group valid from - ") && !name.startsWith("group salary code - ") && !["salary identifier (payroll id)", "email", "birth date", "gender", "tax id", "street 1", "street 2", "zip", "city", "country code", "mobile", "start/hired date", "job title", "jobtitle", "employee type", "system bank reg", "system bank account nr", "contract rule", "assign supervisor", "is supervisor", "is supervisor (x)"].includes(name)) {
                    if (!definitions.customFields.some(f => f.description.trim().toLowerCase() === name)) isMissingInPortal = true;
                }
            }

            if (name.startsWith("fixed salary")) {
                bgColor = "bg-[#D9DAF0]";
            } else if (name.startsWith("department - ")) {
                bgColor = allDepts.indexOf(name.replace("department - ", "").trim()) % 2 === 0 ? "bg-[#d0def0]" : "bg-[#DEEDF2]";
            } else if (name.startsWith("skill - ")) {
                bgColor = allSkills.indexOf(name.replace("skill - ", "").trim()) % 2 === 0 ? "bg-[#d0def0]" : "bg-[#DEEDF2]";
            } else if (name.startsWith("group ")) {
                const parts = name.split(" - ");
                if (parts.length > 1) {
                    const groupName = parts.slice(1).join(" - ").trim();
                    bgColor = allGroups.indexOf(groupName) % 2 === 0 ? "bg-[#d0def0]" : "bg-[#DEEDF2]";
                }
            }
            
            meta[col] = { config, bgColor, isMissingInPortal };
        });
        
        return meta;
    }, [getUpdateColumns, definitions]);

    const [editorErrors, setEditorErrors] = useState<ValidationError[]>([]);
    const [editorFocusedCell, setEditorFocusedCell] = useState<{id: number, col: string} | null>(null);

    const stableOnCellFocus = useCallback((id: number, col: string) => setEditorFocusedCell({id, col}), []);
    const stableOnCellBlur = useCallback((id: number, col: string) => setEditorFocusedCell(null), []);

    useEffect(() => {
        if (currentStep !== 'review' || !rawFileJson || !updateMethod) return;
        if (editorFocusedCell) return;
        const timer = setTimeout(() => {
             const errors = validateData(rawFileJson);
             setEditorErrors(errors);
        }, 500);
        return () => clearTimeout(timer);
    }, [rawFileJson, currentStep, definitions, editorFocusedCell]);

    const editorErrorsMap = useMemo(() => {
        const map: Record<number, Record<string, string>> = {}; 
        if (!rawFileJson) return map;
        
        // Populate standard validation errors
        editorErrors.forEach(err => {
            if (err.fullKey && err.rawRowIndex !== undefined && rawFileJson[err.rawRowIndex]) {
               const empId = parseInt(rawFileJson[err.rawRowIndex]["Planday Employee ID"]);
               if (!isNaN(empId)) {
                   if (!map[empId]) map[empId] = {};
                   const colKeys = err.fullKey === 'FIXED_SALARY_MISSING' 
                        ? ['UPDATE - Fixed Salary - Period', 'UPDATE - Fixed Salary - Expected working hours', 'UPDATE - Fixed Salary - Amount'] 
                        : err.fullKey.startsWith('GROUP_MISSING_') 
                            ? [`UPDATE - Group Rate - ${err.fullKey.replace('GROUP_MISSING_', '')}`, `UPDATE - Group Wage Type - ${err.fullKey.replace('GROUP_MISSING_', '')}`]
                            : [err.fullKey];
                   
                   colKeys.forEach(k => {
                       map[empId][k] = err.allowed.join(' or ');
                   });
               }
            }
        });

        // Add date format errors (Must be a resolvable date)
        rawFileJson.forEach((row, rowIndex) => {
            const empId = parseInt(row["Planday Employee ID"]);
            if (!isNaN(empId)) {
                for (const col of getUpdateColumns) {
                    if (dateColumns.has(col)) {
                        const val = row[col];
                        if (val && String(val).trim()) {
                            const correctionKey = `${rowIndex}-${col}`;
                            const ambiguousMatch = ambiguousDates.find(a => a.id === correctionKey);
                            const correctedYear = ambiguousMatch ? ambiguousMatch.selectedCentury + ambiguousMatch.year2Digit : undefined;
                            
                            const parsed = parseDateWithFormat(val, detectedUSFormat, correctedYear);
                            if (!parsed) {
                                if (!map[empId]) map[empId] = {};
                                map[empId][col] = "Must be a valid date format (e.g. YYYY-MM-DD)";
                            }
                        }
                    }
                }
            }
        });

        return map;
    }, [editorErrors, rawFileJson, getUpdateColumns, dateColumns, ambiguousDates, detectedUSFormat]);
    
    const totalIssuesCount = useMemo(() => {
        let count = 0;
        Object.values(editorErrorsMap).forEach(v => count += Object.keys(v).length);
        return count;
    }, [editorErrorsMap]);

    const filteredReviews = useMemo(() => {
        return reviews.filter(r => {
            if (showOnlyIssues) {
                const hasIssues = editorErrorsMap[r.employeeId] && Object.keys(editorErrorsMap[r.employeeId]).length > 0;
                if (!hasIssues) return false;
            }

            if (searchReview && !r.employeeName.toLowerCase().includes(searchReview.toLowerCase())) return false;
            
            const emp = allEmployeesMap.get(r.employeeId);
            if (emp) {
                if (filterPrimaryDepartment) {
                    const primDept = (emp as any).primaryDepartmentId;
                    if (!primDept) return false;
                    if (filterDepartment.length > 0 && !filterDepartment.includes(primDept)) return false;
                } else {
                    const deps = (emp as any).departments || emp.departmentIds || [];
                    if (filterDepartment.length > 0 && !filterDepartment.some(d => deps.includes(d))) return false;
                }
                
                const groups = (emp as any).employeeGroups || emp.employeeGroupIds || [];
                if (filterGroup.length > 0 && !filterGroup.some(g => groups.includes(g))) return false;
                
                if (filterType.length > 0 && !filterType.includes(emp.employeeTypeId || -1)) return false;
            } else if (filterDepartment.length > 0 || filterGroup.length > 0 || filterType.length > 0) {
                return false;
            }
            
            return true;
        });
    }, [reviews, searchReview, filterDepartment, filterPrimaryDepartment, filterGroup, filterType, allEmployeesMap, showOnlyIssues, editorErrorsMap, rawFileJson, getUpdateColumns, dateColumns]);

    const paginatedReviews = useMemo(() => {
        const actualRowsPerPage = rowsPerPage === 'ALL' ? Math.max(1, filteredReviews.length) : rowsPerPage;
        const start = (currentPage - 1) * actualRowsPerPage;
        return filteredReviews.slice(start, start + actualRowsPerPage);
    }, [filteredReviews, currentPage, rowsPerPage]);

    const totalPages = Math.max(1, Math.ceil(filteredReviews.length / (rowsPerPage === 'ALL' ? Math.max(1, filteredReviews.length) : rowsPerPage)));

    const handleCellEdit = (employeeId: number, colKey: string, newValue: string) => {
        if (!rawFileJson) return;
        const newFileJson = JSON.parse(JSON.stringify(rawFileJson));
        const rowIndex = newFileJson.findIndex((r: any) => parseInt(r["Planday Employee ID"]) === employeeId);
        if (rowIndex > -1) {
            newFileJson[rowIndex] = { ...newFileJson[rowIndex], [colKey]: newValue };
            recordChange(newFileJson, explicitAddedCols);
        }
    };

    const handleClearTable = () => {
        recordChange([], new Set());
        setCurrentPage(1);
        setShowClearTableConfirm(false);
    };

    const handleRemoveSelected = () => {
        if (!rawFileJson || selectedReviewIds.size === 0) return;
        
        const newFileJson = rawFileJson.filter(row => {
            const empId = parseInt(row["Planday Employee ID"]);
            return !selectedReviewIds.has(empId);
        });
        
        recordChange(newFileJson, explicitAddedCols);
        setSelectedReviewIds(new Set());
        setShowRemoveSelectedConfirm(false);
    };

    const executeRemoveColumn = (colKey: string) => {
        let colsToRemove = [colKey];
        const lowerKey = colKey.toLowerCase();
        
        if (lowerKey.includes("fixed salary")) {
            colsToRemove = [
                "UPDATE - Fixed Salary - Period",
                "UPDATE - Fixed Salary - Expected working hours",
                "UPDATE - Fixed Salary - Amount",
                "UPDATE - Fixed Salary - Salary Code",
                "UPDATE - Fixed Salary - valid from"
            ];
        } else if (lowerKey.includes("update - group ")) {
            const cleanKey = colKey.substring(9).trim();
            const parts = cleanKey.split(" - ");
            if (parts.length > 1) {
                const groupName = parts.slice(1).join(" - ");
                colsToRemove = [
                    `UPDATE - Group Rate - ${groupName}`,
                    `UPDATE - Group Wage Type - ${groupName}`,
                    `UPDATE - Group Valid From - ${groupName}`,
                    `UPDATE - Group Salary Code - ${groupName}`
                ];
            }
        }

        const newExplicit = new Set<string>(explicitAddedCols);
        colsToRemove.forEach(c => newExplicit.delete(c));
        setExplicitAddedCols(newExplicit);
        
        if (rawFileJson) {
            const newJson = rawFileJson.map((row) => {
                const newRow = { ...row };
                colsToRemove.forEach(c => delete newRow[c]);
                return newRow;
            });
            recordChange(newJson, newExplicit);
        } else {
            setExplicitAddedCols(newExplicit);
        }
    };

    const handleAddField = (fieldKey: string) => {
        if (!rawFileJson || !fieldKey || !definitions) return;
        
        let fieldsToAdd: string[] = [];

        if (fieldKey === "ALL_HR_FIELDS") {
            const targets = generateTargetFields(definitions);
            targets.forEach(t => {
                if (['ALL_DEPARTMENTS', 'ALL_EMPLOYEE_GROUPS', 'ALL_EMPLOYEE_GROUPS_RATES', 'ALL_WAGE_SALARY_VALID_FROM'].includes(t.key)) return;
                
                if (!t.key.startsWith("UPDATE - Skill - ") &&
                    !t.key.startsWith("UPDATE - Department - ") &&
                    !t.key.startsWith("UPDATE - Group Rate - ") &&
                    !t.key.startsWith("UPDATE - Group Wage Type - ") &&
                    !t.key.startsWith("UPDATE - Group Valid From - ") &&
                    !t.key.startsWith("UPDATE - Group Salary Code - ") &&
                    !t.key.startsWith("UPDATE - Fixed Salary - ")) {
                    fieldsToAdd.push(t.key);
                }
            });
        }
        else if (fieldKey === "ALL_DEPARTMENTS") {
            definitions.departments.forEach(d => fieldsToAdd.push(`UPDATE - Department - ${d.name.trim()}`));
        }
        else if (fieldKey === "ALL_EMPLOYEE_GROUPS") {
            definitions.employeeGroups.forEach(g => {
                fieldsToAdd.push(`UPDATE - Group Rate - ${g.name.trim()}`);
                fieldsToAdd.push(`UPDATE - Group Wage Type - ${g.name.trim()}`);
                fieldsToAdd.push(`UPDATE - Group Valid From - ${g.name.trim()}`);
                fieldsToAdd.push(`UPDATE - Group Salary Code - ${g.name.trim()}`);
            });
        }
        else if (fieldKey === "ALL_SKILLS") {
            definitions.skills.forEach(s => fieldsToAdd.push(`UPDATE - Skill - ${s.name.trim()}`));
        }
        else {
            if (fieldKey.startsWith("UPDATE - Fixed Salary - ")) {
                fieldsToAdd.push("UPDATE - Fixed Salary - Period");
                fieldsToAdd.push("UPDATE - Fixed Salary - Expected working hours");
                fieldsToAdd.push("UPDATE - Fixed Salary - Amount");
                fieldsToAdd.push("UPDATE - Fixed Salary - Salary Code");
                fieldsToAdd.push("UPDATE - Fixed Salary - valid from");
            } 
            else if (fieldKey.startsWith("UPDATE - Group Rate - ") || 
                     fieldKey.startsWith("UPDATE - Group Wage Type - ") || 
                     fieldKey.startsWith("UPDATE - Group Valid From - ") || 
                     fieldKey.startsWith("UPDATE - Group Salary Code - ")) {
                
                let groupName = "";
                if (fieldKey.startsWith("UPDATE - Group Rate - ")) groupName = fieldKey.replace("UPDATE - Group Rate - ", "");
                if (fieldKey.startsWith("UPDATE - Group Wage Type - ")) groupName = fieldKey.replace("UPDATE - Group Wage Type - ", "");
                if (fieldKey.startsWith("UPDATE - Group Valid From - ")) groupName = fieldKey.replace("UPDATE - Group Valid From - ", "");
                if (fieldKey.startsWith("UPDATE - Group Salary Code - ")) groupName = fieldKey.replace("UPDATE - Group Salary Code - ", "");
                
                fieldsToAdd.push(`UPDATE - Group Rate - ${groupName}`);
                fieldsToAdd.push(`UPDATE - Group Wage Type - ${groupName}`);
                fieldsToAdd.push(`UPDATE - Group Valid From - ${groupName}`);
                fieldsToAdd.push(`UPDATE - Group Salary Code - ${groupName}`);
            }
            else {
                fieldsToAdd.push(fieldKey);
            }
        }
        
        const newExplicit = new Set<string>(explicitAddedCols);
        fieldsToAdd.forEach(f => newExplicit.add(f));
        recordChange(rawFileJson, newExplicit);
        
        setAddFieldKey('');
    };

    const handleGetAllEmployees = async () => {
        setIsLoading(true);
        setLoadingText("Fetching portal employees...");
        let employees = allEmployees;
        if (!employees.length) {
            try {
                employees = await fetchEmployees();
                setAllEmployees(employees);
            } catch (e) {
                console.error("Failed to fetch all employees", e);
                setIsLoading(false);
                return;
            }
        }
        
        if (!rawFileJson) {
            setIsLoading(false);
            return;
        }
        
        const existingIds = new Set<number>();
        rawFileJson.forEach(row => {
            if (row["Planday Employee ID"]) {
                existingIds.add(parseInt(row["Planday Employee ID"]));
            }
        });

        const newRows = [...rawFileJson];
        employees.forEach(emp => {
            if (!existingIds.has(emp.id)) {
                newRows.push({
                    "Planday Employee ID": emp.id,
                    "First Name": emp.firstName,
                    "Last Name": emp.lastName,
                });
            }
        });

        recordChange(newRows, explicitAddedCols);
        setIsLoading(false);
    };

    const missingRequiredFields = useMemo(() => {
        if (!definitions || !definitions.requiredFields || !rawFileJson || currentStep !== 'review') return [];
        if (getUpdateColumns.length === 0) return [];
        
        const missing: { fieldKey: string, label: string }[] = [];
        
        definitions.requiredFields.forEach(reqKey => {
            if (['firstName', 'lastName', 'email'].includes(reqKey)) return;
            
            let label = '';
            if (reqKey === 'birthDate') label = "Birth Date";
            else if (reqKey === 'gender') label = "Gender";
            else if (reqKey === 'ssn') label = "Tax ID";
            else if (reqKey === 'street1') label = "Street 1";
            else if (reqKey === 'street2') label = "Street 2";
            else if (reqKey === 'zip') label = "Zip";
            else if (reqKey === 'city') label = "City";
            else if (reqKey === 'cellPhoneCountryCode') label = "Country Code";
            else if (reqKey === 'cellPhone') label = "Mobile";
            else if (reqKey === 'hiredFrom') label = "Start/hired Date";
            else if (reqKey === 'jobTitle') label = "jobTitle";
            else if (reqKey === 'employeeTypeId') label = "Employee Type";
            else if (reqKey === 'bankReg') label = "System Bank Reg";
            else if (reqKey === 'bankAcc') label = "System Bank Account Nr";
            else if (reqKey === 'salaryIdentifier') label = "Salary Identifier (Payroll ID)";
            else {
                const cf = definitions.customFields.find(c => c.originalName === reqKey);
                if (cf) label = cf.description;
            }
            
            if (label) {
                const tableKey = `UPDATE - ${label}`;
                if (!getUpdateColumns.includes(tableKey)) {
                    missing.push({ fieldKey: tableKey, label: label });
                }
            }
        });
        return missing;
    }, [definitions, getUpdateColumns, rawFileJson, currentStep]);

    const availableFieldsToAddOptions = useMemo(() => {
        if (!definitions) return [];
        const updateColsSet = new Set(getUpdateColumns);
        // Exclude pseudo-mapper keys from the editor dropdown
        const allTargets = generateTargetFields(definitions).filter(f => 
            !['ALL_DEPARTMENTS', 'ALL_EMPLOYEE_GROUPS', 'ALL_EMPLOYEE_GROUPS_RATES', 'ALL_WAGE_SALARY_VALID_FROM'].includes(f.key)
        );
        const availableTargets = allTargets.filter(f => !updateColsSet.has(f.key));

        const hasHRFields = availableTargets.some(t => 
            !t.key.startsWith("UPDATE - Skill - ") &&
            !t.key.startsWith("UPDATE - Department - ") &&
            !t.key.startsWith("UPDATE - Group Rate - ") &&
            !t.key.startsWith("UPDATE - Group Wage Type - ") &&
            !t.key.startsWith("UPDATE - Group Valid From - ") &&
            !t.key.startsWith("UPDATE - Group Salary Code - ") &&
            !t.key.startsWith("UPDATE - Fixed Salary - ")
        );
        const hasDepartments = availableTargets.some(t => t.key.startsWith("UPDATE - Department - "));
        const hasGroups = availableTargets.some(t => 
            t.key.startsWith("UPDATE - Group Rate - ") || 
            t.key.startsWith("UPDATE - Group Wage Type - ") || 
            t.key.startsWith("UPDATE - Group Valid From - ") || 
            t.key.startsWith("UPDATE - Group Salary Code - ")
        );
        const hasSkills = availableTargets.some(t => t.key.startsWith("UPDATE - Skill - "));

        const options = [];
        if (hasHRFields) options.push({ value: "ALL_HR_FIELDS", label: "✨ All HR Fields" });
        if (hasDepartments) options.push({ value: "ALL_DEPARTMENTS", label: "✨ All Departments" });
        if (hasGroups) options.push({ value: "ALL_EMPLOYEE_GROUPS", label: "✨ All Employee groups (wages)" });
        if (hasSkills) options.push({ value: "ALL_SKILLS", label: "✨ All Skills" });

        return [
            ...options,
            ...availableTargets.map(f => ({ value: f.key, label: f.label }))
        ];
    }, [definitions, getUpdateColumns]);

    const applyBulkEdit = () => {
        if (!rawFileJson || !bulkEditField) return;
        const newFileJson = [...rawFileJson];
        let hasChanges = false;
        const newExplicit = new Set<string>(explicitAddedCols);
        
        newFileJson.forEach((row, rowIndex) => {
            const empId = parseInt(row["Planday Employee ID"]);
            if (selectedReviewIds.has(empId)) {
                if (bulkEditField === 'PRIMARY_DEPARTMENT') {
                    // Update all department columns for this employee
                    const existingCols = Object.keys(row);
                    const existingDeptCols = existingCols.filter(col => col.startsWith("UPDATE - Department - "));
                    const targetCol = bulkEditValue !== 'REMOVE_PRIMARY' ? `UPDATE - Department - ${bulkEditValue}` : null;
                    
                    if (targetCol && !existingDeptCols.includes(targetCol)) {
                        existingDeptCols.push(targetCol);
                    }
                    if (targetCol) {
                        newExplicit.add(targetCol);
                    }

                    const updatedRow = { ...newFileJson[rowIndex] };
                    existingDeptCols.forEach(col => {
                        const currVal = updatedRow[col];
                        if (bulkEditValue === 'REMOVE_PRIMARY') {
                            if (currVal === 'xx') {
                                updatedRow[col] = 'x';
                                hasChanges = true;
                            }
                        } else {
                            if (col === targetCol) {
                                if (currVal !== 'xx') {
                                    updatedRow[col] = 'xx';
                                    hasChanges = true;
                                }
                            } else if (currVal === 'xx') {
                                updatedRow[col] = 'x';
                                hasChanges = true;
                            }
                        }
                    });
                    newFileJson[rowIndex] = updatedRow;
                } else {
                    if (newFileJson[rowIndex][bulkEditField] !== bulkEditValue) {
                        newFileJson[rowIndex] = { ...row, [bulkEditField]: bulkEditValue };
                        hasChanges = true;
                    }
                }
            }
        });
        
        if (hasChanges) {
            recordChange(newFileJson, newExplicit);
        }
    };

    const changeValueForOptions = useMemo(() => {
        const options = Array.from(getUpdateColumns).map((col: string) => ({ value: col, label: col.replace("UPDATE - ", "") }));
        const hasDepartmentColumn = Array.from(getUpdateColumns).some((col: string) => col.startsWith('UPDATE - Department - '));
        if (definitions && definitions.departments.length > 0 && hasDepartmentColumn) {
            options.unshift({ value: 'PRIMARY_DEPARTMENT', label: 'Primary Department' });
        }
        return options;
    }, [getUpdateColumns, definitions]);

    const bulkEditValueOptions = useMemo(() => {
        if (bulkEditField === 'PRIMARY_DEPARTMENT' && definitions) {
            return [
                { value: 'REMOVE_PRIMARY', label: '-- Remove Primary Department --' },
                ...definitions.departments.map(d => ({ value: d.name, label: d.name }))
            ];
        }
        const fieldConfig = bulkEditField ? getFieldConfig(bulkEditField.replace("UPDATE - ", ""), definitions) : null;
        return fieldConfig?.options ? fieldConfig.options.map((opt: string) => ({ value: opt, label: opt })) : null;
    }, [bulkEditField, definitions]);

    useEffect(() => {
        if (bulkEditField && !changeValueForOptions.some((opt: any) => opt.value === bulkEditField)) {
            setBulkEditField('');
            setBulkEditValue('');
        }
    }, [changeValueForOptions, bulkEditField]);

    const toggleSelectAll = (checked: boolean) => {
        const newSet = new Set(selectedReviewIds);
        if (checked) {
            filteredReviews.forEach(r => newSet.add(r.employeeId));
        } else {
            filteredReviews.forEach(r => newSet.delete(r.employeeId));
        }
        setSelectedReviewIds(newSet);
    };

    const handleSelectRow = (id: number, checked: boolean) => {
        const newSet = new Set(selectedReviewIds);
        if (checked) {
            newSet.add(id);
        } else {
            newSet.delete(id);
        }
        setSelectedReviewIds(newSet);
    };

    const handleCellEditRef = useRef(handleCellEdit);
    useEffect(() => { handleCellEditRef.current = handleCellEdit; }, [handleCellEdit]);
    const stableHandleCellEdit = useCallback((id: number, col: string, val: string) => handleCellEditRef.current(id, col, val), []);

    const handleSelectRowRef = useRef(handleSelectRow);
    useEffect(() => { handleSelectRowRef.current = handleSelectRow; }, [handleSelectRow]);
    const stableHandleSelectRow = useCallback((id: number, checked: boolean) => handleSelectRowRef.current(id, checked), []);

    return (
        <div className="min-h-screen font-sans flex flex-col bg-gray-50 text-gray-800">
            <div className="container mx-auto px-4 py-8 flex-grow flex flex-col">
                <PageHeader />
                <div className="my-12 max-w-7xl mx-auto w-full">
                    <Stepper 
                        current={getStepIndex(currentStep)} 
                        steps={STEP_CONFIG.labels} 
                        skippedSteps={updateMethod === 'editor' ? [2] : []}
                        onStepClick={(index) => {
                            if (index === 0 && currentStep !== 'auth') {
                                handleChangeCredentials();
                            }
                        }}
                    />
                    {currentStep !== 'auth' && (
                        <div className="flex justify-center mt-6 text-sm items-center">
                            {currentStep !== 'processing' && currentStep !== 'results' && (
                                <button
                                    onClick={handleManualRefresh}
                                    className="mr-2 text-gray-500 hover:text-blue-600 transition-colors"
                                    title="Refresh portal data and fields"
                                    disabled={isLoading}
                                >
                                    <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                </button>
                            )}
                            <span className="text-gray-600">Logged in: <strong>{portalName || 'Loading...'}</strong></span>
                            <span className="text-gray-400 mx-2">|</span>
                            <button 
                                onClick={handleChangeCredentials} 
                                className="text-gray-600 hover:text-red-700 underline transition-colors"
                            >
                                Change credentials (log out)
                            </button>
                        </div>
                    )}
                </div>

                <main className="max-w-7xl mx-auto w-full">
                    {error && <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded shadow">{error}</div>}

                    {currentStep === 'auth' && (
                        <div className="grid md:grid-cols-2 gap-8 items-start max-w-7xl mx-auto">
                            <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100">
                                <h2 className="text-2xl font-bold mb-4 text-gray-900">Connect to Planday</h2>
                                <div className="mb-6">
                                    <p className="text-gray-500 mb-1">Enter your Planday refresh token to connect with the App.</p>
                                </div>
                                <AuthForm onSuccess={handleAuthSuccess} />
                            </div>
                            <TokenGuide />
                        </div>
                    )}

                    {currentStep === 'configure' && (
                        <>
                            <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 max-w-4xl mx-auto">
                                <h2 className="text-2xl font-bold mb-6">Select Update Method</h2>
                                <div className="grid md:grid-cols-2 gap-4 mb-8">
                                    <label className={`cursor-pointer border rounded-xl p-4 flex flex-col items-center justify-center gap-2 transition-colors ${updateMethod === 'excel' ? 'border-blue-500 bg-blue-50 relative ring-1 ring-blue-500' : 'border-gray-200 hover:bg-gray-50'}`}>
                                        <input type="radio" name="updateMethod" value="excel" checked={updateMethod === 'excel'} onChange={() => setUpdateMethod('excel')} className="sr-only" />
                                        <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                                        </div>
                                        <div className="text-lg font-bold text-gray-800">Use Excel</div>
                                        <div className="text-sm text-gray-500 text-center">Download a template and edit in Excel</div>
                                    </label>

                                    <label className={`cursor-pointer border rounded-xl p-4 flex flex-col items-center justify-center gap-2 transition-colors ${updateMethod === 'editor' ? 'border-blue-500 bg-blue-50 relative ring-1 ring-blue-500' : 'border-gray-200 hover:bg-gray-50'}`}>
                                        <input type="radio" name="updateMethod" value="editor" checked={updateMethod === 'editor'} onChange={() => setUpdateMethod('editor')} className="sr-only" />
                                        <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                                        </div>
                                        <div className="text-lg font-bold text-gray-800">Use Editor</div>
                                        <div className="text-sm text-gray-500 text-center">Edit directly in the browser table</div>
                                    </label>
                                </div>

                                {updateMethod === 'excel' && (
                                    <>
                                        <h2 className="text-2xl font-bold mb-6 mt-8">Select Data to Update</h2>
                                        
                                        <div className="grid md:grid-cols-2 gap-4 mb-8">
                                            <Checkbox label="System HR Fields (Email, Address, Etc.)" checked={selectedSections.system} onChange={c => setSelectedSections(p => ({...p, system: c}))} />
                                            <Checkbox label="Departments" checked={selectedSections.departments} onChange={c => setSelectedSections(p => ({...p, departments: c}))} />
                                            <Checkbox label="Custom Fields" checked={selectedSections.custom} onChange={c => setSelectedSections(p => ({...p, custom: c}))} />
                                            <Checkbox label="Wages" checked={selectedSections.wages} onChange={c => setSelectedSections(p => ({...p, wages: c}))} />
                                            <Checkbox label="Salaries" checked={selectedSections.salary} onChange={c => setSelectedSections(p => ({...p, salary: c}))} />
                                            <Checkbox label="Contract Rules" checked={selectedSections.contract} onChange={c => setSelectedSections(p => ({...p, contract: c}))} />
                                            <Checkbox label="Supervisors" checked={selectedSections.supervisor} onChange={c => setSelectedSections(p => ({...p, supervisor: c}))} />
                                            <Checkbox label="Skills" checked={selectedSections.skills} onChange={c => setSelectedSections(p => ({...p, skills: c}))} />
                                        </div>
                                    </>
                                )}
                                
                                <div className={`mb-8 p-4 bg-gray-50 border border-gray-200 rounded-lg ${updateMethod === 'editor' ? 'mt-8' : ''}`}>
                                    <h3 className="font-semibold text-gray-700 mb-3 text-sm">Filter Employees (Optional)</h3>
                                    {definitions ? (
                                        <div className="flex flex-wrap gap-4">
                                            <MultiSelectMenu 
                                                label="Department"
                                                options={definitions.departments}
                                                selectedIds={exportFilterDepartment}
                                                onChange={setExportFilterDepartment}
                                                toggleOptionEnabled={exportFilterPrimaryDepartment}
                                                onToggleOption={setExportFilterPrimaryDepartment}
                                                toggleOptionLabel="Primary Department"
                                                toggleTooltipText={
                                                    <>
                                                        You can filter by Primary Department.<br/>
                                                        <strong>Note:</strong> Employees without a designated primary department will not appear in the template file. To use this filter, ensure the feature is enabled and assigned to everyone.
                                                    </>
                                                }
                                            />
                                            <MultiSelectMenu 
                                                label="Employee Group"
                                                options={definitions.employeeGroups}
                                                selectedIds={exportFilterGroup}
                                                onChange={setExportFilterGroup}
                                            />
                                            <MultiSelectMenu 
                                                label="Employee Type"
                                                options={definitions.employeeTypes}
                                                selectedIds={exportFilterType}
                                                onChange={setExportFilterType}
                                            />
                                        </div>
                                    ) : (
                                        <div className="text-sm text-gray-500 italic">Loading filters...</div>
                                    )}
                                </div>

                                {updateMethod === 'excel' && (
                                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 mb-8">
                                        <Checkbox 
                                            label="Populate with current employee data? (Slower download)" 
                                            checked={populateData} 
                                            onChange={setPopulateData} 
                                        />
                                        <p className="text-sm text-blue-600 ml-7 mt-1">If checked, include full profile data. (Names and IDs are always included for all staff.)</p>
                                    </div>
                                )}

                                {isLoading ? (
                                    <div className="mt-6">
                                        <ProgressBar 
                                            percentage={progress} 
                                            current={populateData ? Math.round((progress / 100) * totalItems) : undefined}
                                            total={populateData ? totalItems : undefined}
                                            label={populateData ? "Fetching Employee Data..." : "Generating..."}
                                        />
                                        <p className="text-center text-xs text-gray-500 mt-2">{loadingText}</p>
                                    </div>
                                ) : (
                                    <div className="flex justify-end gap-4">
                                        {updateMethod === 'excel' && (
                                            <>
                                                <button 
                                                    onClick={() => setShowHelpModal(true)} 
                                                    disabled={isLoading} 
                                                    className="bg-orange-100 text-orange-700 border border-orange-300 px-6 py-3 rounded-lg font-bold hover:bg-orange-200 transition-colors"
                                                >
                                                    Can I use my own template/file?
                                                </button>
                                                <button onClick={handleGoToUpload} disabled={isLoading} className="bg-green-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-green-700">
                                                    I have Excel file ready
                                                </button>
                                            </>
                                        )}
                                        <button onClick={handleDownloadTemplate} disabled={isLoading} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700">
                                            {updateMethod === 'excel' ? 'Generate Template File' : <>Next &#8594;</>}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {currentStep === 'select_fields' && definitions && (
                        <FieldSelector 
                            defs={definitions}
                            selectedSystem={selectedSystemFields}
                            setSelectedSystem={setSelectedSystemFields}
                            selectedCustom={selectedCustomFields}
                            setSelectedCustom={setSelectedCustomFields}
                            selectedDepartments={selectedDepartments}
                            setSelectedDepartments={setSelectedDepartments}
                            selectedWages={selectedWages}
                            setSelectedWages={setSelectedWages}
                            selectedSkills={selectedSkills}
                            setSelectedSkills={setSelectedSkills}
                            showSystem={selectedSections.system}
                            showCustom={selectedSections.custom}
                            showDepartments={selectedSections.departments}
                            showWages={selectedSections.wages}
                            showSkills={selectedSections.skills}
                            onNext={async () => {
                                setCurrentStep('generate_template');
                                await generateAndDownloadTemplate();
                            }}
                            onBack={() => setCurrentStep('configure')}
                        />
                    )}

                    {currentStep === 'generate_template' && (
                        <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 max-w-2xl mx-auto">
                            <h2 className="text-2xl font-bold mb-4">Generating Template</h2>
                            <p className="text-gray-500 mb-8">We are building your custom Excel template based on your configuration.</p>
                            
                            {isLoading ? (
                                <div className="p-8 mb-8">
                                    <ProgressBar 
                                        percentage={progress} 
                                        current={populateData ? Math.round((progress / 100) * totalItems) : undefined}
                                        total={populateData ? totalItems : undefined}
                                        label={populateData ? "Fetching Employee Data..." : "Generating Template..."}
                                    />
                                    <p className="text-center text-xs text-blue-500 mt-2">{loadingText}</p>
                                    <div className="mt-8 flex justify-center">
                                        <button 
                                            onClick={() => setIsStopModalOpen(true)}
                                            className="text-red-700 bg-red-50 border border-red-200 hover:bg-red-100 font-bold rounded-lg text-sm px-6 py-2.5 transition-colors flex items-center gap-2 shadow-sm"
                                        >
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                            Stop Process
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="bg-green-50 border border-green-200 p-8 rounded-xl text-center">
                                    <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <svg className="w-8 h-8" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                                            <path d="M5 13l4 4L19 7"></path>
                                        </svg>
                                    </div>
                                    <h3 className="text-xl font-bold text-green-800 mb-2">Template Ready!</h3>
                                    <p className="text-green-700 mb-6">Your template has been generated and should have downloaded automatically.</p>
                                    
                                    <div className="flex flex-col sm:flex-row justify-center gap-4">
                                        <button 
                                            onClick={() => {
                                                if (generatedWorkbook) {
                                                    XLSX.writeFile(generatedWorkbook, "Planday_Employee_Update_Template.xlsx");
                                                }
                                            }} 
                                            disabled={!generatedWorkbook}
                                            className="bg-white text-green-700 border border-green-300 px-6 py-3 rounded-lg font-bold hover:bg-green-50 transition-colors flex items-center justify-center gap-2"
                                        >
                                            <DownloadIcon className="w-5 h-5"/> Download Manually
                                        </button>
                                        <button 
                                            onClick={() => setCurrentStep('upload')} 
                                            className="bg-green-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-green-700 transition-colors"
                                        >
                                            Next: Upload Template
                                        </button>
                                    </div>
                                </div>
                            )}

                            {!isLoading && (
                                <>
                                    <hr className="my-8 border-gray-100" />
                                    <div className="flex justify-start">
                                        <button 
                                            onClick={() => setCurrentStep(definitions ? 'select_fields' : 'configure')} 
                                            className="text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 font-medium rounded-lg text-sm px-5 py-2.5 text-center inline-flex items-center"
                                        >
                                            &larr; Back
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {currentStep === 'upload' && (
                        <>
                            <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 max-w-2xl mx-auto">
                                <h2 className="text-2xl font-bold mb-4">Upload Template</h2>
                                <p className="text-gray-500 mb-8 whitespace-pre-wrap">Select the completed Excel file with your employee updates.{"\n"}You can use your own template (e.g. exported from your HR system), or use the provided update template generated from this app (Recommended - Make sure to read the instructions from the template before uploading).</p>

                                <div className="mb-8 p-6 bg-blue-50 border border-blue-100 rounded-xl">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="font-semibold text-blue-900 mb-1">Need a template?</h3>
                                            <p className="text-sm text-blue-700">Download a pre-filled template based on your configuration.</p>
                                        </div>
                                        <button onClick={() => setCurrentStep('configure')} disabled={isLoading} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                                            <DownloadIcon className="w-5 h-5"/> Get Template
                                        </button>
                                    </div>
                                </div>
                                
                                <div
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                    className={`relative group cursor-pointer flex flex-col items-center justify-center w-full h-64 rounded-xl border-2 border-dashed transition-all duration-200 bg-gray-50
                                        ${isDragging ? 'border-blue-500 bg-blue-50 scale-[1.01]' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-100'}
                                    `}
                                >
                                    <input 
                                        type="file" 
                                        onChange={handleFileInputChange} 
                                        accept=".xlsx, .xls" 
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
                                        disabled={isLoading}
                                    />
                                    
                                    {isLoading ? (
                                        <Loader text={loadingText} />
                                    ) : (
                                        <div className="text-center pointer-events-none">
                                            <CloudUploadIcon className={`w-12 h-12 mx-auto mb-4 transition-colors ${isDragging ? 'text-blue-500' : 'text-gray-400'}`} />
                                            <p className={`text-lg font-medium transition-colors ${isDragging ? 'text-blue-700' : 'text-gray-700'}`}>
                                                Drop file or click to browse
                                            </p>
                                            <p className="text-sm text-gray-400 mt-2">Supports .xlsx, .xls</p>
                                        </div>
                                    )}
                                </div>
                                
                                <hr className="my-8 border-gray-100" />

                                <div className="flex justify-end">
                                    <button 
                                        onClick={() => setCurrentStep('configure')} 
                                        className="text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 font-medium rounded-lg text-sm px-5 py-2.5 text-center inline-flex items-center"
                                    >
                                        &larr; Back
                                    </button>
                                </div>
                            </div>
                        </>
                    )}

                    {currentStep === 'identity_method' && (
                        <IdentitySelector 
                            headers={getNonEmptyHeaders(unmappedJson)}
                            onNext={handleIdentityMethodSelection}
                            onBack={() => {
                                setUnmappedJson([]);
                                setCurrentStep('upload');
                            }}
                        />
                    )}

                    {currentStep === 'map_employees' && (
                        <EmployeeMapper 
                            rows={unmappedJson} 
                            employees={allEmployees}
                            initialMapping={initialAutoMapping}
                            matchMethod={selectedIdentityMethod}
                            onComplete={handleEmployeeMappingComplete}
                            onCancel={() => {
                                setUnmappedJson([]);
                                setCurrentStep('upload');
                            }}
                            onBack={() => {
                                setCurrentStep('identity_method');
                            }}
                            onShowHelp={() => setShowHelpModal(true)}
                        />
                    )}

                    {currentStep === 'map_fields' && definitions && (
                        <FieldMapper 
                            fileHeaders={getNonEmptyHeaders(unmappedJson)}
                            availableTargets={generateTargetFields(definitions)}
                            onComplete={handleFieldMappingComplete}
                            onCancel={() => {
                                setEmployeeMapping(new Map());
                                setCurrentStep('map_employees');
                            }}
                            initialMapping={fieldMapping}
                            onShowHelp={() => setShowHelpModal(true)}
                        />
                    )}

                    {currentStep === 'validation_errors' && (
                        <ValidationErrorsView 
                            errors={validationErrors}
                            validationSource={validationSource}
                            onBack={() => {
                                if (validationSource === 'review') {
                                    setCurrentStep('review');
                                } else if (updateMethod === 'editor') {
                                    setCurrentStep('configure');
                                } else {
                                    if (unmappedJson.length > 0) {
                                        setCurrentStep('map_fields');
                                    } else {
                                        setCurrentStep('upload');
                                    }
                                }
                            }}
                            onUpdateValue={handleUpdateErrorValue}
                            onRevalidate={handleRevalidate}
                            onSkipFields={handleSkipInvalidFields}
                            onContinueWithErrors={handleContinueWithInvalidFields}
                        />
                    )}

                    {currentStep === 'resolve_dates' && (
                        <DateAmbiguityResolver 
                            items={ambiguousDates}
                            onUpdate={(id, century) => {
                                setAmbiguousDates(prev => prev.map(item => item.id === id ? { ...item, selectedCentury: century } : item));
                            }}
                            onContinue={() => {
                                if (rawFileJson) processRows(rawFileJson, ambiguousDates, detectedUSFormat, true);
                            }}
                            onBack={() => setCurrentStep('upload')}
                        />
                    )}

                    {currentStep === 'review' && (
                        <>
                            <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100">
                                <h2 className="text-2xl font-bold mb-4">Review Changes</h2>
                                
                                {showEditorEditorInstructions && (
                                    <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-3">
                                        <div className="text-blue-500 mt-0.5">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-bold text-blue-900">Add fields to include for update</h3>
                                            <p className="text-sm text-blue-700 mt-1">
                                                All selected employees have been added to the table. Click <strong>"Add fields to the Update Table"</strong> above the Bulk Edit section to choose which columns you want to edit. Then you can make your changes directly within the table.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {updateMethod !== 'editor' && dateReport.length > 0 && <DateConversionReport report={dateReport} isUSFormat={detectedUSFormat} />}

                                <div className="mb-6 space-y-6">
                                    <div className="flex items-center gap-4 relative z-50">
                                        <label className="block text-sm font-bold text-gray-800 uppercase flex-shrink-0">Add fields to the Update Table</label>
                                        <div className="w-[400px] relative">
                                            <SearchableSelect 
                                                options={availableFieldsToAddOptions}
                                                value={addFieldKey} 
                                                onChange={val => handleAddField(val)}
                                                placeholder={availableFieldsToAddOptions.length === 0 ? "All fields are added to the table." : "-- Select Field to Add --"}
                                                disabled={availableFieldsToAddOptions.length === 0}
                                                usePortal={false}
                                            />
                                        </div>
                                    </div>

                                    {missingRequiredFields.length > 0 && (
                                        <div className="mt-2 bg-orange-50 border border-orange-200 rounded-lg overflow-hidden">
                                            <div 
                                                className="p-4 flex items-center justify-between cursor-pointer hover:bg-orange-100/50 transition-colors"
                                                onClick={() => setIsMissingFieldsExpanded(!isMissingFieldsExpanded)}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <h4 className="font-bold text-orange-900 m-0">Required HR fields found in the portal</h4>
                                                    <span className="bg-orange-200 text-orange-800 text-xs font-bold px-2 py-0.5 rounded-full">
                                                        {missingRequiredFields.length}
                                                    </span>
                                                </div>
                                                <button className="text-orange-800 font-medium text-sm flex items-center gap-1">
                                                    {isMissingFieldsExpanded ? (
                                                        <>Read less <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 15l7-7 7 7"></path></svg></>
                                                    ) : (
                                                        <>Read more <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg></>
                                                    )}
                                                </button>
                                            </div>
                                            
                                            {isMissingFieldsExpanded && (
                                                <div className="p-4 pt-0 border-t border-orange-200/50">
                                                    <p className="text-sm text-orange-800 mb-3 leading-relaxed mt-3">
                                                        <strong>Note:</strong> This portal has required HR fields in the employee form.
                                                        <br/>
                                                        If an employee's profile is currently missing required information, the update of HR data will fail. To fix this, you must either provide the missing value in the update table, or change the field's required status inside your Planday employee form settings.
                                                        <br/>
                                                        If all employees already have these fields filled out, no action is required and you do not need to include these fields in the update table.
                                                    </p>
                                                    <ul className="space-y-2">
                                                        {missingRequiredFields.map(mf => (
                                                            <li key={mf.fieldKey} className="flex items-center justify-between bg-white px-3 py-2 rounded border border-orange-100 shadow-sm max-w-lg">
                                                                <span className="text-sm font-medium text-gray-700">{mf.label}</span>
                                                                <button 
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleAddField(mf.fieldKey);
                                                                    }}
                                                                    className="text-xs bg-orange-100 hover:bg-orange-200 text-orange-800 font-bold py-1 px-3 rounded transition-colors"
                                                                >
                                                                    Add
                                                                </button>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="flex flex-col gap-4 bg-white p-4 rounded-lg border border-gray-200 mt-4">
                                        <div className="flex items-center gap-2 border-b pb-2">
                                            <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wide">Bulk Edit</h3>
                                            <div className="group relative flex items-center">
                                                <div className="text-gray-400 hover:text-blue-500 cursor-help transition-colors">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                </div>
                                                <div className="absolute bottom-full left-0 mb-2 w-72 bg-gray-800 text-white text-xs rounded p-2 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-lg text-left normal-case tracking-normal font-normal">
                                                    Use the checkboxes in the table below to choose which employees to include for the bulk edit. Use the filters to easily find specific employees within Departments, Employee Groups, and Types.
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-4 align-middle items-end relative z-40">
                                            <div className="flex-1 min-w-[200px] relative">
                                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Change value for</label>
                                                <SearchableSelect 
                                                    options={changeValueForOptions}
                                                    value={bulkEditField} 
                                                    onChange={val => {
                                                        setBulkEditField(val);
                                                        setBulkEditValue('');
                                                    }}
                                                    placeholder="-- Select Field --"
                                                    usePortal={false}
                                                />
                                            </div>
                                            <div className="flex-1 min-w-[200px] relative">
                                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">New Value</label>
                                                {(() => {
                                                    if (bulkEditValueOptions) {
                                                        return (
                                                            <SearchableSelect 
                                                                options={bulkEditValueOptions}
                                                                value={bulkEditValue} 
                                                                onChange={val => setBulkEditValue(val)}
                                                                placeholder="Select Value..."
                                                                usePortal={false}
                                                            />
                                                        );
                                                    }
                                                    return (
                                                        <input 
                                                            type="text" 
                                                            className="w-full h-[38px] px-3 text-sm border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 transition-colors" 
                                                            placeholder="Value to apply..." 
                                                            value={bulkEditValue} 
                                                            onChange={e => setBulkEditValue(e.target.value)} 
                                                            disabled={!bulkEditField}
                                                        />
                                                    );
                                                })()}
                                            </div>
                                            <div className="flex flex-col gap-2">
                                                <button 
                                                    onClick={applyBulkEdit}
                                                    disabled={!bulkEditField || selectedReviewIds.size === 0}
                                                    className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed h-[38px] transition-colors"
                                                >
                                                    Apply to {selectedReviewIds.size} Selected
                                                </button>
                                                <div className="flex gap-2">
                                                    <button 
                                                        onClick={() => {
                                                            const newSelected = new Set<number>();
                                                            filteredReviews.forEach(r => newSelected.add(r.employeeId));
                                                            setSelectedReviewIds(newSelected);
                                                        }}
                                                        className="flex-1 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded shadow-sm hover:bg-gray-50 transition-colors whitespace-nowrap"
                                                    >
                                                        Select only the filtered employees in the table
                                                    </button>
                                                    <button 
                                                        onClick={() => {
                                                            const newSelected = new Set<number>();
                                                            reviews.forEach(r => newSelected.add(r.employeeId));
                                                            setSelectedReviewIds(newSelected);
                                                        }}
                                                        className="flex-1 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded shadow-sm hover:bg-gray-50 transition-colors whitespace-nowrap"
                                                    >
                                                        Select all employees in the table
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    
                                    <div className="space-y-4">
                                        <div className="flex flex-wrap gap-4 bg-gray-50 p-4 rounded-lg border border-gray-100 relative">
                                            <div className="w-full flex justify-between items-center mb-1">
                                                <h4 className="text-sm font-semibold text-gray-700">Filters</h4>
                                                <button 
                                                    onClick={() => {
                                                        setSearchReview('');
                                                        setFilterDepartment([]);
                                                        setFilterGroup([]);
                                                        setFilterType([]);
                                                    }}
                                                    className="text-sm text-blue-600 hover:text-blue-800 font-medium underline"
                                                >
                                                    Clear filters
                                                </button>
                                            </div>
                                            <div className="flex-1 min-w-[200px]">
                                                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Search Name</label>
                                                <input 
                                                    type="text" 
                                                    className="w-full text-sm border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500" 
                                                    placeholder="Search employees..." 
                                                    value={searchReview} 
                                                    onChange={e => setSearchReview(e.target.value)} 
                                                />
                                            </div>
                                            {definitions && (
                                                <>
                                                    <MultiSelectMenu 
                                                        label="Department"
                                                        options={definitions.departments}
                                                        selectedIds={filterDepartment}
                                                        onChange={setFilterDepartment}
                                                        toggleOptionEnabled={filterPrimaryDepartment}
                                                        onToggleOption={setFilterPrimaryDepartment}
                                                        toggleOptionLabel="Primary Department"
                                                        toggleTooltipText={
                                                            <>
                                                                You can filter by Primary Department.<br/>
                                                                <strong>Note:</strong> Employees without a designated primary department will not appear in the template file. To use this filter, ensure the feature is enabled and assigned to everyone.
                                                            </>
                                                        }
                                                    />
                                                    <MultiSelectMenu 
                                                        label="Employee Group"
                                                        options={definitions.employeeGroups}
                                                        selectedIds={filterGroup}
                                                        onChange={setFilterGroup}
                                                    />
                                                    <MultiSelectMenu 
                                                        label="Employee Type"
                                                        options={definitions.employeeTypes}
                                                        selectedIds={filterType}
                                                        onChange={setFilterType}
                                                    />
                                                </>
                                            )}
                                        </div>

                                        {reviews.length < allEmployees.length && (
                                            <div className="flex flex-col gap-2 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg shadow-sm">
                                                <div className="flex items-center gap-3 text-sm text-blue-700">
                                                    <span>Your table currently include <span className="font-bold">{reviews.length}</span> employees, but <span className="font-bold">{allEmployees.length}</span> employees exists in the portal.</span>
                                                    <button onClick={handleGetAllEmployees} className="px-3 py-1 bg-white border border-blue-300 rounded shadow-sm hover:bg-blue-50 text-blue-800 font-medium transition-colors text-xs focus:ring-2 focus:ring-blue-500">
                                                        Get all
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                
                                <div className="mt-8 mb-2 flex flex-wrap items-center gap-2">
                                    <h3 className="text-lg font-bold text-gray-800">Fields to update</h3>
                                    <span className="text-sm text-gray-600 bg-gray-100 px-2 py-1 rounded">
                                        Found <span className="font-bold">{reviews.filter(r => r.status !== 'no_updates').length}</span> employees with updates pending
                                    </span>
                                    <div className="group relative flex items-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400 cursor-help hover:text-blue-500 transition-colors" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                        </svg>
                                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-72 bg-gray-900 text-white text-xs rounded py-2 px-3 z-50">
                                            Field values can be changed via manual individual input or via the bulk edit option. All users with updates pending will be updated upon confirmation, not just the filtered ones. Blank values will be ignored and will not overwrite current information.
                                            <div className="absolute left-1/2 -translate-x-1/2 top-full border-4 border-transparent border-t-gray-900"></div>
                                        </div>
                                    </div>
                                    <div className="flex-1"></div>
                                    <div className="flex gap-2 mr-2 items-center">
                                        {(totalIssuesCount > 0 || showOnlyIssues) && (
                                            <div className="flex items-center gap-3">
                                                {totalIssuesCount > 0 ? (
                                                    <span className="text-red-500 font-bold text-sm">Issues found: {totalIssuesCount}</span>
                                                ) : (
                                                    <span className="text-green-600 font-bold text-sm">All issues fixed!</span>
                                                )}
                                                <button 
                                                    onClick={() => {
                                                        if (!showOnlyIssues) {
                                                            setSearchReview('');
                                                            setFilterDepartment([]);
                                                            setFilterGroup([]);
                                                            setFilterType([]);
                                                            
                                                            const newSelection = new Set<number>();
                                                            reviews.forEach(r => {
                                                                const hasIssues = editorErrorsMap[r.employeeId] && Object.keys(editorErrorsMap[r.employeeId]).length > 0;
                                                                if (hasIssues) newSelection.add(r.employeeId);
                                                            });
                                                            setSelectedReviewIds(newSelection);
                                                        }
                                                        setShowOnlyIssues(!showOnlyIssues);
                                                    }}
                                                    className={`px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center gap-1.5 shadow-sm border ${showOnlyIssues ? 'bg-red-700 hover:bg-red-800 text-white border-red-700' : 'bg-red-600 hover:bg-red-700 text-white border-red-600'}`}
                                                    title={showOnlyIssues ? "Show all employees" : "Show only employees with validation issues"}
                                                >
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                                    {showOnlyIssues ? 'Clear Issues Filter' : 'Filter Issues'}
                                                </button>
                                            </div>
                                        )}
                                        <button 
                                            onClick={handleUndo}
                                            disabled={historyIndex <= 0}
                                            className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shadow-sm"
                                            title="Undo last action"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
                                            Undo
                                        </button>
                                        <button 
                                            onClick={handleRedo}
                                            disabled={historyIndex >= history.length - 1 || historyIndex === -1}
                                            className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shadow-sm"
                                            title="Redo previous action"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" /></svg>
                                            Redo
                                        </button>
                                    </div>
                                    <button 
                                        onClick={() => setShowClearTableConfirm(true)}
                                        className="px-3 py-1.5 bg-white border border-red-200 text-red-600 rounded text-sm font-medium hover:bg-red-50 transition-colors flex items-center gap-1.5 shadow-sm"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                        Clear the table
                                    </button>
                                </div>
                                <div className="overflow-x-auto overflow-y-auto max-h-[70vh] border border-gray-300 rounded-lg bg-gray-100 shadow-inner">
                                    <table className="w-full text-left text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
                                        <thead>
                                            <tr>
                                                <ResizableHeader 
                                                    title={`Employee (${filteredReviews.length}/${reviews.length})`} 
                                                    defaultWidth={280} 
                                                    isLeft={true} 
                                                    info={{
                                                        type: "Count",
                                                        description: "Employee Filtering",
                                                        guidance: "The first number in the bracket is the current filtered number, and the second number is the total fetched number of employees. You will see a blue banner above with a button saying 'Get all', if the portal has more employees than what the table displays."
                                                    }}
                                                    checkbox={(
                                                        <input 
                                                            type="checkbox" 
                                                            className="rounded text-blue-600 focus:ring-blue-500 bg-white border-gray-300 mr-1 flex-shrink-0"
                                                            checked={filteredReviews.length > 0 && filteredReviews.every(r => selectedReviewIds.has(r.employeeId))}
                                                            onChange={e => toggleSelectAll(e.target.checked)}
                                                        />
                                                    )}
                                                    extraActions={selectedReviewIds.size > 0 && (
                                                        <span className="flex items-center space-x-1 ml-2 flex-shrink-0">
                                                            <button 
                                                                onClick={() => setSelectedReviewIds(new Set())} 
                                                                className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-0.5 rounded border border-gray-200 transition-colors"
                                                            >
                                                                Clear
                                                            </button>
                                                            <button 
                                                                onClick={() => setShowRemoveSelectedConfirm(true)} 
                                                                className="text-xs bg-gray-100 hover:bg-red-100 hover:text-red-700 hover:border-red-200 text-gray-600 px-2 py-0.5 rounded border border-gray-200 transition-colors"
                                                            >
                                                                Remove
                                                            </button>
                                                        </span>
                                                    )}
                                                />
                                                {getUpdateColumns.map(col => {
                                                    const cleanTitle = col.replace("UPDATE - ", "");
                                                    const colInfo = columnMeta[col] || { config: null, bgColor: 'bg-[#dee6f0]' };
                                                    return (
                                                        <ResizableHeader 
                                                            key={col} 
                                                            title={cleanTitle} 
                                                            defaultWidth={Math.max(120, cleanTitle.length * 9 + 40)} 
                                                            info={colInfo.config}
                                                            bgColor={colInfo.bgColor}
                                                            isMissing={colInfo.isMissingInPortal}
                                                            onRemapClick={() => setColumnToRemap(col)}
                                                            onDelete={() => setColumnToDelete(col)}
                                                        />
                                                    );
                                                })}
                                                {getUpdateColumns.length === 0 && (
                                                    <th className="px-6 py-4 bg-[#dee6f0]/30 text-left text-sm font-medium text-gray-500 w-full border-b border-gray-300 uppercase tracking-wider relative z-0">
                                                        Add fields to get started
                                                    </th>
                                                )}
                                                {getUpdateColumns.length > 0 && <th className="w-full bg-gray-200 border-b border-gray-300 relative z-0"></th>}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-200">
                                            {paginatedReviews.map(r => {
                                                const rowMeta = rawFileJsonMap.get(r.employeeId);
                                                const rowData = rowMeta ? rowMeta.data : {};
                                                const originalIdx = rowMeta ? rowMeta.index : -1;
                                                return (
                                                    <TableRow 
                                                        key={r.employeeId}
                                                        review={r}
                                                        rowData={rowData}
                                                        originalIdx={originalIdx}
                                                        getUpdateColumns={getUpdateColumns}
                                                        dateColumns={dateColumns}
                                                        columnMeta={columnMeta}
                                                        ambiguousDates={ambiguousDates}
                                                        detectedUSFormat={detectedUSFormat}
                                                        bulkEditField={bulkEditField}
                                                        selected={selectedReviewIds.has(r.employeeId)}
                                                        rowErrors={editorErrorsMap[r.employeeId]}
                                                        salaryIdentifier={allEmployees.find(e => e.id === r.employeeId)?.salaryIdentifier}
                                                        onSelectRow={stableHandleSelectRow}
                                                        onCellEdit={stableHandleCellEdit}
                                                        onCellFocus={stableOnCellFocus}
                                                        onCellBlur={stableOnCellBlur}
                                                    />
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                
                                {true && (
                                    <div className="flex items-center justify-between px-4 py-3 bg-white border border-gray-200 border-t-0 rounded-b-lg">
                                        <div className="flex flex-1 justify-between sm:hidden">
                                            <button
                                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                                disabled={currentPage === 1}
                                                className="relative inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                            >
                                                Previous
                                            </button>
                                            <button
                                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                                disabled={currentPage === totalPages}
                                                className="relative ml-3 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                            >
                                                Next
                                            </button>
                                        </div>
                                        <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
                                            <div className="flex items-center space-x-4">
                                                <div className="flex items-center space-x-2">
                                                    <label className="text-sm text-gray-600 font-medium">Rows per page:</label>
                                                    <select 
                                                        value={rowsPerPage === 'ALL' ? 'ALL' : rowsPerPage} 
                                                        onChange={(e) => {
                                                            const val = e.target.value;
                                                            setRowsPerPage(val === 'ALL' ? 'ALL' : parseInt(val));
                                                            setCurrentPage(1);
                                                        }}
                                                        className="text-sm border-gray-300 rounded-md py-1 px-2 focus:ring-blue-500 focus:border-blue-500"
                                                    >
                                                        <option value={50}>50</option>
                                                        <option value={100}>100</option>
                                                        <option value={200}>200</option>
                                                        <option value="ALL">All</option>
                                                    </select>
                                                </div>
                                                <p className="text-sm text-gray-700">
                                                    Showing <span className="font-medium">{filteredReviews.length === 0 ? 0 : (currentPage - 1) * (rowsPerPage === 'ALL' ? filteredReviews.length : rowsPerPage) + 1}</span> to <span className="font-medium">{Math.min(currentPage * (rowsPerPage === 'ALL' ? filteredReviews.length : rowsPerPage), filteredReviews.length)}</span> of <span className="font-medium">{filteredReviews.length}</span> results
                                                </p>
                                            </div>
                                            <div>
                                                <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
                                                    <button
                                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                                        disabled={currentPage === 1}
                                                        className="relative inline-flex items-center rounded-l-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
                                                    >
                                                        <span className="sr-only">Previous</span>
                                                        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                                            <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
                                                        </svg>
                                                    </button>
                                                    <span className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 focus:z-20 focus:outline-offset-0">
                                                        Page {currentPage} of {totalPages}
                                                    </span>
                                                    <button
                                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                                        disabled={currentPage === totalPages}
                                                        className="relative inline-flex items-center rounded-r-md px-2 py-2 text-gray-400 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus:z-20 focus:outline-offset-0 disabled:opacity-50"
                                                    >
                                                        <span className="sr-only">Next</span>
                                                        <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                                            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                                                        </svg>
                                                    </button>
                                                </nav>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                

                                <div className="mt-6">
                                    <div className="flex justify-end gap-4">
                                        <button 
                                            onClick={() => {
                                                if(unmappedJson.length > 0 && fieldMapping.size > 0) {
                                                    setCurrentStep('map_fields');
                                                } else if (updateMethod === 'editor') {
                                                    setCurrentStep('configure');
                                                } else {
                                                    setCurrentStep('upload');
                                                }
                                            }} 
                                            className="text-gray-600 hover:text-gray-900 px-4"
                                        >
                                            Back
                                        </button>
                                        <button onClick={() => setShowConfirmModal(true)} className="bg-green-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-green-700 flex items-center gap-2">
                                            Confirm & Update
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {currentStep === 'processing' && (
                        <>
                             <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 text-center relative">
                                <h2 className="text-2xl font-bold mb-4 text-blue-800 animate-pulse">Update in Progress</h2>
                                
                                <div className="py-8 max-w-lg mx-auto">
                                    <div className="flex justify-center gap-8 my-6">
                                        <div className="text-center">
                                            <p className="text-3xl font-bold text-green-500">{liveStats.success}</p>
                                            <p className="text-gray-500 font-medium text-xs uppercase tracking-wider mt-1">Success</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-3xl font-bold text-yellow-500">{liveStats.partial}</p>
                                            <p className="text-gray-500 font-medium text-xs uppercase tracking-wider mt-1">Partial</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-3xl font-bold text-red-500">{liveStats.error}</p>
                                            <p className="text-gray-500 font-medium text-xs uppercase tracking-wider mt-1">Failed</p>
                                        </div>
                                        {abortedCount > 0 && (
                                            <div className="text-center">
                                                <p className="text-3xl font-bold text-red-400">{liveStats.aborted}</p>
                                                <p className="text-gray-500 font-medium text-xs uppercase tracking-wider mt-1">Aborted</p>
                                            </div>
                                        )}
                                    </div>

                                    <ProgressBar 
                                        percentage={progress} 
                                        current={completedCount} 
                                        total={reviews.length} 
                                    />
                                    <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 rounded mt-6 text-sm flex items-center gap-2 justify-center text-left">
                                        <AlertIcon className="w-5 h-5 flex-shrink-0"/> Please keep this tab open and active. Do not let your computer sleep.
                                    </div>
                                    <p className="text-center text-sm text-gray-500 mt-4 font-mono">
                                        {loadingText.includes("Resolving") ? loadingText : "Sending data to Planday..."}
                                    </p>
                                    
                                    <div className="mt-8">
                                        <button 
                                            className="bg-white border rounded text-red-600 border-red-200 hover:bg-red-50 font-bold px-4 py-2 hover:border-red-400 w-full transition-colors"
                                            onClick={() => setShowAbortConfirm(true)}
                                            style={{opacity : abortRef.current ? 0.6 : 1, pointerEvents : abortRef.current ? 'none' : 'auto'}}
                                        >
                                            {abortRef.current ? 'Aborting...' : 'Abort Update'}
                                        </button>
                                    </div>
                                </div>
                                <ConfirmModal 
                                    isOpen={showAbortConfirm}
                                    onClose={() => setShowAbortConfirm(false)}
                                    onConfirm={() => {
                                        abortRef.current = true;
                                        setShowAbortConfirm(false);
                                    }}
                                    title="Abort Update"
                                    message="You are about to end the update process. Some users might have already received updates to their profiles. The process will stop as soon as the current requests finish. Are you sure you want to abort?"
                                    confirmText="Yes, Abort"
                                    cancelText="Cancel"
                                />
                             </div>
                        </>
                    )}
                    
                    {currentStep === 'summary' && (
                        <>
                            <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100">
                                <h2 className="text-3xl font-bold mb-6 text-gray-800 text-center">Update Complete</h2>
                                
                                {abortedCount > 0 && (
                                    <div className="mb-6 bg-red-50 border border-red-200 p-4 rounded-lg flex items-start gap-3">
                                        <AlertIcon className="w-6 h-6 text-red-600 mt-0.5" />
                                        <div>
                                            <h3 className="text-red-800 font-bold">Update Aborted</h3>
                                            <p className="text-red-700 text-sm mt-1">
                                                You cancelled the update process. <strong>{abortedCount}</strong> employee(s) were skipped and their information was not updated. 
                                                You can download the detailed results below to see exactly what was saved before you aborted.
                                            </p>
                                        </div>
                                    </div>
                                )}
                                
                                <div className="flex justify-center gap-12 mb-8">
                                    <div className="text-center">
                                        <p className="text-5xl font-bold text-green-500">{reviews.filter(r => r.status === 'success').length}</p>
                                        <p className="text-gray-500 font-medium mt-2">Successful</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-5xl font-bold text-yellow-500">{reviews.filter(r => r.status === 'partial').length}</p>
                                        <p className="text-gray-500 font-medium mt-2">Partial</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-5xl font-bold text-red-500">{reviews.filter(r => r.status === 'error').length}</p>
                                        <p className="text-gray-500 font-medium mt-2">Failed</p>
                                    </div>
                                    {abortedCount > 0 && (
                                        <div className="text-center">
                                            <p className="text-5xl font-bold text-red-400">{reviews.filter(r => r.status === 'aborted').length}</p>
                                            <p className="text-gray-500 font-medium mt-2">Aborted</p>
                                        </div>
                                    )}
                                </div>

                                <div className="mb-8 overflow-y-auto max-h-[400px] border rounded-lg">
                                    <table className="w-full text-left text-sm table-fixed">
                                        <thead className="bg-gray-50 sticky top-0 shadow-sm z-10">
                                            <tr>
                                                <th className="p-3 font-semibold text-gray-700 w-1/4">Employee</th>
                                                <th className="p-3 font-semibold text-gray-700 w-28">Status</th>
                                                <th className="p-3 font-semibold text-gray-700">Details</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {reviews.filter(r => r.status !== 'no_updates').map(r => (
                                                <tr key={r.employeeId} className="hover:bg-gray-50">
                                                    <td className="p-3 font-medium text-gray-900 align-top">{r.employeeName}</td>
                                                    <td className="p-3 align-top">
                                                        {r.status === 'success' && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Success</span>}
                                                        {r.status === 'partial' && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">Partial</span>}
                                                        {r.status === 'error' && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">Failed</span>}
                                                        {r.status === 'aborted' && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-100">Aborted</span>}
                                                    </td>
                                                    <td className="p-3 align-top">
                                                        <ResultBreakdown results={r.results} />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="flex justify-center gap-4">
                                    <button onClick={handleBackToTable} className="bg-white text-black border-2 border-black px-6 py-3 rounded-lg font-bold hover:bg-gray-50 flex items-center gap-2">
                                        Back to Table
                                    </button>
                                    <button onClick={handleExportResults} className="bg-green-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-green-700 flex items-center gap-2">
                                        <DownloadIcon className="w-5 h-5"/> Export Detailed Results
                                    </button>
                                    <button onClick={() => setCurrentStep('configure')} className="bg-blue-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-blue-700">
                                        Start New Update
                                    </button>
                                </div>
                            </div>
                        </>
                    )}

                </main>
                <ConfirmModal 
                    isOpen={showConfirmModal}
                    onClose={() => setShowConfirmModal(false)}
                    onConfirm={handleUpdate}
                    title="Confirm Update"
                    message={
                        <>
                            The update process is about to start. Note that <span className="text-blue-600 font-medium">{reviews.filter(r => r.status !== 'no_updates').length} employee(s) with updates pending</span> will be applied, not just the currently filtered ones. Are you ready to proceed?
                        </>
                    }
                    confirmText="Yes, I have finished reviewing the fields"
                    cancelText="Cancel"
                />
                <ConfirmModal
                    isOpen={columnToDelete !== null}
                    onClose={() => setColumnToDelete(null)}
                    onConfirm={() => {
                        if (columnToDelete) {
                            executeRemoveColumn(columnToDelete);
                            setColumnToDelete(null);
                        }
                    }}
                    title="Remove Column"
                    message={(() => {
                        if (!columnToDelete) return "Are you sure you wish to remove the column and all updates pending for this field?";
                        const lowerKey = columnToDelete.toLowerCase();
                        if (lowerKey.includes("fixed salary")) {
                            return "This column is part of the 'Fixed Salary' group. Removing it will also remove all related columns (Period, Expected working hours, Amount, Salary Code, Valid from). Are you sure you wish to proceed?";
                        }
                        if (lowerKey.includes("update - group ")) {
                            const cleanKey = columnToDelete.substring(9).trim();
                            const parts = cleanKey.split(" - ");
                            if (parts.length > 1) {
                                const groupName = parts.slice(1).join(" - ");
                                return `This column is part of the Group Rate for '${groupName}'. Removing it will also remove all related columns (Rate, Wage Type, Valid From, Salary Code). Are you sure you wish to proceed?`;
                            }
                        }
                        return "Are you sure you wish to remove the column and all updates pending for this field?";
                    })()}
                    confirmText="Remove Column"
                    cancelText="Cancel"
                />
                <ConfirmModal
                    isOpen={showClearTableConfirm}
                    onClose={() => setShowClearTableConfirm(false)}
                    onConfirm={handleClearTable}
                    title="Clear the table"
                    message="Are you sure you want to clear the entire table? This will remove all employees and updates from the editor."
                    confirmText="Clear Table"
                    cancelText="Cancel"
                />
                <ConfirmModal
                    isOpen={showRemoveSelectedConfirm}
                    onClose={() => setShowRemoveSelectedConfirm(false)}
                    onConfirm={handleRemoveSelected}
                    title="Remove Selected Employees"
                    message={`Are you sure you want to remove the ${selectedReviewIds.size} selected employee(s) from the table? This will omit them from being updated.`}
                    confirmText="Remove"
                    cancelText="Cancel"
                />

                {columnToRemap && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-50 backdrop-blur-sm p-4 transition-opacity">
                         <div className="bg-white rounded-xl shadow-2xl overflow-visible p-6 max-w-lg w-full transform transition-all scale-100 opacity-100">
                            <h3 className="text-xl font-bold mb-3 text-gray-900">Map column to a new portal field</h3>
                            <p className="text-sm text-gray-600 mb-6 leading-relaxed">
                                The field <strong>{columnToRemap.replace("UPDATE - ", "")}</strong> no longer exists in Planday. Please select a valid field to map this column to, or cancel to keep it as is.
                            </p>
                            <div className="mb-16 relative z-50">
                                 <SearchableSelect 
                                     options={availableFieldsToAddOptions}
                                     value={""} 
                                     onChange={(newCol) => handleRemapColumn(columnToRemap, newCol)}
                                     placeholder="-- Select new Field --"
                                     usePortal={false}
                                 />
                            </div>
                            <div className="flex justify-end mt-4">
                                 <button onClick={() => setColumnToRemap(null)} className="px-5 py-2.5 rounded-lg font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300">
                                     Cancel
                                 </button>
                            </div>
                         </div>
                    </div>
                )}
            </div>
            
            <HelpModal 
                isOpen={showHelpModal} 
                onClose={() => setShowHelpModal(false)}
            />
            {/* Stop Confirmation Modal */}
            {isStopModalOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900 bg-opacity-50 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 text-center transform transition-all">
                        <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                            <AlertIcon className="w-8 h-8" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">Stop Process?</h3>
                        <p className="text-gray-600 mb-6 font-medium">Are you sure you want to stop generating the template? If you do, the process will be canceled completely.</p>
                        <div className="flex flex-col sm:flex-row justify-center gap-4">
                            <button 
                                onClick={() => setIsStopModalOpen(false)}
                                className="bg-white border border-gray-300 text-gray-700 px-6 py-2.5 rounded-lg font-bold hover:bg-gray-50 transition-colors"
                            >
                                No, return to wait
                            </button>
                            <button 
                                onClick={() => {
                                    abortProcessRef.current = true;
                                    setIsStopModalOpen(false);
                                }}
                                className="bg-red-600 text-white px-6 py-2.5 rounded-lg font-bold hover:bg-red-700 transition-colors shadow-sm"
                            >
                                Yes, stop process
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <AppInfoFooter />
        </div>
    );
};

// Sub-components
const Checkbox: React.FC<{ label: string; checked: boolean; onChange: (c: boolean) => void }> = ({ label, checked, onChange }) => (
    <label className="flex items-center gap-3 cursor-pointer p-2 hover:bg-gray-50 rounded transition">
        <input type="checkbox" className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 bg-white border-gray-300" checked={checked} onChange={e => onChange(e.target.checked)} />
        <span className="text-gray-700 font-medium">{label}</span>
    </label>
);

const AuthForm: React.FC<{ onSuccess: (c: PlandayApiCredentials) => void }> = ({ onSuccess }) => {
    const [token, setToken] = useState('');
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if(token) onSuccess({ clientId: '13000bf2-dd1f-41ab-a1a0-eeec783f50d7', refreshToken: token });
    };
    return (
        <form onSubmit={handleSubmit} className="mt-6">
            <div className="mb-4">
                <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="token">
                    Refresh Token
                </label>
                <input
                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline bg-white"
                    id="token"
                    type="password"
                    placeholder="Enter your token here..."
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    required
                />
            </div>
            <div className="flex items-center justify-between">
                <button
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline w-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    type="submit"
                    disabled={!token}
                >
                    Connect
                </button>
            </div>
        </form>
    );
};

interface FieldSelectorProps {
    defs: DefinitionCollection;
    selectedSystem: Set<string>;
    setSelectedSystem: React.Dispatch<React.SetStateAction<Set<string>>>;
    selectedCustom: Set<string>;
    setSelectedCustom: React.Dispatch<React.SetStateAction<Set<string>>>;
    selectedDepartments: Set<number>;
    setSelectedDepartments: React.Dispatch<React.SetStateAction<Set<number>>>;
    selectedWages: Set<number>;
    setSelectedWages: React.Dispatch<React.SetStateAction<Set<number>>>;
    selectedSkills: Set<number>;
    setSelectedSkills: React.Dispatch<React.SetStateAction<Set<number>>>;
    showSystem: boolean;
    showCustom: boolean;
    showDepartments: boolean;
    showWages: boolean;
    showSkills: boolean;
    onNext: () => void;
    onBack: () => void;
}

const systemFieldsData = [
    { key: 'email', label: 'Email' },
    { key: 'birthDate', label: 'Birth Date' },
    { key: 'gender', label: 'Gender' },
    { key: 'ssn', label: 'Tax ID' },
    { key: 'street1', label: 'Street 1' },
    { key: 'street2', label: 'Street 2' },
    { key: 'zip', label: 'Zip' },
    { key: 'city', label: 'City' },
    { key: 'cellPhoneCountryCode', label: 'Mobile Country Code' },
    { key: 'cellPhone', label: 'Mobile' },
    { key: 'hiredFrom', label: 'Start/hired Date' },
    { key: 'jobTitle', label: 'Job Title' },
    { key: 'employeeTypeId', label: 'Employee Type' },
    { key: 'bankReg', label: 'Bank Registration No.' },
    { key: 'bankAcc', label: 'Bank Account No.' },
    { key: 'salaryIdentifier', label: 'Salary Identifier' }
];

const FieldSelector: React.FC<FieldSelectorProps> = ({ defs, selectedSystem, setSelectedSystem, selectedCustom, setSelectedCustom, selectedDepartments, setSelectedDepartments, selectedWages, setSelectedWages, selectedSkills, setSelectedSkills, showSystem, showCustom, showDepartments, showWages, showSkills, onNext, onBack }) => {
    const [systemSearch, setSystemSearch] = useState('');
    const [customSearch, setCustomSearch] = useState('');
    const [departmentSearch, setDepartmentSearch] = useState('');
    const [wageSearch, setWageSearch] = useState('');
    const [skillSearch, setSkillSearch] = useState('');

    const toggleSystemField = (key: string, checked: boolean) => {
        const next = new Set(selectedSystem);
        if (checked) next.add(key); else next.delete(key);
        setSelectedSystem(next);
    };

    const toggleCustomField = (key: string, checked: boolean) => {
        const next = new Set(selectedCustom);
        if (checked) next.add(key); else next.delete(key);
        setSelectedCustom(next);
    };

    const toggleDepartmentField = (id: number, checked: boolean) => {
        const next = new Set(selectedDepartments);
        if (checked) next.add(id); else next.delete(id);
        setSelectedDepartments(next);
    };

    const toggleWageField = (id: number, checked: boolean) => {
        const next = new Set(selectedWages);
        if (checked) next.add(id); else next.delete(id);
        setSelectedWages(next);
    };

    const toggleSkillField = (id: number, checked: boolean) => {
        const next = new Set(selectedSkills);
        if (checked) next.add(id); else next.delete(id);
        setSelectedSkills(next);
    };

    // Filter available system fields based on the defs
    const availableSystemFields = systemFieldsData.filter(sys => {
        if (['email', 'bankReg', 'bankAcc', 'salaryIdentifier'].includes(sys.key)) return true;
        if (defs.availableSystemFields.includes(sys.key)) return true;
        if (sys.key === 'cellPhoneCountryCode' && defs.availableSystemFields.includes('phoneCountryCode')) return true;
        if (sys.key === 'cellPhone' && defs.availableSystemFields.includes('phone')) return true;
        return false;
    });

    const filteredSystem = availableSystemFields.filter(f => f.label.toLowerCase().includes(systemSearch.toLowerCase()));
    const filteredCustom = defs.customFields.filter(f => f.description.toLowerCase().includes(customSearch.toLowerCase()));
    const filteredDepartments = defs.departments.filter(d => d.name.toLowerCase().includes(departmentSearch.toLowerCase()));

    return (
        <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 max-w-4xl mx-auto">
            <h2 className="text-2xl font-bold mb-2">Select Fields to Update</h2>
            <p className="text-gray-500 mb-6">Choose the specific HR and Custom fields you want to include in the update template.</p>
            
            <div className="space-y-8 max-h-[50vh] overflow-y-auto pr-4">
                {showSystem && (
                    <div>
                        <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
                            <div className="flex items-center gap-4">
                                <h3 className="font-semibold text-lg text-gray-800">
                                    System HR Fields <span className="text-sm font-normal text-gray-500">({selectedSystem.size}/{availableSystemFields.length})</span>
                                </h3>
                                <input 
                                    type="text" 
                                    placeholder="Search System HR..." 
                                    className="text-sm border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 px-2 py-1 placeholder-gray-400"
                                    value={systemSearch}
                                    onChange={e => setSystemSearch(e.target.value)}
                                />
                            </div>
                            <div className="flex gap-3 text-sm">
                                <button onClick={() => setSelectedSystem(new Set(availableSystemFields.map(f => f.key)))} className="text-blue-600 hover:text-blue-800">Select All</button>
                                <button onClick={() => setSelectedSystem(new Set())} className="text-gray-500 hover:text-gray-700">Clear All</button>
                            </div>
                        </div>
                        {filteredSystem.length === 0 ? <p className="text-gray-400 italic">No system fields match search.</p> : (
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {filteredSystem.map(f => (
                                    <Checkbox key={f.key} label={f.label} checked={selectedSystem.has(f.key)} onChange={c => toggleSystemField(f.key, c)} />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {showCustom && (
                    <div>
                        <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
                            <div className="flex items-center gap-4">
                                <h3 className="font-semibold text-lg text-gray-800">
                                    Custom Fields <span className="text-sm font-normal text-gray-500">({selectedCustom.size}/{defs.customFields.length})</span>
                                </h3>
                                <input 
                                    type="text" 
                                    placeholder="Search Custom Fields..." 
                                    className="text-sm border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 px-2 py-1 placeholder-gray-400"
                                    value={customSearch}
                                    onChange={e => setCustomSearch(e.target.value)}
                                />
                            </div>
                            <div className="flex gap-3 text-sm">
                                <button onClick={() => setSelectedCustom(new Set(defs.customFields.map(f => String(f.id))))} className="text-blue-600 hover:text-blue-800">Select All</button>
                                <button onClick={() => setSelectedCustom(new Set())} className="text-gray-500 hover:text-gray-700">Clear All</button>
                            </div>
                        </div>
                        {filteredCustom.length === 0 ? <p className="text-gray-400 italic">No custom fields match search.</p> : (
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {filteredCustom.map(f => (
                                    <Checkbox key={f.id} label={f.description} checked={selectedCustom.has(String(f.id))} onChange={c => toggleCustomField(String(f.id), c)} />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {showSkills && (
                    <div>
                        <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
                            <div className="flex items-center gap-4">
                                <h3 className="font-semibold text-lg text-gray-800">
                                    Skills <span className="text-sm font-normal text-gray-500">({selectedSkills.size}/{defs.skills.length})</span>
                                </h3>
                                <input 
                                    type="text" 
                                    placeholder="Search Skills..." 
                                    className="text-sm border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 px-2 py-1 placeholder-gray-400"
                                    value={skillSearch}
                                    onChange={e => setSkillSearch(e.target.value)}
                                />
                            </div>
                            <div className="flex gap-3 text-sm">
                                <button onClick={() => setSelectedSkills(new Set(defs.skills.map(s => s.id)))} className="text-blue-600 hover:text-blue-800">Select All</button>
                                <button onClick={() => setSelectedSkills(new Set())} className="text-gray-500 hover:text-gray-700">Clear All</button>
                            </div>
                        </div>
                        {defs.skills.length === 0 ? <p className="text-gray-400 italic">No Skills match search.</p> : (
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {defs.skills.map(s => {
                                    if (skillSearch && !s.name.toLowerCase().includes(skillSearch.toLowerCase())) return null;
                                    return (
                                        <Checkbox key={s.id} label={s.name} checked={selectedSkills.has(s.id)} onChange={c => toggleSkillField(s.id, c)} />
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {showDepartments && (
                    <div>
                        <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
                            <div className="flex items-center gap-4">
                                <h3 className="font-semibold text-lg text-gray-800">
                                    Departments <span className="text-sm font-normal text-gray-500">({selectedDepartments.size}/{defs.departments.length})</span>
                                </h3>
                                <input 
                                    type="text" 
                                    placeholder="Search Departments..." 
                                    className="text-sm border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 px-2 py-1 placeholder-gray-400"
                                    value={departmentSearch}
                                    onChange={e => setDepartmentSearch(e.target.value)}
                                />
                            </div>
                            <div className="flex gap-3 text-sm">
                                <button onClick={() => setSelectedDepartments(new Set(defs.departments.map(d => d.id)))} className="text-blue-600 hover:text-blue-800">Select All</button>
                                <button onClick={() => setSelectedDepartments(new Set())} className="text-gray-500 hover:text-gray-700">Clear All</button>
                            </div>
                        </div>
                        {filteredDepartments.length === 0 ? <p className="text-gray-400 italic">No departments match search.</p> : (
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {filteredDepartments.map(d => (
                                    <Checkbox key={d.id} label={d.name} checked={selectedDepartments.has(d.id)} onChange={c => toggleDepartmentField(d.id, c)} />
                                ))}
                            </div>
                        )}
                    </div>
                )}
                
                {showWages && (
                    <div>
                        <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-200">
                            <div className="flex items-center gap-4">
                                <h3 className="font-semibold text-lg text-gray-800">
                                    Employee groups and Wages <span className="text-sm font-normal text-gray-500">({selectedWages.size}/{defs.employeeGroups.length})</span>
                                </h3>
                                <input 
                                    type="text" 
                                    placeholder="Search Groups..." 
                                    className="text-sm border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 px-2 py-1 placeholder-gray-400"
                                    value={wageSearch}
                                    onChange={e => setWageSearch(e.target.value)}
                                />
                            </div>
                            <div className="flex gap-3 text-sm">
                                <button onClick={() => setSelectedWages(new Set(defs.employeeGroups.map(d => d.id)))} className="text-blue-600 hover:text-blue-800">Select All</button>
                                <button onClick={() => setSelectedWages(new Set())} className="text-gray-500 hover:text-gray-700">Clear All</button>
                            </div>
                        </div>
                        {defs.employeeGroups.length === 0 ? <p className="text-gray-400 italic">No Employee groups match search.</p> : (
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {defs.employeeGroups.map(d => {
                                    if (wageSearch && !d.name.toLowerCase().includes(wageSearch.toLowerCase())) return null;
                                    return (
                                        <Checkbox key={d.id} label={d.name} checked={selectedWages.has(d.id)} onChange={c => toggleWageField(d.id, c)} />
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>

            <hr className="my-8 border-gray-100" />
            <div className="flex justify-between items-center">
                <button onClick={onBack} className="text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 font-medium rounded-lg text-sm px-5 py-2.5">
                    &larr; Back
                </button>
                <button onClick={onNext} className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-bold hover:bg-blue-700">
                    Next &#8594;
                </button>
            </div>
        </div>
    );
};

export default App;