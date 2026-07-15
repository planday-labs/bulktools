/**
 * Workflow App With Layout Component
 * 
 * Wrapper that combines WorkflowApp with WorkflowLayout
 * and handles the dynamic vertical centering based on current step
 */

import { useState } from 'react';
import { WorkflowLayout } from './layouts/WorkflowLayout';
import { WorkflowApp } from './WorkflowApp';
import { WorkflowStep } from '../constants';
import type { WorkflowStep as WorkflowStepType } from '../types/planday';

export function WorkflowAppWithLayout() {
  const [currentStep, setCurrentStep] = useState<WorkflowStepType>(WorkflowStep.Authentication);
  
  // Determine if we should center vertically (only on authentication step)
  const shouldCenterVertically = currentStep === WorkflowStep.Authentication;

  return (
    <WorkflowLayout centerVertically={shouldCenterVertically}>
      <WorkflowApp onStepChange={setCurrentStep} />
    </WorkflowLayout>
  );
} 