/**
 * Field Selection Modal Component
 * Provides an organized interface for selecting Planday fields when mapping Excel columns
 * Features:
 * - Grouped field organization (Required, Optional, Custom)
 * - Search/filter functionality
 * - Visual indicators for field properties
 * - Better UX than long dropdowns
 * - Button/tag-style field selection for improved visual organization
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Button } from './Button';
import { ValidationService, FieldDefinitionValidator } from '../../services/mappingService';

interface PlandayField {
  name: string;
  displayName: string;
  description?: string;
  isRequired: boolean;
  isReadOnly: boolean;
  isUnique: boolean;
  isCustom: boolean;
}

interface FieldSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectField: (fieldName: string) => void;
  availableFields: PlandayField[];
  currentMapping?: string;
  columnName: string;
}

export const FieldSelectionModal: React.FC<FieldSelectionModalProps> = ({
  isOpen,
  onClose,
  onSelectField,
  availableFields,
  currentMapping,
  columnName,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  // Reset search term when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
    }
  }, [isOpen]);

  // Filter fields based on search term
  const filteredFields = useMemo(() => {
    if (!searchTerm.trim()) return availableFields;
    
    const term = searchTerm.toLowerCase();
    return availableFields.filter(field => 
      field.displayName.toLowerCase().includes(term) ||
      field.name.toLowerCase().includes(term) ||
      (field.description && field.description.toLowerCase().includes(term))
    );
  }, [availableFields, searchTerm]);

  // Group fields by type and sort alphabetically within each group
  const groupedFields = useMemo(() => {
    const groups = {
      required: filteredFields.filter(field => field.isRequired).sort((a, b) => a.name.localeCompare(b.name)),
      departments: filteredFields.filter(field => field.name.startsWith('departments.')).sort((a, b) => a.displayName.localeCompare(b.displayName)),
      employeeGroups: filteredFields.filter(field => field.name.startsWith('employeeGroups.')).sort((a, b) => a.displayName.localeCompare(b.displayName)),
      optional: filteredFields.filter(field => 
        !field.isRequired && 
        !field.isCustom && 
        !field.name.startsWith('departments.') && 
        !field.name.startsWith('employeeGroups.')
      ).sort((a, b) => a.name.localeCompare(b.name)),
      custom: filteredFields.filter(field => field.isCustom).sort((a, b) => a.name.localeCompare(b.name)),
    };
    return groups;
  }, [filteredFields]);

  const handleFieldSelect = (fieldName: string) => {
    onSelectField(fieldName);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />
      
      {/* Modal - Made significantly wider */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Map Column: "{columnName}"
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                Select a Planday field to map this Excel column to
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Search */}
          <div className="p-6 border-b border-gray-200">
            <div className="relative">
              <input
                type="text"
                placeholder="Search fields..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <div className="absolute left-3 top-2.5">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
            {searchTerm && (
              <p className="text-sm text-gray-500 mt-2">
                Found {filteredFields.length} field{filteredFields.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>

          {/* Fields Grid - Updated layout for button/tag style */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-8">
              {/* Required Fields */}
              {groupedFields.required.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-4 flex items-center">
                    <span className="text-red-500 mr-2">📍</span>
                    Required ({groupedFields.required.length})
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    {groupedFields.required.map((field) => (
                      <FieldButton
                        key={field.name}
                        field={field}
                        isSelected={currentMapping === field.name}
                        onClick={() => handleFieldSelect(field.name)}
                        isInCustomSection={true}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Department Fields */}
              {groupedFields.departments.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-4 flex items-center">
                    <span className="text-green-500 mr-2">🏢</span>
                    Departments ({groupedFields.departments.length})
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    {groupedFields.departments.map((field) => (
                      <FieldButton
                        key={field.name}
                        field={field}
                        isSelected={currentMapping === field.name}
                        onClick={() => handleFieldSelect(field.name)}
                        isInCustomSection={true}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Employee Group Fields */}
              {groupedFields.employeeGroups.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-4 flex items-center">
                    <span className="text-orange-500 mr-2">👥</span>
                    Employee Groups ({groupedFields.employeeGroups.length})
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    {groupedFields.employeeGroups.map((field) => (
                      <FieldButton
                        key={field.name}
                        field={field}
                        isSelected={currentMapping === field.name}
                        onClick={() => handleFieldSelect(field.name)}
                        isInCustomSection={true}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Additional Fields */}
              {groupedFields.optional.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-4 flex items-center">
                    <span className="text-blue-500 mr-2">⚪</span>
                    Additional Fields ({groupedFields.optional.length})
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    {groupedFields.optional.map((field) => (
                      <FieldButton
                        key={field.name}
                        field={field}
                        isSelected={currentMapping === field.name}
                        onClick={() => handleFieldSelect(field.name)}
                        isInCustomSection={true}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Custom Fields */}
              {groupedFields.custom.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-4 flex items-center">
                    <span className="text-purple-500 mr-2">✨</span>
                    Custom Fields ({groupedFields.custom.length})
                  </h4>
                  <div className="flex flex-wrap gap-3">
                    {groupedFields.custom.map((field) => (
                      <FieldButton
                        key={field.name}
                        field={field}
                        isSelected={currentMapping === field.name}
                        onClick={() => handleFieldSelect(field.name)}
                        isInCustomSection={true}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* No results */}
              {filteredFields.length === 0 && (
                <div className="text-center py-8">
                  <div className="text-gray-400 mb-2">
                    <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 12h6m-6-4h6m2 5.291A7.962 7.962 0 0112 15c-2.34 0-4.484-.787-6.207-2.118M12 3c6.627 0 12 5.373 12 12 0 2.3-.648 4.447-1.757 6.207" />
                    </svg>
                  </div>
                  <p className="text-gray-500">No fields found matching "{searchTerm}"</p>
                  <Button 
                    variant="secondary" 
                    className="mt-3"
                    onClick={() => setSearchTerm('')}
                  >
                    Clear search
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end p-6 border-t border-gray-200 bg-gray-50">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Updated field component for button/tag style
interface FieldButtonProps {
  field: PlandayField;
  isSelected: boolean;
  onClick: () => void;
  isInCustomSection?: boolean;
}

const FieldButton: React.FC<FieldButtonProps> = ({ field, isSelected, onClick, isInCustomSection = false }) => {
  // Get custom field type information if available
  const customFieldInfo = field.isCustom 
    ? ValidationService.getCustomFieldsWithTypes().find(cf => cf.fieldName === field.name)
    : null;
  
  // Get enum options from field definitions for any field (not just custom)
  const enumOptions = (() => {
    try {
      return FieldDefinitionValidator.getFieldOptions(field.name);
    } catch {
      return [];
    }
  })();
  
  const isEnumField = enumOptions.length > 0;
  
  // Calculate if we need badges (excluding Custom when in custom section, Required and Read-only which go inline)
  const badges = [];
  if (field.isCustom && !isInCustomSection) badges.push({ text: 'Custom', color: 'bg-purple-100 text-purple-700' });
  if (field.isUnique) badges.push({ text: 'Unique', color: 'bg-blue-100 text-blue-700' });
  
  // Add custom field type badge if available
  if (customFieldInfo && isInCustomSection) {
    const typeName = ValidationService.getFieldTypeDisplayName(customFieldInfo.fieldType);
    badges.push({ text: typeName, color: 'bg-yellow-100 text-yellow-700' });
  }
  
  const hasBadges = badges.length > 0;
  const hasDescription = field.description && !isInCustomSection;
  const hasConversionHints = customFieldInfo && isInCustomSection;

  return (
    <button
      onClick={onClick}
      className={`
        relative px-3 py-2 rounded-lg border-2 transition-all duration-200 
        text-left hover:shadow-md group
        ${isInCustomSection ? 'w-auto min-w-fit' : 'w-full'}
        ${isSelected 
          ? 'border-green-500 bg-green-50 shadow-sm' 
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
        }
      `}
    >
      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute top-2 right-2">
          <div className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center">
            <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
      )}
      
      {/* Field name with inline tags */}
      <div className={`font-medium font-mono ${isSelected ? 'text-green-900' : 'text-gray-900'} ${isSelected ? 'pr-5' : 'pr-2'} flex items-center gap-2`}>
        <span>{field.isCustom ? (field.description || field.displayName || field.name) : (field.displayName || field.name)}</span>
        {field.isRequired && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs bg-red-100 text-red-600 font-sans font-normal">
            Required
          </span>
        )}
        {/* Note: Read-only badge removed - for bulk import (new employees), these fields CAN be set initially */}
      </div>
      
      {/* Field description (if available and not in custom section) */}
      {hasDescription && (
        <div className={`text-xs mt-1 ${isSelected ? 'pr-5' : 'pr-2'} ${isSelected ? 'text-green-700' : 'text-gray-500'}`}>
          {field.description}
        </div>
      )}
      
      {/* Custom field conversion hints */}
      {hasConversionHints && (
        <div className={`text-xs mt-1 ${isSelected ? 'pr-5' : 'pr-2'} ${isSelected ? 'text-green-600' : 'text-gray-400'}`}>
          {ValidationService.getConversionHints(customFieldInfo!.fieldType, field.name).map((hint, index) => (
            <div key={index} className="flex items-start gap-1">
              <span className="text-xs">•</span>
              <span>{hint}</span>
            </div>
          ))}
        </div>
      )}
      
      {/* Enum options from field definitions */}
      {isEnumField && (
        <div className={`text-xs mt-1 ${isSelected ? 'pr-5' : 'pr-2'} ${isSelected ? 'text-green-600' : 'text-gray-400'}`}>
          <div className="flex items-start gap-1">
            <span className="text-xs">📋</span>
            <div>
              <span className="font-medium">Options: </span>
              <span>
                {enumOptions.slice(0, 5).map(opt => opt.name).join(', ')}
                {enumOptions.length > 5 && ` (+${enumOptions.length - 5} more)`}
              </span>
            </div>
          </div>
        </div>
      )}
      
      {/* Field badges - excluding required and read-only which are now inline */}
      {hasBadges && (
        <div className={`flex flex-wrap gap-1 ${hasDescription || hasConversionHints ? 'mt-1' : 'mt-1'}`}>
          {badges.map((badge, index) => (
            <span
              key={index}
              className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${badge.color}`}
            >
              {badge.text}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}; 