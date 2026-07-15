/**
 * Phone Number Parser Utility
 * 
 * Intelligently parses phone numbers with automatic country code detection
 * Uses portal country information for smart defaults
 * Fallback to Denmark (DK) since Planday is a Danish company
 */

import { 
  COUNTRY_PHONE_MAPPINGS, 
  PORTAL_COUNTRY_MAPPING, 
  PHONE_PARSING_CONFIG 
} from '../constants';
import type { PhoneParseResult, CountryPhoneMapping } from '../types/planday';

export class PhoneParser {
  private static defaultCountry: string = PHONE_PARSING_CONFIG.DEFAULT_COUNTRY; // DK
  private static portalCountry: string | null = null;

  /**
   * Set the default country based on portal information
   * This is called after successful authentication when portal info is available
   */
  static setPortalCountry(portalCountry: string): void {
    this.portalCountry = portalCountry;
    
    // Map portal country to phone country code
    const mappedCountry = this.mapPortalCountryToPhoneCountry(portalCountry);
    this.defaultCountry = mappedCountry;
  }

  /**
   * Get current default country
   */
  static getDefaultCountry(): string {
    return this.defaultCountry;
  }

  /**
   * Get portal country if available
   */
  static getPortalCountry(): string | null {
    return this.portalCountry;
  }

  /**
   * Map portal country string to standardized phone country code
   */
  private static mapPortalCountryToPhoneCountry(portalCountry: string): string {
    // First try exact match in mapping
    const mapped = PORTAL_COUNTRY_MAPPING[portalCountry];
    if (mapped) {
      return mapped;
    }
    
    // If no mapping found, try to extract ISO code if it looks like one
    if (portalCountry.length === 2 && portalCountry.toUpperCase() === portalCountry) {
      const upperCase = portalCountry.toUpperCase();
      if (PHONE_PARSING_CONFIG.SUPPORTED_COUNTRIES.includes(upperCase as any)) {
        return upperCase;
      }
    }
    
    // Fallback to Denmark
    console.warn(`⚠️ Unknown portal country "${portalCountry}", defaulting to Denmark`);
    return PHONE_PARSING_CONFIG.DEFAULT_COUNTRY;
  }

  /**
   * Parse a phone number string into components
   * Main entry point for phone number parsing
   */
  static parsePhoneNumber(input: string): PhoneParseResult {
    if (!input || typeof input !== 'string') {
      return {
        isValid: false,
        originalInput: input || '',
        confidence: 0,
        error: 'Phone number is required'
      };
    }

    // Handle scientific notation from Excel (e.g., "4.47976E+11" -> "447976000000")
    let processedInput = input;
    if (input.includes('E+') || input.includes('e+')) {
      try {
        // Convert scientific notation to regular number
        const numericValue = parseFloat(input);
        if (!isNaN(numericValue)) {
          processedInput = Math.round(numericValue).toString();
          // Converted scientific notation from Excel
        }
      } catch {
        console.warn(`⚠️ Could not convert scientific notation: ${input}`);
      }
    }

    // Clean the input - remove spaces, dashes, parentheses
    const cleaned = processedInput.replace(/[\s\-()]/g, '');
    
    if (cleaned.length === 0) {
      return {
        isValid: false,
        originalInput: input,
        confidence: 0,
        error: 'Phone number cannot be empty'
      };
    }

    // Try to detect country code from the number itself
    const detected = this.detectCountryFromNumber(cleaned);
    
    if (detected.isValid) {
      return detected;
    }
    
    // If country was detected but invalid (wrong length), use that specific error
    if (detected.countryCode && detected.error) {
      return detected;
    }
    
    // If no country code detected and it's a reasonable local number length (6-9 digits), accept as local
    if (cleaned.length >= 6 && cleaned.length <= 9) {
      return {
        isValid: true,
        phoneNumber: cleaned,
        countryCode: this.defaultCountry,
        dialCode: '',
        confidence: 0.6, // Medium confidence for local numbers
        originalInput: cleaned,
        assumedCountry: true
      };
    }
    
    // For other cases, try with portal's default country
    const withDefault = this.parseWithDefaultCountry(cleaned);
    if (withDefault.isValid) {
      return withDefault;
    }
    
          // Special handling for scientific notation that wasn't properly converted
      if (input.includes('E+') || input.includes('e+')) {
        return {
          isValid: false,
          originalInput: input,
          confidence: 0,
          error: `Excel scientific notation detected (${input}). Please format the phone number column as "Text" in Excel to prevent this issue.`
        };
      }

      return {
        isValid: false,
        originalInput: input,
        confidence: 0,
        error: this.generateHelpfulErrorMessage(cleaned)
      };
  }

