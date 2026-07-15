/**
 * Beta Tag Component
 * Shows a stylish "BETA" tag in the header that can be clicked
 */

import React from 'react';

export const BetaTag: React.FC = () => {
  return (
    <span
      className="inline-flex items-center justify-center px-4 py-1.5 bg-blue-500 text-white text-sm font-bold uppercase tracking-wide rounded-full shadow-md"
      style={{ marginLeft: '12px', position: 'relative', top: '-1px' }}
    >
      BETA
    </span>
  );
};