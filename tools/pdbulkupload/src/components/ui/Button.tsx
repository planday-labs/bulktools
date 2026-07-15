import React from 'react';

/**
 * Button component variants
 */
type ButtonVariant = 'primary' | 'secondary' | 'success' | 'error' | 'outline' | 'ghost';

/**
 * Button component sizes
 */
type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Props for the Button component
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  fullWidth?: boolean;
  children: React.ReactNode;
}

/**
 * Button Component
 * 
 * A flexible button component with multiple variants, sizes, and states.
 * Follows the design system defined in Tailwind CSS configuration.
 * 
 * Features:
 * - Multiple variants (primary, secondary, success, error, outline, ghost)
 * - Different sizes (sm, md, lg)
 * - Loading state with spinner
 * - Icon support with left/right positioning
 * - Full width option
 * - Accessibility features
 */
export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconPosition = 'left',
  fullWidth = false,
  disabled,
  className = '',
  children,
  ...props
}) => {
  /**
   * Get button variant classes
   */
  const getVariantClasses = (): string => {
    switch (variant) {
      case 'primary':
        return 'btn btn-primary';
      case 'secondary':
        return 'btn btn-secondary';
      case 'success':
        return 'btn btn-success';
      case 'error':
        return 'btn btn-error';
      case 'outline':
        return 'btn border border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50 focus:ring-gray-500';
      case 'ghost':
        return 'btn text-gray-700 hover:bg-gray-100 focus:ring-gray-500';
      default:
        return 'btn btn-primary';
    }
  };

  /**
   * Get button size classes
   */
  const getSizeClasses = (): string => {
    switch (size) {
      case 'sm':
        return 'px-3 py-1.5 text-sm';
      case 'md':
        return 'px-4 py-2 text-sm';
      case 'lg':
        return 'px-6 py-3 text-base';
      default:
        return 'px-4 py-2 text-sm';
    }
  };

  /**
   * Loading spinner component
   */
  const LoadingSpinner = () => (
    <svg
      className="animate-spin -ml-1 mr-2 h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );

  /**
   * Combine all CSS classes
   */
  const buttonClasses = [
    getVariantClasses(),
    getSizeClasses(),
    fullWidth ? 'w-full' : '',
    loading || disabled ? 'opacity-75 cursor-not-allowed' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={buttonClasses}
      disabled={loading || disabled}
      {...props}
    >
      {/* Loading state */}
      {loading && <LoadingSpinner />}
      
      {/* Left icon */}
      {!loading && icon && iconPosition === 'left' && (
        <span className="mr-2">{icon}</span>
      )}
      
      {/* Button content */}
      <span>{children}</span>
      
      {/* Right icon */}
      {!loading && icon && iconPosition === 'right' && (
        <span className="ml-2">{icon}</span>
      )}
    </button>
  );
}; 