  /**
   * Try to detect country code from the phone number itself
   * Prioritizes common European market country codes (45, 46, 47, 44, 49)
   */
  private static detectCountryFromNumber(cleaned: string): PhoneParseResult {
    let workingNumber = cleaned;
    let hasInternationalIndicator = false;
    
    // Handle leading zeros (00 prefix for international dialing)
    if (workingNumber.startsWith('00')) {
      workingNumber = workingNumber.substring(2);
      hasInternationalIndicator = true;
    }
    
    // Remove leading + if present
    if (workingNumber.startsWith('+')) {
      workingNumber = workingNumber.substring(1);
      hasInternationalIndicator = true;
    }
    
    // Define main European market country codes that are commonly used in Excel
    const mainMarketCodes = ['45', '46', '47', '44', '49']; // Denmark, Sweden, Norway, UK, Germany
    
    // Only check for main market country codes if the number is 10+ digits
    // This prevents false positives like "47498384" being detected as a short Norwegian number
    if (workingNumber.length >= 10) {
      for (const dialCode of mainMarketCodes) {
        if (workingNumber.startsWith(dialCode)) {
          const mapping = COUNTRY_PHONE_MAPPINGS.find(m => m.dialCode === dialCode);
          if (mapping) {
            const phoneNumber = workingNumber.substring(dialCode.length);
            
            // Validate phone number length for this country
            if (phoneNumber.length >= mapping.minLength && 
                phoneNumber.length <= mapping.maxLength) {
              return {
                isValid: true,
                phoneNumber,
                countryCode: mapping.countryCode,
                dialCode: mapping.dialCode,
                countryId: mapping.countryId,
                confidence: 0.9, // High confidence for main market codes
                originalInput: cleaned,
                assumedCountry: false
              };
            } else {
              // Country code detected but length is wrong
              const countryName = this.getCountryName(mapping.countryCode);
              const inputFormatExample = this.getInputFormatExample(mapping.countryCode);
              let errorMessage = '';
              if (phoneNumber.length < mapping.minLength) {
                errorMessage = `Phone number too short for ${countryName}. Expected format: ${inputFormatExample}`;
              } else {
                errorMessage = `Phone number too long for ${countryName}. Expected format: ${inputFormatExample}`;
              }
              
              return {
                isValid: false,
                originalInput: cleaned,
                confidence: 0.8,
                error: errorMessage,
                countryCode: mapping.countryCode,
                dialCode: mapping.dialCode
              };
            }
          }
        }
      }
    }
    
    // Only try other country code detection if there's a clear international indicator
    // OR if the number is very long (11+ digits) suggesting international format
    if (hasInternationalIndicator || workingNumber.length >= 11) {
      // Try to match other known country codes, starting with longest dial codes first
      const sortedMappings = [...COUNTRY_PHONE_MAPPINGS]
        .filter(m => !mainMarketCodes.includes(m.dialCode)) // Exclude main markets (already checked)
        .sort((a, b) => b.dialCode.length - a.dialCode.length);
      
      for (const mapping of sortedMappings) {
        if (workingNumber.startsWith(mapping.dialCode)) {
          const phoneNumber = workingNumber.substring(mapping.dialCode.length);
          
          // Validate phone number length for this country
          if (phoneNumber.length >= mapping.minLength && 
              phoneNumber.length <= mapping.maxLength) {
            return {
              isValid: true,
              phoneNumber,
              countryCode: mapping.countryCode,
              dialCode: mapping.dialCode,
              countryId: mapping.countryId,
              confidence: hasInternationalIndicator ? 0.85 : 0.75, // Lower confidence for non-main markets
              originalInput: cleaned,
              assumedCountry: false
            };
          } else if (hasInternationalIndicator) {
            // Only show country-specific errors if there was an international indicator
            const countryName = this.getCountryName(mapping.countryCode);
            const inputFormatExample = this.getInputFormatExample(mapping.countryCode);
            let errorMessage = '';
            if (phoneNumber.length < mapping.minLength) {
              errorMessage = `Phone number too short for ${countryName}. Expected format: ${inputFormatExample}`;
            } else {
              errorMessage = `Phone number too long for ${countryName}. Expected format: ${inputFormatExample}`;
            }
            
            return {
              isValid: false,
              originalInput: cleaned,
              confidence: 0.8,
              error: errorMessage,
              countryCode: mapping.countryCode,
              dialCode: mapping.dialCode
            };
          }
        }
      }
    }
    
    return {
      isValid: false,
      originalInput: cleaned,
      confidence: 0,
      error: 'No valid country code detected in phone number'
    };
  }

