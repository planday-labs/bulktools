import React from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';

interface DateFormatSelectionStepProps {
  samples: string[];
  onComplete: (selectedFormat?: 'DD/MM/YYYY' | 'MM/DD/YYYY') => void;
  onBack: () => void;
  className?: string;
}

interface FormatOption {
  format: string;
  description: string;
  example1: string;
  example2: string;
  mapsToPlandayFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY';
}

/**
 * Analyze sample dates to detect their format pattern and return the two ambiguous interpretations
 */
function detectFormatOptions(samples: string[]): { option1: FormatOption; option2: FormatOption } {
  if (samples.length === 0) {
    // Fallback if no samples
    return {
      option1: {
        format: 'MM/DD/YYYY',
        description: 'US format - Month/Day/Year',
        example1: '01/02/1984 → January 2, 1984',
        example2: '03/15/1984 → March 15, 1984',
        mapsToPlandayFormat: 'MM/DD/YYYY'
      },
      option2: {
        format: 'DD/MM/YYYY',
        description: 'European format - Day/Month/Year',
        example1: '01/02/1984 → February 1, 1984',
        example2: '15/03/1984 → March 15, 1984',
        mapsToPlandayFormat: 'DD/MM/YYYY'
      }
    };
  }

  const sample = samples[0].trim();

  // Pattern 1: Slash-separated dates (01/02/1984)
  if (sample.includes('/')) {
    if (sample.length >= 8 && sample.substring(0, 4).match(/^\d{4}$/)) {
      // YYYY/MM/DD vs YYYY/DD/MM pattern
      const year = sample.substring(0, 4);
      const part1 = sample.substring(5, 7);
      const part2 = sample.substring(8, 10);
      
      return {
        option1: {
          format: 'YYYY/MM/DD',
          description: 'Year/Month/Day format',
          example1: `${sample} → ${getMonthName(part1)} ${parseInt(part2)}, ${year}`,
          example2: '1984/03/15 → March 15, 1984',
          mapsToPlandayFormat: 'MM/DD/YYYY'
        },
        option2: {
          format: 'YYYY/DD/MM',
          description: 'Year/Day/Month format',
          example1: `${sample} → ${getMonthName(part2)} ${parseInt(part1)}, ${year}`,
          example2: '1984/15/03 → March 15, 1984',
          mapsToPlandayFormat: 'DD/MM/YYYY'
        }
      };
    } else {
      // MM/DD/YYYY vs DD/MM/YYYY pattern
      const part1 = sample.substring(0, 2);
      const part2 = sample.substring(3, 5);
      const year = sample.substring(6, 10);
      
      return {
        option1: {
          format: 'MM/DD/YYYY',
          description: 'US format - Month/Day/Year',
          example1: `${sample} → ${getMonthName(part1)} ${parseInt(part2)}, ${year}`,
          example2: '03/15/1984 → March 15, 1984',
          mapsToPlandayFormat: 'MM/DD/YYYY'
        },
        option2: {
          format: 'DD/MM/YYYY',
          description: 'European format - Day/Month/Year',
          example1: `${sample} → ${getMonthName(part2)} ${parseInt(part1)}, ${year}`,
          example2: '15/03/1984 → March 15, 1984',
          mapsToPlandayFormat: 'DD/MM/YYYY'
        }
      };
    }
  }

  // Pattern 2: Dot-separated dates (01.02.1984)
  if (sample.includes('.')) {
    if (sample.length >= 8 && sample.substring(0, 4).match(/^\d{4}$/)) {
      // YYYY.MM.DD vs YYYY.DD.MM pattern
      const year = sample.substring(0, 4);
      const part1 = sample.substring(5, 7);
      const part2 = sample.substring(8, 10);
      
      return {
        option1: {
          format: 'YYYY.MM.DD',
          description: 'Year.Month.Day format',
          example1: `${sample} → ${getMonthName(part1)} ${parseInt(part2)}, ${year}`,
          example2: '1984.03.15 → March 15, 1984',
          mapsToPlandayFormat: 'MM/DD/YYYY'
        },
        option2: {
          format: 'YYYY.DD.MM',
          description: 'Year.Day.Month format',
          example1: `${sample} → ${getMonthName(part2)} ${parseInt(part1)}, ${year}`,
          example2: '1984.15.03 → March 15, 1984',
          mapsToPlandayFormat: 'DD/MM/YYYY'
        }
      };
    } else {
      // MM.DD.YYYY vs DD.MM.YYYY pattern
      const part1 = sample.substring(0, 2);
      const part2 = sample.substring(3, 5);
      const year = sample.substring(6, 10);
      
      return {
        option1: {
          format: 'MM.DD.YYYY',
          description: 'Month.Day.Year format',
          example1: `${sample} → ${getMonthName(part1)} ${parseInt(part2)}, ${year}`,
          example2: '03.15.1984 → March 15, 1984',
          mapsToPlandayFormat: 'MM/DD/YYYY'
        },
        option2: {
          format: 'DD.MM.YYYY',
          description: 'Day.Month.Year format',
          example1: `${sample} → ${getMonthName(part2)} ${parseInt(part1)}, ${year}`,
          example2: '15.03.1984 → March 15, 1984',
          mapsToPlandayFormat: 'DD/MM/YYYY'
        }
      };
    }
  }

  // Pattern 3: Dash-separated dates (2024-01-01 or 01-01-2024)
  if (sample.includes('-')) {
    if (sample.length >= 8 && sample.substring(0, 4).match(/^\d{4}$/)) {
      // YYYY-MM-DD vs YYYY-DD-MM pattern
      const year = sample.substring(0, 4);
      const part1 = sample.substring(5, 7);
      const part2 = sample.substring(8, 10);
      
      return {
        option1: {
          format: 'YYYY-MM-DD',
          description: 'Year-Month-Day format',
          example1: `${sample} → ${getMonthName(part1)} ${parseInt(part2)}, ${year}`,
          example2: '1984-03-15 → March 15, 1984',
          mapsToPlandayFormat: 'MM/DD/YYYY'
        },
        option2: {
          format: 'YYYY-DD-MM',
          description: 'Year-Day-Month format',
          example1: `${sample} → ${getMonthName(part2)} ${parseInt(part1)}, ${year}`,
          example2: '1984-15-03 → March 15, 1984',
          mapsToPlandayFormat: 'DD/MM/YYYY'
        }
      };
    } else {
      // MM-DD-YYYY vs DD-MM-YYYY pattern
      const part1 = sample.substring(0, 2);
      const part2 = sample.substring(3, 5);
      const year = sample.substring(6, 10);
      
      return {
        option1: {
          format: 'MM-DD-YYYY',
          description: 'Month-Day-Year format',
          example1: `${sample} → ${getMonthName(part1)} ${parseInt(part2)}, ${year}`,
          example2: '03-15-1984 → March 15, 1984',
          mapsToPlandayFormat: 'MM/DD/YYYY'
        },
        option2: {
          format: 'DD-MM-YYYY',
          description: 'Day-Month-Year format',
          example1: `${sample} → ${getMonthName(part2)} ${parseInt(part1)}, ${year}`,
          example2: '15-03-1984 → March 15, 1984',
          mapsToPlandayFormat: 'DD/MM/YYYY'
        }
      };
    }
  }

  // Pattern 4: 8-digit dates (01021984 or 19840102)
  if (sample.length === 8 && /^\d{8}$/.test(sample)) {
    if (sample.substring(0, 2) === '19' || sample.substring(0, 2) === '20') {
      // YYYYMMDD vs YYYYDDMM pattern
      const year = sample.substring(0, 4);
      const part1 = sample.substring(4, 6);
      const part2 = sample.substring(6, 8);
      
      return {
        option1: {
          format: 'YYYYMMDD',
          description: 'Year Month Day (8-digit)',
          example1: `${sample} → ${getMonthName(part1)} ${parseInt(part2)}, ${year}`,
          example2: '19840315 → March 15, 1984',
          mapsToPlandayFormat: 'MM/DD/YYYY'
        },
        option2: {
          format: 'YYYYDDMM',
          description: 'Year Day Month (8-digit)',
          example1: `${sample} → ${getMonthName(part2)} ${parseInt(part1)}, ${year}`,
          example2: '19841503 → March 15, 1984',
          mapsToPlandayFormat: 'DD/MM/YYYY'
        }
      };
    } else {
      // MMDDYYYY vs DDMMYYYY pattern
      const part1 = sample.substring(0, 2);
      const part2 = sample.substring(2, 4);
      const year = sample.substring(4, 8);
      
      return {
        option1: {
          format: 'MMDDYYYY',
          description: 'Month Day Year (8-digit)',
          example1: `${sample} → ${getMonthName(part1)} ${parseInt(part2)}, ${year}`,
          example2: '03151984 → March 15, 1984',
          mapsToPlandayFormat: 'MM/DD/YYYY'
        },
        option2: {
          format: 'DDMMYYYY',
          description: 'Day Month Year (8-digit)',
          example1: `${sample} → ${getMonthName(part2)} ${parseInt(part1)}, ${year}`,
          example2: '15031984 → March 15, 1984',
          mapsToPlandayFormat: 'DD/MM/YYYY'
        }
      };
    }
  }

  // Fallback for unrecognized patterns
  return {
    option1: {
      format: 'MM/DD/YYYY',
      description: 'US format - Month/Day/Year',
      example1: `${sample} → (Month first interpretation)`,
      example2: '03/15/1984 → March 15, 1984',
      mapsToPlandayFormat: 'MM/DD/YYYY'
    },
    option2: {
      format: 'DD/MM/YYYY',
      description: 'European format - Day/Month/Year',
      example1: `${sample} → (Day first interpretation)`,
      example2: '15/03/1984 → March 15, 1984',
      mapsToPlandayFormat: 'DD/MM/YYYY'
    }
  };
}

