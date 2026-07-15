import React, { useEffect } from 'react';
import { Button } from './Button';

interface TermsOfServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const TermsOfServiceModal: React.FC<TermsOfServiceModalProps> = ({ isOpen, onClose }) => {
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
            <h2 className="text-xl font-semibold text-gray-900">Terms of Service</h2>
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
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Planday Bulk Employee Uploader - Terms of Service</h2>
              <p className="text-sm text-gray-600 mb-6"><strong>Last updated:</strong> June 23, 2025</p>

              <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6">
                <h3 className="text-base font-semibold text-blue-900 mb-2">⚖️ Software Tool & GDPR Responsibilities</h3>
                <p className="text-sm text-blue-800 mb-2">
                  <strong>You are the Data Controller</strong> - You process employee data using our software tool on your own device.
                </p>
                <p className="text-sm text-blue-800">
                  <strong>We are a Software Tool Provider</strong> - Like Excel or any JavaScript library, we provide technical functionality but have no role in your data processing.
                </p>
              </div>

              <h3 className="text-base font-semibold text-gray-900 mb-2">1. Software Tool Description & Independent Status</h3>
              <p className="text-sm mb-4">
                This is an <strong>independent client-side software tool</strong> that provides JavaScript functionality to help you format and upload employee data to Planday via their public API. 
                We are not affiliated with, endorsed by, or controlled by Planday ApS. Like any software tool (Excel, web browsers, JavaScript libraries), 
                you use our code on your own device to accomplish your business objectives.
              </p>

              <h3 className="text-base font-semibold text-gray-900 mb-2">2. Your Responsibilities as Data Controller</h3>
              <p className="text-sm mb-2">You are solely responsible for all aspects of your data processing, including:</p>
              <ul className="text-sm mb-4 ml-4 list-disc space-y-1">
                <li><strong>Legal basis for processing</strong>: Ensuring you have valid legal grounds under GDPR Article 6 to process employee personal data</li>
                <li><strong>Employee consent and notification</strong>: Obtaining necessary consents and informing employees about data processing activities</li>
                <li><strong>Data accuracy and lawfulness</strong>: Ensuring all employee data is accurate, current, and lawfully obtained</li>
                <li><strong>GDPR and legal compliance</strong>: Meeting all data protection, privacy, and employment law requirements in your jurisdiction</li>
                <li><strong>Data subject rights</strong>: Handling all employee requests for access, rectification, erasure, and other GDPR rights</li>
                <li><strong>Data security</strong>: Implementing appropriate security measures for your employee data</li>
                <li><strong>Third-party relationships</strong>: Managing your legal relationship and compliance obligations with Planday</li>
                <li><strong>Software usage decisions</strong>: Determining whether and how to use our software tool for your business needs</li>
              </ul>

              <h3 className="text-base font-semibold text-gray-900 mb-2">3. Our Role as Software Tool Provider</h3>
              <p className="text-sm mb-2">We provide JavaScript software that runs on your device, similar to Excel, web browsers, or any client-side application:</p>
              <ul className="text-sm mb-4 ml-4 list-disc space-y-1">
                <li><strong>Client-side software only</strong>: Our code runs entirely on your device - we never receive, store, or access your data</li>
                <li><strong>No data processing role</strong>: You use our software to process data yourself, on your own device</li>
                <li><strong>No business relationships</strong>: We have no relationship with your employees, Planday, or your business operations</li>
                <li><strong>Static code delivery</strong>: We only serve JavaScript files to your browser, like any CDN or software download</li>
                <li><strong>No data visibility</strong>: Your data flows directly from your browser to Planday - we are not involved in this transmission</li>
                <li><strong>Standard software licensing</strong>: This is a software license agreement, not a data processing agreement</li>
              </ul>

              <h3 className="text-base font-semibold text-gray-900 mb-2">4. Customer Control and Data Sovereignty</h3>
              <p className="text-sm mb-2">You maintain complete control over your data throughout the process:</p>
              <ul className="text-sm mb-4 ml-4 list-disc space-y-1">
                <li><strong>Local processing</strong>: All data processing occurs in your browser under your control</li>
                <li><strong>Review and approval</strong>: You review and approve all data before transmission to Planday</li>
                <li><strong>Transmission control</strong>: You initiate and control all data transmission to Planday</li>
                <li><strong>Immediate deletion</strong>: Data is automatically removed from browser memory when you close the application</li>
                <li><strong>Process termination</strong>: You can stop the process at any time without data retention</li>
              </ul>

              <h3 className="text-base font-semibold text-gray-900 mb-2">5. Technical Security Measures</h3>
              <p className="text-sm mb-2">We implement appropriate technical safeguards:</p>
              <ul className="text-sm mb-4 ml-4 list-disc space-y-1">
                <li><strong>Encryption in transit</strong>: All communications use HTTPS/TLS encryption</li>
                <li><strong>No persistent storage</strong>: No data stored in databases, logs, or persistent systems</li>
                <li><strong>Authentication security</strong>: Secure token management with automatic cleanup</li>
                <li><strong>Client-side processing</strong>: Processing occurs locally to minimize data exposure</li>
                <li><strong>No server-side logging</strong>: No logging of personal data on our servers</li>
              </ul>

