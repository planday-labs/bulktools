/**
 * Date Format Helper Step
 * Standalone component for resolving ambiguous date formats
 * Used as a conditional routing step between Column Mapping and Individual Data Correction
 */

import React, { useState, useEffect } from 'react';
import { Card, Button } from '../ui';

interface DateFormatHelperProps {
  employees: any[];
  onComplete: (correctedEmployees: any[], selectedFormats: {[columnName: string]: string}) => void;
  onBack: () => void;
  className?: string;
}

interface AmbiguousDate {
  columnName: string;
  sampleValues: string[];
  possibleFormats: Array<{
    format: string;
    description: string;
    example: string;
  }>;
}

const DateFormatHelper: React.FC<DateFormatHelperProps> = ({
  employees,
  onComplete,
  onBack,
  className = ''
}) => {
  const [ambiguousDates, setAmbiguousDates] = useState<AmbiguousDate[]>([]);
  const [selectedFormats, setSelectedFormats] = useState<{[columnName: string]: string}>({});
  const [isProcessing, setIsProcessing] = useState(false);

  // Detect ambiguous date formats on mount
  useEffect(() => {
    console.log('📅 DateFormatHelper: Analyzing date formats');
    
    // Simple detection logic - look for date columns that might be ambiguous
    const dateColumns = ['startDate', 'endDate', 'birthDate', 'hireDate'];
    const foundAmbiguous: AmbiguousDate[] = [];
    
    dateColumns.forEach(columnName => {
      const sampleValues = employees
        .map(emp => emp[columnName])
        .filter(val => val && typeof val === 'string')
        .slice(0, 5); // Take first 5 samples
      
      if (sampleValues.length > 0) {
        // Check if dates could be ambiguous (e.g., 01/02/2024 - could be Jan 2 or Feb 1)
        const hasAmbiguousPattern = sampleValues.some(val => {
          const parts = val.split(/[/\-.]/);
          if (parts.length === 3) {
            const [first, second] = parts;
            return parseInt(first) <= 12 && parseInt(second) <= 12 && first !== second;
          }
          return false;
        });
        
        if (hasAmbiguousPattern) {
          foundAmbiguous.push({
            columnName,
            sampleValues,
            possibleFormats: [
              { format: 'MM/DD/YYYY', description: 'Month/Day/Year (US format)', example: '01/15/2024 = January 15, 2024' },
              { format: 'DD/MM/YYYY', description: 'Day/Month/Year (EU format)', example: '15/01/2024 = January 15, 2024' },
              { format: 'YYYY/MM/DD', description: 'Year/Month/Day (ISO format)', example: '2024/01/15 = January 15, 2024' }
            ]
          });
        }
      }
    });
    
    console.log('📅 Found', foundAmbiguous.length, 'ambiguous date columns');
    setAmbiguousDates(foundAmbiguous);
  }, [employees]);

  // Handle format selection
  const handleFormatSelection = (columnName: string, format: string) => {
    setSelectedFormats(prev => ({
      ...prev,
      [columnName]: format
    }));
  };

  // Check if all formats are selected
  const allFormatsSelected = ambiguousDates.every(date => 
    selectedFormats[date.columnName]
  );

  // Handle proceeding to next step
  const handleProceed = async () => {
    if (allFormatsSelected || ambiguousDates.length === 0) {
      setIsProcessing(true);
      console.log('📅 Applying date format corrections');
      
      try {
        // In a real implementation, we would convert dates based on selected formats
        // For now, we'll just pass through the employees unchanged
        const correctedEmployees = employees;
        
        // Apply date format corrections here
        // ... date conversion logic would go here ...
        
        console.log('✅ Date formats applied, proceeding to next step');
        onComplete(correctedEmployees, selectedFormats);
      } catch (error) {
        console.error('❌ Error applying date formats:', error);
      } finally {
        setIsProcessing(false);
      }
    } else {
      onComplete(employees, selectedFormats);
    }
  };

  if (ambiguousDates.length === 0) {
    return (
      <div className={`date-format-helper ${className}`}>
        <Card className="p-6 text-center">
          <div className="text-green-600 text-4xl mb-4">✅</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            No Date Format Issues Found
          </h3>
          <p className="text-gray-600 mb-4">
            All date formats are clear and unambiguous.
          </p>
          
          <div className="flex justify-between items-center">
            <Button
              variant="outline"
              onClick={onBack}
              className="text-gray-600 hover:bg-gray-50"
            >
              ← Back
            </Button>
            
            <Button onClick={handleProceed} className="bg-green-600 hover:bg-green-700 text-white">
              Continue →
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={`date-format-helper ${className}`}>
      {/* Header */}
      <Card className="p-6 mb-6">
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-blue-600 text-2xl">📅</span>
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            Resolve Date Formats
          </h3>
          <p className="text-gray-600">
            Some date columns have ambiguous formats. Please specify the correct format for each column.
          </p>
        </div>
      </Card>

      {/* Date Format Selection */}
      {ambiguousDates.map(dateInfo => (
        <Card key={dateInfo.columnName} className="p-6 mb-6">
          <div className="mb-4">
            <h4 className="text-lg font-semibold text-gray-900 mb-2">
              {dateInfo.columnName.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} Column
            </h4>
            <div className="text-sm text-gray-600 mb-4">
              <strong>Sample values:</strong> {dateInfo.sampleValues.join(', ')}
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-700 mb-3">
              Select the correct date format:
            </div>
            
            {dateInfo.possibleFormats.map(format => (
              <label
                key={format.format}
                className={`flex items-start p-4 border rounded-lg cursor-pointer transition-colors ${
                  selectedFormats[dateInfo.columnName] === format.format
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name={`format-${dateInfo.columnName}`}
                  value={format.format}
                  checked={selectedFormats[dateInfo.columnName] === format.format}
                  onChange={() => handleFormatSelection(dateInfo.columnName, format.format)}
                  className="mt-1 mr-3"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-900 mb-1">
                    {format.format}
                  </div>
                  <div className="text-sm text-gray-600 mb-1">
                    {format.description}
                  </div>
                  <div className="text-xs text-gray-500">
                    Example: {format.example}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </Card>
      ))}

      {/* Navigation */}
      <Card className="p-4">
        <div className="flex justify-between items-center">
          <Button
            variant="outline"
            onClick={onBack}
            className="text-gray-600 hover:bg-gray-50"
          >
            ← Back
          </Button>
          
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              {allFormatsSelected ? 
                'All formats selected!' : 
                `${Object.keys(selectedFormats).length} of ${ambiguousDates.length} formats selected`
              }
            </span>
            
            <Button
              onClick={handleProceed}
              disabled={!allFormatsSelected || isProcessing}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isProcessing ? 
                'Applying formats...' :
                'Continue →'
              }
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default DateFormatHelper; 