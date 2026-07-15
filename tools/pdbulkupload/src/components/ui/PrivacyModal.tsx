import React, { useEffect } from 'react';
import { Button } from './Button';

interface PrivacyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacyModal: React.FC<PrivacyModalProps> = ({ isOpen, onClose }) => {
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 min-h-[60px]">
            <h2 className="text-xl font-semibold text-gray-900">Privacy Statement</h2>
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
          <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
            <div className="prose prose-sm max-w-none text-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Planday Bulk Employee Uploader - Privacy Statement</h2>
              <p className="text-sm text-gray-600 mb-6"><strong>Last updated:</strong> June 23, 2025</p>

              <div className="bg-green-50 border-l-4 border-green-400 p-4 mb-6">
                <h3 className="text-base font-semibold text-green-900 mb-2">🛠️ Software Tool & Your Responsibilities</h3>
                <p className="text-sm text-green-800 mb-2">
                  <strong>You are the Data Controller</strong> - You process employee data using our software tool on your own device and are fully responsible for GDPR compliance.
                </p>
                <p className="text-sm text-green-800">
                  <strong>We are a Software Tool Provider</strong> - Like Excel or any client-side application, we provide JavaScript functionality that runs entirely on your device. We never see or access your data.
                </p>
              </div>

              <h3 className="text-base font-semibold text-gray-900 mb-2">Independent Client-Side Software Tool</h3>
              <p className="text-sm mb-4">
                <strong>This is an independent JavaScript application that runs entirely on your device.</strong> We are not affiliated with Planday or any Planday-affiliated company. 
                Like any software tool (Excel, web browsers, mobile apps), you download and run our code on your own device to accomplish your business objectives. 
                Your data flows directly from your device to Planday's servers without passing through our systems.
              </p>

              <h3 className="text-base font-semibold text-gray-900 mb-2">Software Tool Privacy Principles</h3>
              <p className="text-sm mb-4">
                Our software is designed with privacy by design. <strong>You process data on your own device using our software tool.</strong>
                Since we never receive, store, or access your data, traditional privacy concerns about third-party data handling do not apply. 
                This statement explains the technical architecture and confirms what data handling does and does not occur.
              </p>

              <h3 className="text-base font-semibold text-gray-900 mb-2">How Our Software Works</h3>
              <p className="text-sm mb-2">
                <strong>Our JavaScript software runs entirely on your device like any desktop application.</strong> The technical architecture ensures complete data sovereignty:
              </p>
              <ul className="text-sm mb-4 ml-4 list-disc space-y-1">
                <li><strong>Client-side execution</strong>: JavaScript code runs in your browser to parse Excel files, validate data, and provide user interface</li>
                <li><strong>Browser memory only</strong>: All data exists only in your browser's temporary memory while you use the software</li>
                <li><strong>Direct API communication</strong>: Your browser sends data directly to Planday's servers using our HTTP client functionality</li>
                <li><strong>No data transmission to us</strong>: We never receive, see, or have access to your employee data at any point</li>
                <li><strong>Automatic memory clearing</strong>: Data is automatically cleared when you close your browser or navigate away</li>
              </ul>

              <h3 className="text-base font-semibold text-gray-900 mb-2">Data Processing Location</h3>
              <ul className="text-sm mb-4 ml-4 list-disc space-y-1">
                <li><strong>Local processing</strong>: All data processing occurs locally on your device, wherever you are located</li>
                <li><strong>No intermediate servers</strong>: Your employee data is never transmitted to our servers or processed outside your browser</li>
                <li><strong>Direct to Planday</strong>: Data is sent directly from your browser to Planday's infrastructure</li>
                <li><strong>Planday's jurisdiction</strong>: Data sent to Planday follows their established data processing and storage policies as outlined in their privacy policy</li>
              </ul>

              <h3 className="text-base font-semibold text-gray-900 mb-2">What We Process vs. What We Don't Store</h3>
              <p className="text-sm mb-2">
                <strong>We process your data locally to provide the service, but never store it:</strong>
              </p>
              
              <p className="text-sm font-medium mb-1"><strong>What we process in your browser:</strong></p>
              <ul className="text-sm mb-3 ml-4 list-disc space-y-1">
                <li>Excel file parsing and data extraction</li>
                <li>Employee data validation and formatting</li>
                <li>Column mapping and department verification</li>
                <li>Data cleaning (phone numbers, dates, email formats)</li>
              </ul>

