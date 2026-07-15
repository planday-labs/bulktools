import React from 'react';
import { MAIN_WORKFLOW_STEPS } from '../../constants';
import type { WorkflowStep as WorkflowStepType } from '../../types/planday';

/**
 * Props for the ProgressIndicator component
 */
interface ProgressIndicatorProps {
  currentStep: WorkflowStepType;
  completedSteps: WorkflowStepType[];
  className?: string;
}

/**
 * ProgressIndicator Component
 * 
 * Visual workflow showing: Authentication → Upload → Mapping → Validation → Preview → Upload → Results
 * - Current step highlighting with completed step indicators
 * - Clear visual feedback for user's position in the workflow
 * - Responsive design for desktop and mobile
 * 
 * As specified in PRD requirements for step-by-step progress indicator
 */
export const ProgressIndicator: React.FC<ProgressIndicatorProps> = ({
  currentStep,
  completedSteps,
  className = '',
}) => {
  /**
   * Determine the status of each step
   */
  const getStepStatus = (step: WorkflowStepType): 'completed' | 'current' | 'pending' => {
    if (completedSteps.includes(step)) {
      return 'completed';
    }
    if (step === currentStep) {
      return 'current';
    }
    return 'pending';
  };

  /**
   * Get the CSS classes for each step status
   */
  const getStepClasses = (status: 'completed' | 'current' | 'pending'): string => {
    const baseClasses = 'progress-step';
    
    switch (status) {
      case 'completed':
        return `${baseClasses} progress-step-completed`;
      case 'current':
        return `${baseClasses} progress-step-current`;
      case 'pending':
        return `${baseClasses} progress-step-pending`;
      default:
        return baseClasses;
    }
  };

  /**
   * Get the connector line classes between steps
   */
  const getConnectorClasses = (fromStep: WorkflowStepType, toStep: WorkflowStepType): string => {
    const isFromCompleted = completedSteps.includes(fromStep);
    const isToCompleted = completedSteps.includes(toStep);
    const isFromCurrent = fromStep === currentStep;
    
    if (isFromCompleted && (isToCompleted || toStep === currentStep)) {
      return 'bg-success-600';
    } else if (isFromCurrent || isFromCompleted) {
      return 'bg-primary-600';
    }
    return 'bg-gray-300';
  };

  /**
   * Get the icon for each step status
   */
  const getStepIcon = (stepIndex: number, status: 'completed' | 'current' | 'pending'): React.ReactNode => {
    if (status === 'completed') {
      return (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      );
    }
    
    return <span className="text-sm font-medium">{stepIndex + 1}</span>;
  };

  return (
    <div className={`w-full ${className}`}>
      {/* Desktop Progress Indicator */}
      <div className="hidden md:block">
        <div className="flex items-center justify-center">
          {MAIN_WORKFLOW_STEPS.map((step, index) => {
            const status = getStepStatus(step.key);
            const isLast = index === MAIN_WORKFLOW_STEPS.length - 1;

            return (
              <div key={step.key} className="flex items-center">
                {/* Step Circle */}
                <div className="flex flex-col items-center">
                  <div className={getStepClasses(status)}>
                    {getStepIcon(index, status)}
                  </div>
                  
                  {/* Step Label */}
                  <div className="mt-2 text-center">
                    <div className={`text-sm font-medium ${
                      status === 'current' ? 'text-primary-600' :
                      status === 'completed' ? 'text-success-600' :
                      'text-gray-500'
                    }`}>
                      {step.label}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {step.description}
                    </div>
                  </div>
                </div>

                {/* Connector Line */}
                {!isLast && (
                  <div className="mx-4 w-16">
                    <div className={`h-0.5 transition-colors duration-300 ${
                      getConnectorClasses(step.key, MAIN_WORKFLOW_STEPS[index + 1].key)
                    }`} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile Progress Indicator */}
      <div className="md:hidden">
        <div className="space-y-4">
          {MAIN_WORKFLOW_STEPS.map((step, index) => {
            const status = getStepStatus(step.key);
            const isLast = index === MAIN_WORKFLOW_STEPS.length - 1;

            return (
              <div key={step.key} className="flex items-start">
                {/* Step Circle and Connector */}
                <div className="flex flex-col items-center mr-4">
                  <div className={getStepClasses(status)}>
                    {getStepIcon(index, status)}
                  </div>
                  
                  {/* Vertical Connector */}
                  {!isLast && (
                    <div className={`w-0.5 h-8 mt-2 transition-colors duration-300 ${
                      getConnectorClasses(step.key, MAIN_WORKFLOW_STEPS[index + 1].key)
                    }`} />
                  )}
                </div>

                {/* Step Content */}
                <div className="flex-1 pb-4">
                  <div className={`text-sm font-medium ${
                    status === 'current' ? 'text-primary-600' :
                    status === 'completed' ? 'text-success-600' :
                    'text-gray-500'
                  }`}>
                    {step.label}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {step.description}
                  </div>
                  
                  {/* Current Step Indicator */}
                  {status === 'current' && (
                    <div className="mt-2 text-xs text-primary-600 font-medium">
                      Current Step
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Progress Bar - Temporarily commented out */}
      {/* <div className="mt-8">
        <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
          <span>Progress</span>
          <span>
            {completedSteps.length + (currentStep ? 1 : 0)} of {MAIN_WORKFLOW_STEPS.length} steps
          </span>
        </div>
        
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-primary-600 h-2 rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${((completedSteps.length + (currentStep ? 1 : 0)) / WORKFLOW_STEPS.length) * 100}%`
            }}
          />
        </div>
      </div> */}
    </div>
  );
}; 