  /**
   * Try parsing with the default country (from portal or fallback)
   */
  private static parseWithDefaultCountry(cleaned: string): PhoneParseResult {
    const countryMapping = this.getCountryMapping(this.defaultCountry);
    
    if (!countryMapping) {
      return {
        isValid: false,
        originalInput: cleaned,
        confidence: 0,
        error: `No phone format configuration for country: ${this.defaultCountry}`
      };
    }
    
    // Check if the number length fits this country (without country code)
    if (cleaned.length >= countryMapping.minLength && 
        cleaned.length <= countryMapping.maxLength) {
      
      // Calculate confidence based on whether we're using portal country or fallback
      const confidence = this.portalCountry ? 0.7 : 0.5;
      
      return {
        isValid: true,
        phoneNumber: cleaned,
        countryCode: countryMapping.countryCode,
        dialCode: countryMapping.dialCode,
        countryId: countryMapping.countryId,
        confidence,
        originalInput: cleaned,
        assumedCountry: true
      };
    }
    
    return {
      isValid: false,
      originalInput: cleaned,
      confidence: 0,
      error: `Phone number length doesn't match ${countryMapping.countryCode} format`
    };
  }

  /**
   * Get country mapping for a specific country code
   */
  private static getCountryMapping(countryCode: string): CountryPhoneMapping | null {
    return COUNTRY_PHONE_MAPPINGS.find(m => m.countryCode === countryCode) || null;
  }

  /**
   * Generate a helpful error message based on context
   */
  private static generateHelpfulErrorMessage(cleaned: string): string {
    const countryName = this.portalCountry || 'Denmark';
    const countryCode = this.defaultCountry;
    const countryMapping = this.getCountryMapping(countryCode);
    
    if (!countryMapping) {
      return `Invalid phone number format. Please include country code (e.g., +47 for Norway)`;
    }
    
    const inputFormatExample = this.getInputFormatExample(countryCode);
    
    if (cleaned.length < countryMapping.minLength) {
      return `Phone number too short for ${countryName}. Expected format: ${inputFormatExample}`;
    }
    
    if (cleaned.length > countryMapping.maxLength) {
      return `Phone number too long for ${countryName}. Expected format: ${inputFormatExample}`;
    }
    
    return `Invalid phone number format. Expected format for ${countryName}: ${inputFormatExample}`;
  }

  /**
   * Get country name from country code
   */
  private static getCountryName(countryCode: string): string {
    const countryNames: Record<string, string> = {
      'DK': 'Denmark',
      'NO': 'Norway', 
      'SE': 'Sweden',
      'FI': 'Finland',
      'IS': 'Iceland',
      'UK': 'United Kingdom',
      'DE': 'Germany',
      'FR': 'France',
      'IT': 'Italy',
      'ES': 'Spain',
      'NL': 'Netherlands',
      'CH': 'Switzerland',
      'BE': 'Belgium',
      'AT': 'Austria',
      'PL': 'Poland',
      'US': 'United States',
      'CA': 'Canada',
      'AU': 'Australia',
      'JP': 'Japan',
      'KR': 'South Korea',
      'CN': 'China',
      'BR': 'Brazil',
      'MX': 'Mexico',
      'IN': 'India',
      'ZA': 'South Africa',
      'SG': 'Singapore',
      'VN': 'Vietnam'
    };
    
    return countryNames[countryCode] || countryCode;
  }

