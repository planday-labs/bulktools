/**
 * Workflow Layout Component
 * Layout for the main 7-step workflow application
 * Includes the sparkling background and workflow-specific elements
 */

import React from 'react';

interface WorkflowLayoutProps {
  children: React.ReactNode;
  centerVertically?: boolean; // Controls vertical centering for authentication step
}

export const WorkflowLayout: React.FC<WorkflowLayoutProps> = ({ 
  children, 
  centerVertically = false 
}) => {
  return (
    <div className={`min-h-screen sparkling-background flex justify-center py-8 ${
      centerVertically ? 'items-center' : 'items-start'
    }`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full relative" style={{zIndex: 10}}>
        {children}
      </div>
    </div>
  );
}; 