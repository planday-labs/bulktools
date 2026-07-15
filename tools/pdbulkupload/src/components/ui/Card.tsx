import React from 'react';

/**
 * Card component variants
 */
type CardVariant = 'default' | 'elevated' | 'outlined' | 'flat' | 'outline';

/**
 * Card component padding sizes
 */
type CardPadding = 'none' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Props for the Card component
 */
export interface CardProps {
  variant?: CardVariant;
  padding?: CardPadding;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}

/**
 * Card Component
 * 
 * A flexible card container component for grouping related content.
 * Follows the design system defined in Tailwind CSS configuration.
 * 
 * Features:
 * - Multiple variants (default, elevated, outlined, flat)
 * - Configurable padding sizes
 * - Optional header and footer
 * - Clickable cards with hover states
 * - Accessibility features
 */
export const Card: React.FC<CardProps> = ({
  variant = 'default',
  padding = 'md',
  className = '',
  children,
  onClick,
  header,
  footer,
  onDragOver,
  onDragLeave,
  onDrop,
}) => {
  /**
   * Get card variant classes
   */
  const getVariantClasses = (): string => {
    switch (variant) {
      case 'default':
        return 'card';
      case 'elevated':
        return 'bg-white rounded-lg shadow-lg border border-gray-100';
      case 'outlined':
      case 'outline':
        return 'bg-white rounded-lg border-2 border-gray-200 shadow-sm';
      case 'flat':
        return 'bg-white rounded-lg';
      default:
        return 'card';
    }
  };

  /**
   * Get padding classes
   */
  const getPaddingClasses = (): string => {
    switch (padding) {
      case 'none':
        return 'p-0';
      case 'sm':
        return 'p-3';
      case 'md':
        return 'p-4';
      case 'lg':
        return 'p-6';
      case 'xl':
        return 'p-8';
      default:
        return 'p-4';
    }
  };

  /**
   * Get hover classes if card is clickable
   */
  const getHoverClasses = (): string => {
    if (onClick) {
      return 'cursor-pointer hover:shadow-md hover:border-gray-300 transition-all duration-200';
    }
    return '';
  };

  /**
   * Combine all CSS classes
   */
  const cardClasses = [
    getVariantClasses(),
    getHoverClasses(),
    onClick ? 'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  /**
   * Get content padding (adjust if header/footer present)
   */
  const getContentPadding = (): string => {
    if (header || footer) {
      return padding === 'none' ? 'p-0' : 'px-4 py-3';
    }
    return getPaddingClasses();
  };

  /**
   * Card content
   */
  const cardContent = (
    <>
      {/* Header */}
      {header && (
        <div className={`border-b border-gray-200 ${padding === 'none' ? 'p-0' : 'px-4 py-3'}`}>
          {header}
        </div>
      )}

      {/* Main Content */}
      <div className={getContentPadding()}>
        {children}
      </div>

      {/* Footer */}
      {footer && (
        <div className={`border-t border-gray-200 ${padding === 'none' ? 'p-0' : 'px-4 py-3'}`}>
          {footer}
        </div>
      )}
    </>
  );

  // Render clickable card
  if (onClick) {
    return (
      <div
        className={cardClasses}
        onClick={onClick}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Clickable card"
      >
        {cardContent}
      </div>
    );
  }

  // Render regular card
  return (
    <div 
      className={cardClasses}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {cardContent}
    </div>
  );
}; 