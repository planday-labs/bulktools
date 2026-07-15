import React, { useEffect, useState } from 'react';
import { Button } from './Button';

interface TemplateOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDownload: (options: { includeSupervisorColumns: boolean; includeFixedSalaryColumns: boolean }) => void;
}

export const TemplateOptionsModal: React.FC<TemplateOptionsModalProps> = ({
  isOpen,
  onClose,
  onDownload
}) => {
  const [includeSupervisorColumns, setIncludeSupervisorColumns] = useState(false);
  const [includeFixedSalaryColumns, setIncludeFixedSalaryColumns] = useState(false);

  // ESC key handler
  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscKey);
    }

    return () => {
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [isOpen, onClose]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIncludeSupervisorColumns(false);
      setIncludeFixedSalaryColumns(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDownload = () => {
    onDownload({ includeSupervisorColumns, includeFixedSalaryColumns });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">Template Options</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors flex items-center justify-center p-1"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            <p className="text-sm text-gray-600">
              Select which optional columns to include in the template:
            </p>

            {/* Fixed Salary Columns Option */}
            <label className="flex items-start space-x-3 p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
              <input
                type="checkbox"
                checked={includeFixedSalaryColumns}
                onChange={(e) => setIncludeFixedSalaryColumns(e.target.checked)}
                className="mt-0.5 h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Include Fixed Salary Columns</div>
                <p className="text-sm text-gray-500 mt-1">
                  Adds columns for setting fixed/monthly salary (Period, Expected Hours, Amount).
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  If any salary field is filled, all 3 must be provided.
                </p>
              </div>
            </label>

            {/* Supervisor Columns Option */}
            <label className="flex items-start space-x-3 p-4 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
              <input
                type="checkbox"
                checked={includeSupervisorColumns}
                onChange={(e) => setIncludeSupervisorColumns(e.target.checked)}
                className="mt-0.5 h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Include Supervisor Columns</div>
                <p className="text-sm text-gray-500 mt-1">
                  Adds columns for setting employees as supervisors and assigning supervisors to employees.
                </p>
                <p className="text-xs text-amber-600 mt-2">
                  Note: Make sure the supervisor feature is enabled in your Planday portal settings.
                </p>
              </div>
            </label>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end space-x-3 px-6 py-4 border-t border-gray-200">
            <Button onClick={onClose} variant="secondary">
              Cancel
            </Button>
            <Button onClick={handleDownload} variant="primary">
              Download Template
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
