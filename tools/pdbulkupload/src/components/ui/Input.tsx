import React, { forwardRef } from 'react';

/**
 * Input component sizes
 */
type InputSize = 'sm' | 'md' | 'lg';

/**
 * Props for the Input component
 */
export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  label?: string;
  error?: string;
  success?: string;
  helpText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

/**
 * Input Component
 * 
 * A flexible input component with validation states, labels, and icons.
 * Follows the design system defined in Tailwind CSS configuration.
 * 
 * Features:
 * - Automatic variant styling based on error/success props
 * - Different sizes (sm, md, lg)
 * - Label and help text support
 * - Error and success states with messages
 * - Left and right icon support
 * - Full width option
 * - Accessibility features
 * - Forward ref support for form libraries
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(({
  size = 'md',
  label,
  error,
  success,
  helpText,
  leftIcon,
  rightIcon,
  fullWidth = true,
  className = '',
  id,
  ...props
}, ref) => {
  // Generate unique ID for accessibility
  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

  /**
   * Get input variant classes
   */
  const getVariantClasses = (): string => {
    if (error) {
      return 'input input-error';
    }
    if (success) {
      return 'input border-success-300 focus:border-success-500 focus:ring-success-500';
    }
    return 'input';
  };

  /**
   * Get input size classes
   */
  const getSizeClasses = (): string => {
    switch (size) {
      case 'sm':
        return 'px-3 py-1.5 text-sm';
      case 'md':
        return 'px-3 py-2 text-sm';
      case 'lg':
        return 'px-4 py-3 text-base';
      default:
        return 'px-3 py-2 text-sm';
    }
  };

  /**
   * Get icon size classes
   */
  const getIconSize = (): string => {
    switch (size) {
      case 'sm':
        return 'w-4 h-4';
      case 'md':
        return 'w-5 h-5';
      case 'lg':
        return 'w-6 h-6';
      default:
        return 'w-5 h-5';
    }
  };

  /**
   * Combine all CSS classes for the input
   */
  const inputClasses = [
    getVariantClasses(),
    getSizeClasses(),
    fullWidth ? 'w-full' : '',
    leftIcon ? 'pl-10' : '',
    rightIcon ? 'pr-10' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  /**
   * Get label classes
   */
  const getLabelClasses = (): string => {
    return `block text-sm font-medium mb-1 ${
      error ? 'text-error-700' : success ? 'text-success-700' : 'text-gray-700'
    }`;
  };

  return (
    <div className={fullWidth ? 'w-full' : ''}>
      {/* Label */}
      {label && (
        <label htmlFor={inputId} className={getLabelClasses()}>
          {label}
          {props.required && <span className="text-error-500 ml-1">*</span>}
        </label>
      )}

      {/* Input Container */}
      <div className="relative">
        {/* Left Icon */}
        {leftIcon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <span className={`text-gray-400 ${getIconSize()}`}>
              {leftIcon}
            </span>
          </div>
        )}

        {/* Input Field */}
        <input
          ref={ref}
          id={inputId}
          className={inputClasses}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={
            error ? `${inputId}-error` :
            success ? `${inputId}-success` :
            helpText ? `${inputId}-help` : undefined
          }
          {...props}
        />

        {/* Right Icon */}
        {rightIcon && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <span className={`text-gray-400 ${getIconSize()}`}>
              {rightIcon}
            </span>
          </div>
        )}

        {/* Success Icon */}
        {success && !rightIcon && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <svg
              className={`text-success-500 ${getIconSize()}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        )}

        {/* Error Icon */}
        {error && !rightIcon && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <svg
              className={`text-error-500 ${getIconSize()}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <p
          id={`${inputId}-error`}
          className="mt-1 text-sm text-error-600"
          role="alert"
        >
          {error}
        </p>
      )}

      {/* Success Message */}
      {success && !error && (
        <p
          id={`${inputId}-success`}
          className="mt-1 text-sm text-success-600"
        >
          {success}
        </p>
      )}

      {/* Help Text */}
      {helpText && !error && !success && (
        <p
          id={`${inputId}-help`}
          className="mt-1 text-sm text-gray-500"
        >
          {helpText}
        </p>
      )}
    </div>
  );
});

// Set display name for debugging
Input.displayName = 'Input'; 