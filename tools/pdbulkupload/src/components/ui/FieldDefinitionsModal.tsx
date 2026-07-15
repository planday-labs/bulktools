/**
 * Field Definitions Debug Modal
 * Displays the raw JSON response from the Planday field definitions API
 * for debugging field inconsistencies
 */

import React, { useState } from 'react';
import { Button } from './Button';
import { usePlandayApi } from '../../hooks/usePlandayApi';

interface FieldDefinitionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FieldDefinitionsModal: React.FC<FieldDefinitionsModalProps> = ({
  isOpen,
  onClose
}) => {
  const { fieldDefinitions, isAuthenticated, refreshFieldDefinitions, fieldDefinitionsError } = usePlandayApi();
  const [isCopied, setIsCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  if (!isOpen) return null;

  const jsonString = fieldDefinitions ? JSON.stringify(fieldDefinitions, null, 2) : 'Field definitions not loaded';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const handleRetry = async () => {
    setIsRefreshing(true);
    try {
      await refreshFieldDefinitions();
    } catch (error) {
      console.error('Failed to refresh field definitions:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-4xl h-[90vh] bg-white rounded-lg shadow-xl flex flex-col">
        {/* Header - Fixed height */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Planday Field Definitions (Raw JSON)
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Raw response from <code className="bg-gray-100 px-1 rounded">GET /hr/v1.0/employees/fielddefinitions</code>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleCopy}
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
            >
              {isCopied ? (
                <>
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy JSON
                </>
              )}
            </Button>
            <Button
              onClick={onClose}
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Close
            </Button>
          </div>
        </div>

        {/* Content - Flexible height with explicit overflow */}
        <div className="flex-1 p-6 overflow-hidden">
          {!isAuthenticated ? (
            <div className="text-center py-12">
              <div className="text-gray-400 text-lg mb-2">🔐</div>
              <p className="text-gray-600">Please authenticate first to view field definitions</p>
            </div>
          ) : fieldDefinitionsError ? (
            <div className="text-center py-12">
              <div className="text-red-400 text-lg mb-2">❌</div>
              <p className="text-gray-600 mb-4">Failed to load field definitions</p>
              <p className="text-sm text-red-600 mb-4">{fieldDefinitionsError}</p>
              <Button
                onClick={handleRetry}
                loading={isRefreshing}
                size="sm"
              >
                {isRefreshing ? 'Retrying...' : 'Retry'}
              </Button>
            </div>
          ) : !fieldDefinitions ? (
            <div className="text-center py-12">
              <div className="text-gray-400 text-lg mb-2">⏳</div>
              <p className="text-gray-600 mb-4">Loading field definitions...</p>
              <p className="text-sm text-gray-500 mb-4">
                This may take a moment after authentication
              </p>
              <div className="space-y-3">
                <Button
                  onClick={handleRetry}
                  loading={isRefreshing}
                  size="sm"
                  variant="outline"
                >
                  {isRefreshing ? 'Loading...' : 'Retry Load'}
                </Button>
                <div className="text-xs text-gray-400">
                  Debug: Auth={isAuthenticated ? 'Yes' : 'No'}, 
                  Definitions={fieldDefinitions ? 'Loaded' : 'Not loaded'}, 
                  Error={fieldDefinitionsError ? 'Yes' : 'No'}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col">
              {/* Summary Stats - Fixed height */}
              <div className="mb-4 p-4 bg-gray-50 rounded-lg flex-shrink-0">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="font-medium text-gray-900">Portal ID:</span>
                    <div className="text-gray-600">{fieldDefinitions.portalId}</div>
                  </div>
                  <div>
                    <span className="font-medium text-gray-900">Total Fields:</span>
                    <div className="text-gray-600">{Object.keys(fieldDefinitions.properties).length}</div>
                  </div>
                  <div>
                    <span className="font-medium text-gray-900">Required:</span>
                    <div className="text-gray-600">{(fieldDefinitions.required || []).length}</div>
                  </div>
                  <div>
                    <span className="font-medium text-gray-900">Read-only:</span>
                    <div className="text-gray-600">{(fieldDefinitions.readOnly || []).length}</div>
                  </div>
                </div>
              </div>

              {/* JSON Display - Scrollable with fixed height */}
              <div className="flex-1 bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
                <div className="h-full overflow-auto p-4">
                  <pre className="text-gray-800 text-xs leading-relaxed font-mono whitespace-pre-wrap text-left">
                    <code>{jsonString}</code>
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface FieldDefinitionsDebugButtonProps {
  className?: string;
}

export const FieldDefinitionsDebugButton: React.FC<FieldDefinitionsDebugButtonProps> = ({
  className = ''
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { isAuthenticated } = usePlandayApi();

  if (!isAuthenticated) {
    return null;
  }

  const debugIcon = (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );

  return (
    <>
      <Button
        onClick={() => setIsModalOpen(true)}
        variant="outline"
        size="sm"
        icon={debugIcon}
        iconPosition="left"
        className={className}
      >
        Debug Field Definitions
      </Button>
      
      <FieldDefinitionsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}; 