  /**
   * Get input format example for error messages (how users should type it)
   * Shows LOCAL number format (without dial code) since country is provided separately
   */
  private static getInputFormatExample(countryCode: string): string {
    const examples: Record<string, string> = {
      'DK': '12345678',        // 8 digits
      'NO': '40055171',        // 8 digits
      'SE': '701234567',       // 9 digits
      'FI': '401234567',       // 8-9 digits
      'IS': '1234567',         // 7 digits
      'UK': '7911123456',      // 10-11 digits
      'DE': '15112345678',     // 10-12 digits
      'FR': '612345678',       // 9 digits
      'IT': '312345678',       // 9-11 digits
      'ES': '612345678',       // 9 digits
      'NL': '612345678',       // 9 digits
      'CH': '781234567',       // 9 digits
      'BE': '471234567',       // 8-9 digits
      'AT': '6641234567',      // 10-11 digits
      'PL': '501234567',       // 9 digits
      'US': '2025551234',      // 10 digits
      'CA': '4165551234',      // 10 digits
      'AU': '412345678',       // 9 digits
      'JP': '9012345678',      // 10-11 digits
      'KR': '10123456',        // 8-9 digits
      'CN': '13912345678',     // 11 digits
      'BR': '11987654321',     // 10-11 digits
      'MX': '5512345678',      // 10 digits
      'IN': '9876543210',      // 10 digits
      'ZA': '821234567',       // 9 digits
      'SG': '91234567',        // 8 digits
      'VN': '912345678'        // 9-10 digits
    };

    return examples[countryCode] || 'XXXXXXXX';
  }

  /**
   * Get example phone number for a country (display format with + and spaces)
   */
  static getExamplePhoneNumber(countryCode: string): string {
    const examples: Record<string, string> = {
      'DK': '+45 12345678',
      'NO': '+47 40055171',
      'SE': '+46 123456789',
      'FI': '+358 12345678',
      'IS': '+354 1234567',
      'UK': '+44 1234567890',
      'DE': '+49 1234567890',
      'FR': '+33 123456789',
      'IT': '+39 123456789',
      'ES': '+34 123456789',
      'NL': '+31 123456789',
      'CH': '+41 123456789',
      'BE': '+32 12345678',
      'AT': '+43 1234567890',
      'PL': '+48 123456789',
      'US': '+1 2345678901',
      'CA': '+1 2345678901',
      'AU': '+61 123456789',
      'JP': '+81 1234567890',
      'KR': '+82 12345678',
      'CN': '+86 12345678901',
      'BR': '+55 1234567890',
      'MX': '+52 1234567890',
      'IN': '+91 1234567890',
      'ZA': '+27 123456789',
      'SG': '+65 12345678',
      'VN': '+84 123456789'
    };
    
    return examples[countryCode] || '+XX XXXXXXXXXX';
  }

  /**
   * Format a parsed phone number for display
   */
  static formatPhoneNumber(parseResult: PhoneParseResult): string {
    if (!parseResult.isValid || !parseResult.phoneNumber || !parseResult.dialCode) {
      return parseResult.originalInput;
    }
    
    return `+${parseResult.dialCode} ${parseResult.phoneNumber}`;
  }

  /**
   * Get validation summary for debugging
   */
  static getValidationSummary(): string {
    const portalInfo = this.portalCountry ? `Portal: ${this.portalCountry}` : 'No portal info';
    const defaultInfo = `Default: ${this.defaultCountry}`;
    const supportedCount = COUNTRY_PHONE_MAPPINGS.length;
    
    return `Phone Parser Status: ${portalInfo}, ${defaultInfo}, ${supportedCount} countries supported`;
  }

  /**
   * Reset parser state (useful for testing)
   */
  static reset(): void {
    this.portalCountry = null;
    this.defaultCountry = PHONE_PARSING_CONFIG.DEFAULT_COUNTRY;
  }

