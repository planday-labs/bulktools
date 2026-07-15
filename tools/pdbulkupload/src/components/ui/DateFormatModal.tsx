import React from 'react';
import { Button } from './Button';
import { Card } from './Card';

interface DateFormatModalProps {
  isOpen: boolean;
  onClose: (selectedFormat?: 'DD/MM/YYYY' | 'MM/DD/YYYY') => void;
  samples: string[];
}

/**
 * Modal for selecting date format when ambiguous
 * Shows sample dates to help user decide between DD/MM/YYYY and MM/DD/YYYY
 */
export const DateFormatModal: React.FC<DateFormatModalProps> = ({
  isOpen,
  onClose,
  samples,
}) => {
  if (!isOpen) return null;

  const handleFormatSelection = (format: 'DD/MM/YYYY' | 'MM/DD/YYYY') => {
    onClose(format);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <Card className="w-full max-w-2xl mx-4 p-6">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            📅 Date Format Selection Required
          </h2>
          
          <p className="text-gray-600 mb-6">
            Your Excel file contains ambiguous 8-digit dates like "20230405" in date fields that could be interpreted in multiple ways. 
            Please specify what format your <strong>source data</strong> is in so we can parse it correctly. 
            <br /><span className="text-sm text-gray-500 mt-2 block">
              (All dates will be converted to YYYY-MM-DD format for Planday)
            </span>
          </p>

          {samples.length > 0 && (
            <div className="mb-6">
              <p className="text-sm text-gray-500 mb-2">
                Sample dates from your file:
              </p>
              <div className="bg-gray-50 rounded-lg p-3 text-sm font-mono">
                {samples.slice(0, 5).map((sample, index) => (
                  <div key={index} className="text-gray-700">
                    {sample}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="border rounded-lg p-4 hover:bg-blue-50 transition-colors">
              <h3 className="font-medium text-gray-900 mb-2">
                YYYY-DD-MM Format
              </h3>
              <p className="text-sm text-gray-600 mb-3">
                European/International format<br />
                Year, then day, then month
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <div>20230405 → 2023-05-04 (May 4, 2023)</div>
                <div>20241503 → 2024-03-15 (March 15, 2024)</div>
              </div>
              <Button
                onClick={() => handleFormatSelection('DD/MM/YYYY')}
                className="w-full mt-3"
                variant="outline"
              >
                Select YYYY-DD-MM
              </Button>
            </div>

            <div className="border rounded-lg p-4 hover:bg-blue-50 transition-colors">
              <h3 className="font-medium text-gray-900 mb-2">
                YYYY-MM-DD Format
              </h3>
              <p className="text-sm text-gray-600 mb-3">
                US/ISO format<br />
                Year, then month, then day
              </p>
              <div className="text-xs text-gray-500 space-y-1">
                <div>20230405 → 2023-04-05 (April 5, 2023)</div>
                <div>20240315 → 2024-03-15 (March 15, 2024)</div>
              </div>
              <Button
                onClick={() => handleFormatSelection('MM/DD/YYYY')}
                className="w-full mt-3"
                variant="outline"
              >
                Select YYYY-MM-DD
              </Button>
            </div>
          </div>

          <div className="text-xs text-gray-500 mb-4">
            💡 <strong>Tip:</strong> Look at your sample 8-digit dates above. For "20230405", if you know this should be 
            <strong>April 5th</strong>, choose YYYY-MM-DD. If it should be <strong>May 4th</strong>, choose YYYY-DD-MM.
          </div>

          <div className="flex justify-center">
            <Button
              onClick={() => onClose()}
              variant="ghost"
              className="text-gray-500"
            >
              Cancel Upload
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}; 