              <p className="text-sm font-medium mb-1"><strong>What we don't store or retain:</strong></p>
              <ul className="text-sm mb-4 ml-4 list-disc space-y-1">
                <li>Employee personal information after processing</li>
                <li>Excel files or their contents</li>
                <li>Authentication tokens beyond temporary browser session storage</li>
                <li>Usage analytics or detailed tracking data</li>
                <li>IP addresses or browser fingerprints</li>
              </ul>

              <h3 className="text-base font-semibold text-gray-900 mb-2">Authentication Security</h3>
              <ul className="text-sm mb-4 ml-4 list-disc space-y-1">
                <li><strong>Token security</strong>: Your Planday refresh tokens are stored only in your browser's memory during the session</li>
                <li><strong>Automatic cleanup</strong>: All authentication data is automatically cleared when you close your browser</li>
                <li><strong>No persistent storage</strong>: We do not save or remember your credentials between sessions</li>
              </ul>

              <h3 className="text-base font-semibold text-gray-900 mb-2">Third-Party Services</h3>
              <p className="text-sm mb-2">Our application communicates exclusively with:</p>
              <ul className="text-sm mb-4 ml-4 list-disc space-y-1">
                <li><strong>Planday API</strong>: For employee creation and department validation (covered by Planday's privacy policy - we are not affiliated with Planday)</li>
                <li><strong>Netlify hosting</strong>: Static application hosting with no data processing capabilities</li>
              </ul>

              <h3 className="text-base font-semibold text-gray-900 mb-2">Your Control as Data Controller</h3>
              <p className="text-sm mb-2">You maintain complete control over your data processing activities when using our software:</p>
              <ul className="text-sm mb-4 ml-4 list-disc space-y-1">
                <li><strong>Full data sovereignty</strong>: Your data remains on your device under your exclusive control</li>
                <li><strong>Software usage decisions</strong>: You decide whether, when, and how to use our software tool</li>
                <li><strong>Data processing control</strong>: You control what data to upload, how to format it, and when to transmit</li>
                <li><strong>GDPR responsibility</strong>: You are responsible for legal basis, employee consent, and all data protection compliance</li>
                <li><strong>Immediate termination</strong>: Simply close your browser to end all data processing</li>
                <li><strong>Complete transparency</strong>: You can review all data before transmission and control every step</li>
                <li><strong>Third-party management</strong>: You manage your own relationships with Planday and employees</li>
              </ul>

              <h3 className="text-base font-semibold text-gray-900 mb-2">Technical Safeguards</h3>
              <ul className="text-sm mb-4 ml-4 list-disc space-y-1">
                <li><strong>HTTPS encryption</strong>: All communications are encrypted in transit</li>
                <li><strong>Client-side validation</strong>: Data validation occurs locally in your browser before any transmission</li>
                <li><strong>Fail-safe processing</strong>: Uploads stop on first error; some records may already be created before the error occurs</li>
                <li><strong>No server-side logging</strong>: We do not log, store, or monitor your data processing activities on our servers</li>
                <li><strong>Automatic cleanup</strong>: All processed data is cleared from browser memory when you close the application</li>
              </ul>

              <h3 className="text-base font-semibold text-gray-900 mb-2">Open Source Transparency</h3>
              <p className="text-sm mb-4">
                This application is open source. You can review the complete source code, including all data handling and network communications, at 
                <a 
                  href="https://github.com/Lushbits/pdbulkupload" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="ml-1 underline hover:text-gray-800"
                >
                  github.com/Lushbits/pdbulkupload
                </a>
              </p>

              <h3 className="text-base font-semibold text-gray-900 mb-2">Changes to This Statement</h3>
              <p className="text-sm mb-4">
                Since we don't store user contact information, we cannot notify users of changes. Any updates to this privacy statement will be reflected in the current version available when you use the software. Users are responsible for reviewing the current privacy statement during each use.
              </p>

              <div className="border-t border-gray-200 pt-4 mt-6">
                <p className="text-sm font-medium text-gray-900">
                  <strong>Summary:</strong> You use our client-side software tool to process employee data entirely on your own device. 
                  We are a software provider (like Microsoft Excel) - we never receive, store, or access your data. 
                  You are the Data Controller responsible for all GDPR compliance. Your data flows directly from your browser to Planday without involving our servers.
                </p>
              </div>
            </div>
          </div>
          
          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200">
            <div className="flex items-center text-sm text-gray-600">
              <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              <span>
                <a 
                  href="https://github.com/Lushbits/pdbulkupload" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="underline hover:text-gray-800"
                >
                  Open Source on GitHub
                </a>
              </span>
            </div>
            <Button onClick={onClose} variant="primary">
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}; 