  /**
   * Parse a phone number with user-specified country code
   * Simpler and more predictable than auto-detection
   */
  static parsePhoneNumberWithCountry(input: string, userCountryCode: string): PhoneParseResult {
    if (!input || typeof input !== 'string') {
      return {
        isValid: false,
        originalInput: input || '',
        confidence: 0,
        error: 'Phone number is required'
      };
    }

    if (!userCountryCode || typeof userCountryCode !== 'string') {
      return {
        isValid: false,
        originalInput: input,
        confidence: 0,
        error: 'Country code is required when cellPhone is provided'
      };
    }

    // Normalize country code (handle "Denmark" -> "DK", "Sweden" -> "SE", etc.)
    const normalizedCountryCode = this.normalizeCountryCode(userCountryCode.trim());
    if (!normalizedCountryCode) {
      return {
        isValid: false,
        originalInput: input,
        confidence: 0,
        error: `Unknown country "${userCountryCode}". Use country codes like DK, SE, NO or names like Denmark, Sweden, Norway`
      };
    }

    // Handle scientific notation from Excel (e.g., "4.47976E+11" -> "447976000000")
    let processedInput = input;
    if (input.includes('E+') || input.includes('e+')) {
      try {
        const numericValue = parseFloat(input);
        if (!isNaN(numericValue)) {
          processedInput = Math.round(numericValue).toString();
          // Converted scientific notation from Excel
        }
      } catch {
        console.warn(`⚠️ Could not convert scientific notation: ${input}`);
      }
    }

    // Clean the input - remove spaces, dashes, parentheses
    const cleaned = processedInput.replace(/[\s\-()]/g, '');
    
    if (cleaned.length === 0) {
      return {
        isValid: false,
        originalInput: input,
        confidence: 0,
        error: 'Phone number cannot be empty'
      };
    }

    // Get country mapping for the specified country
    const countryMapping = this.getCountryMapping(normalizedCountryCode);
    if (!countryMapping) {
      return {
        isValid: false,
        originalInput: input,
        confidence: 0,
        error: `Country "${normalizedCountryCode}" is not supported`
      };
    }

    // Remove leading + or 00 if present
    let workingNumber = cleaned;
    if (workingNumber.startsWith('+')) {
      workingNumber = workingNumber.substring(1);
    } else if (workingNumber.startsWith('00')) {
      workingNumber = workingNumber.substring(2);
    }

    // If number starts with the dial code for this country, remove it
    if (workingNumber.startsWith(countryMapping.dialCode)) {
      workingNumber = workingNumber.substring(countryMapping.dialCode.length);
              // Removed dial code from phone number
    }

    // Validate phone number length for this country
    if (workingNumber.length >= countryMapping.minLength && 
        workingNumber.length <= countryMapping.maxLength) {
      
      return {
        isValid: true,
        phoneNumber: workingNumber,
        countryCode: countryMapping.countryCode,
        dialCode: countryMapping.dialCode,
        countryId: countryMapping.countryId,
        confidence: 1.0, // High confidence since user specified country
        originalInput: input,
        assumedCountry: false
      };
    } else {
      // Length validation failed
      const countryName = this.getCountryName(countryMapping.countryCode);
      const inputFormatExample = this.getInputFormatExample(countryMapping.countryCode);
      let errorMessage = '';
      
      if (workingNumber.length < countryMapping.minLength) {
        errorMessage = `Phone number too short for ${countryName}. Expected format: ${inputFormatExample}`;
      } else {
        errorMessage = `Phone number too long for ${countryName}. Expected format: ${inputFormatExample}`;
      }
      
      return {
        isValid: false,
        originalInput: input,
        confidence: 0.8,
        error: errorMessage,
        countryCode: countryMapping.countryCode,
        dialCode: countryMapping.dialCode
      };
    }
  }

  /**
   * Normalize country code from user input
   * Handles both ISO codes (DK, SE) and country names (Denmark, Sweden)
   */
  private static normalizeCountryCode(input: string): string | null {
    const upperInput = input.toUpperCase();
    
    // Check if it's already a valid ISO code
    if (PHONE_PARSING_CONFIG.SUPPORTED_COUNTRIES.includes(upperInput as any)) {
      return upperInput;
    }
    
    // Try to map from country name to ISO code
    const mapped = PORTAL_COUNTRY_MAPPING[input];
    if (mapped && PHONE_PARSING_CONFIG.SUPPORTED_COUNTRIES.includes(mapped as any)) {
      return mapped;
    }
    
    return null;
  }
} 