/**
 * Helper function to get month name from month number
 */
function getMonthName(monthStr: string): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  
  const monthNum = parseInt(monthStr, 10);
  if (monthNum >= 1 && monthNum <= 12) {
    return months[monthNum - 1];
  }
  return `Month ${monthStr}`;
}

/**
 * Date Format Selection Step - Normal page component for resolving ambiguous date formats
 * Shows sample dates to help user decide between DD/MM/YYYY and MM/DD/YYYY
 * Replaces the previous modal approach with a proper workflow step
 */
export const DateFormatSelectionStep: React.FC<DateFormatSelectionStepProps> = ({
  samples,
  onComplete,
  onBack,
  className = ''
}) => {
  // Use actual user data for the example instead of hardcoded "20230405"
  const exampleDate = samples.length > 0 ? samples[0] : "20230405";

  // Detect the format options based on user's actual data
  const { option1, option2 } = detectFormatOptions(samples);

  const handleFormatSelection = (option: FormatOption) => {
    onComplete(option.mapsToPlandayFormat);
  };

  return (
    <div className={`date-format-selection-step ${className}`}>
      {/* Header */}
      <Card className="p-6 mb-6">
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-blue-600 text-2xl">📅</span>
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            Date Format Selection Required
          </h3>
          <p className="text-gray-600">
            Your Excel file contains dates like "<strong>{exampleDate}</strong>" that could be read as either
            month-first or day-first. Please tell us which one your <strong>source data</strong> uses so we read it correctly.
          </p>
        </div>
      </Card>

      {/* Sample Data */}
      {samples.length > 0 && (
        <Card className="p-6 mb-6">
          <h4 className="text-lg font-semibold text-gray-900 mb-3">
            Sample dates from your file:
          </h4>
          <div className="bg-gray-50 rounded-lg p-4">
            {samples.slice(0, 5).map((sample, index) => (
              <div key={index} className="text-gray-700 font-mono text-sm mb-1">
                {sample}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Format Selection Options */}
      <Card className="p-6 mb-6">
        <h4 className="text-lg font-semibold text-gray-900 mb-4">
          Choose your date format:
        </h4>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {/* Option 1 */}
          <div className="border-2 border-blue-300 rounded-lg p-6 hover:bg-blue-50 hover:border-blue-400 transition-colors cursor-pointer group">
            <h5 className="font-medium text-gray-900 mb-2">
              {option1.format}
            </h5>
            <p className="text-sm text-gray-600 mb-4">
              {option1.description}
            </p>
            <div className="text-xs text-gray-500 space-y-1 mb-4">
              <div>{option1.example1}</div>
              <div>{option1.example2}</div>
            </div>
            <Button
              onClick={() => handleFormatSelection(option1)}
              className="w-full group-hover:bg-blue-600 group-hover:text-white"
              variant="outline"
            >
              Select {option1.format}
            </Button>
          </div>

          {/* Option 2 */}
          <div className="border-2 border-blue-300 rounded-lg p-6 hover:bg-blue-50 hover:border-blue-400 transition-colors cursor-pointer group">
            <h5 className="font-medium text-gray-900 mb-2">
              {option2.format}
            </h5>
            <p className="text-sm text-gray-600 mb-4">
              {option2.description}
            </p>
            <div className="text-xs text-gray-500 space-y-1 mb-4">
              <div>{option2.example1}</div>
              <div>{option2.example2}</div>
            </div>
            <Button
              onClick={() => handleFormatSelection(option2)}
              className="w-full group-hover:bg-blue-600 group-hover:text-white"
              variant="outline"
            >
              Select {option2.format}
            </Button>
          </div>
        </div>

        <div className="text-sm text-gray-500 mb-4 p-3 bg-blue-50 rounded-lg">
          💡 <strong>Tip:</strong> Look at your sample dates above. For "{exampleDate}", if you know this follows 
          <strong> {option1.description.toLowerCase()}</strong>, choose the first option. 
          If it follows <strong> {option2.description.toLowerCase()}</strong>, choose the second option.
        </div>
      </Card>

      {/* Navigation */}
      <Card className="p-6">
        <div className="flex justify-between items-center">
          <Button
            onClick={onBack}
            variant="outline"
            className="text-gray-600 hover:bg-gray-50"
          >
            ← Back to Mapping
          </Button>
          
          <Button
            disabled
            variant="outline"
            className="text-gray-400 cursor-not-allowed"
          >
            Select date format above to continue →
          </Button>
        </div>
      </Card>
    </div>
  );
}; 