              <h3 className="text-base font-semibold text-gray-900 mb-2">6. Liability Limitations</h3>
              <ul className="text-sm mb-4 ml-4 list-disc space-y-1">
                <li><strong>Software tool only</strong>: We provide software functionality - you are responsible for how you use it</li>
                <li><strong>No data processing liability</strong>: Since we don't process your data, we have no liability for your data processing activities</li>
                <li><strong>GDPR compliance</strong>: You are solely responsible for all GDPR compliance as the Data Controller</li>
                <li><strong>Business compliance</strong>: You are responsible for employment law, data protection, and all business compliance</li>
                <li><strong>Third-party relationships</strong>: You manage your own relationships with Planday, employees, and other parties</li>
                <li><strong>Data quality</strong>: We have no liability for data accuracy, completeness, or lawfulness</li>
                <li><strong>Maximum liability</strong>: Our total liability is limited to software defects and cannot exceed fees paid (currently $0)</li>
              </ul>

              <h3 className="text-base font-semibold text-gray-900 mb-2">7. Software Functionality</h3>
              <p className="text-sm mb-2">Our software provides the following functionality that runs on your device:</p>
              <ul className="text-sm mb-4 ml-4 list-disc space-y-1">
                <li>Excel file parsing and data validation tools that operate in your browser's memory</li>
                <li>User interface components for data review and editing</li>
                <li>Data formatting functions to prepare data for Planday's API requirements</li>
                <li>HTTP client functionality to transmit your data directly to Planday's servers</li>
                <li>All processing occurs on your device under your control using our software code</li>
              </ul>

              <h3 className="text-base font-semibold text-gray-900 mb-2">8. Security and Incident Response</h3>
              <ul className="text-sm mb-4 ml-4 list-disc space-y-1">
                <li><strong>Software delivery security</strong>: We maintain security for our static website and code delivery infrastructure</li>
                <li><strong>No customer data incidents</strong>: Since we never store your data, we cannot have data breaches involving your information</li>
                <li><strong>Customer responsibility</strong>: You are solely responsible for all GDPR breach notifications, incident response, and data security on your device</li>
                <li><strong>No incident notifications</strong>: We have no way to contact customers as we don't store contact information</li>
                <li><strong>Software updates</strong>: Any security updates to our JavaScript code will be available through normal software updates</li>
              </ul>

              <h3 className="text-base font-semibold text-gray-900 mb-2">9. Software Availability and Warranty Disclaimers</h3>
              <ul className="text-sm mb-4 ml-4 list-disc space-y-1">
                <li><strong>Software provided "as-is"</strong>: No warranties of functionality, availability, or performance</li>
                <li><strong>Third-party dependencies</strong>: Functionality depends on Planday's API availability and your browser capabilities</li>
                <li><strong>No data recovery</strong>: We cannot recover data since no data is stored in our systems</li>
                <li><strong>No support infrastructure</strong>: Like open source software, we do not maintain customer support systems or contact databases</li>
                <li><strong>Self-service software</strong>: Users are responsible for learning and troubleshooting software usage independently</li>
              </ul>

              <h3 className="text-base font-semibold text-gray-900 mb-2">10. Indemnification</h3>
              <p className="text-sm mb-4">
                You agree to indemnify us against any claims, damages, or liabilities arising from: (a) your use of the service; 
                (b) your violation of applicable laws or regulations; (c) your relationship with your employees; 
                (d) your use of Planday's services; or (e) any violation of these terms.
              </p>

              <h3 className="text-base font-semibold text-gray-900 mb-2">11. Professional Advice Disclaimer</h3>
              <p className="text-sm mb-4">
                <strong>This tool does not provide legal, HR, or compliance advice.</strong> You should consult with qualified 
                legal and HR professionals regarding GDPR compliance, employment law requirements, and data processing obligations 
                in your jurisdiction.
              </p>

              <h3 className="text-base font-semibold text-gray-900 mb-2">12. Changes to Terms</h3>
              <p className="text-sm mb-4">
                We may update these terms as needed. Material changes will be communicated through the application. 
                Continued use constitutes acceptance of updated terms.
              </p>

              <h3 className="text-base font-semibold text-gray-900 mb-2">13. Termination</h3>
              <p className="text-sm mb-4">
                You may stop using the service at any time. Upon termination of use, all data is immediately removed 
                from browser memory with no data retention on our systems.
              </p>

              <div className="border-t border-gray-200 pt-4 mt-6">
                <p className="text-sm font-medium text-gray-900">
                  <strong>By using this software, you acknowledge that you are using a client-side tool to process data on your own device. 
                  You are the Data Controller with full responsibility for GDPR compliance and all aspects of your data processing activities.</strong>
                </p>
              </div>

              <div className="bg-gray-50 border-l-4 border-gray-400 p-4 mt-4">
                <p className="text-sm text-gray-700">
                  <strong>Effective Date:</strong> These terms become effective upon your first use of the service and remain in effect until terminated.
                </p>
              </div>
            </div>
          </div>
          
          {/* Footer */}
          <div className="flex items-center justify-end px-6 py-3 border-t border-gray-200">
            <Button onClick={onClose} variant="primary">
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}; 