# Planday Bulk Employee Uploader

A secure, client-side web application for bulk uploading employees to Planday. Built with React, TypeScript, and privacy by design.

## 🎯 What It Does

Transform your employee onboarding process by uploading dozens or hundreds of employees to Planday in minutes instead of hours. This application provides:

- **Excel File Processing** - Upload employee data from Excel/CSV files
- **Smart Data Mapping** - Automatically maps columns to Planday fields with intelligent suggestions
- **Data Validation** - Comprehensive validation with error correction workflows
- **Duplicate Detection** - Identifies existing employees to prevent duplicates
- **Bulk Upload** - Efficiently uploads all employees with real-time progress tracking

## 🔒 Privacy & Security First

### **Local Processing - Your Data Stays With You**
- ✅ **Excel files processed entirely in your browser** - never uploaded to our servers
- ✅ **Only communicates with YOUR Planday portal** - no third-party data collection
- ✅ **No tracking, analytics, or cookies** - complete privacy by design
- ✅ **Open source code** - audit every line yourself

### **What Network Calls Are Made:**
1. **Planday API authentication** (to your portal only)
2. **Employee data upload** (directly to your Planday portal)
3. **Portal configuration retrieval** (departments, groups, field definitions)

### **What We DON'T Do:**
- ❌ Upload your Excel files anywhere
- ❌ Store your employee data
- ❌ Use Google Analytics or tracking pixels
- ❌ Send data to third-party services
- ❌ Collect usage statistics

## 🚀 Features

### **Smart Data Processing**
- Automatic column mapping with portal-specific field detection
- Support for custom fields and portal configurations
- Empty column detection and filtering
- Phone number validation with 27+ country codes
- Employee type mapping with intelligent suggestions

### **Advanced Validation**
- Real-time duplicate detection (handles 1000+ existing employees)
- Email normalization and validation
- Required field validation based on your portal settings
- Country code validation with smart suggestions
- Bulk error correction with pattern detection

### **User Experience**
- Step-by-step guided workflow
- Real-time progress tracking during uploads
- Comprehensive error reporting and correction
- Visual validation feedback
- Responsive design for all devices

## 🛠 Technical Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS
- **Build Tool**: Vite
- **Excel Processing**: SheetJS (XLSX)
- **API Integration**: Planday REST API
- **Authentication**: OAuth 2.0 with refresh tokens

## 📋 Getting Started

### **Prerequisites**
- Node.js 18+ and npm
- A Planday portal with API access
- Planday refresh token (from your portal's API settings)

### **Installation**
```bash
# Clone the repository
git clone https://github.com/Lushbits/pdbulkupload.git
cd pdbulkupload

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### **Getting Your Planday Token**
1. Log in to your Planday portal
2. Go to Settings → API Access
3. Click "Connect APP" and use app ID: `13000bf2-dd1f-41ab-a1a0-eeec783f50d7`
4. Authorize the app when prompted
5. Copy the "Token" value for use in the application

## 💡 Usage

1. **Connect to Planday** - Enter your refresh token
2. **Upload Excel File** - Choose your employee data file
3. **Map Columns** - Review and adjust field mappings
4. **Validate Data** - Fix any errors or validation issues
5. **Upload Employees** - Bulk upload with real-time progress

## 🔧 Development

### **Available Scripts**
```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run preview  # Preview production build
npm run lint     # Run ESLint
```

### **Project Structure**
```
src/
├── components/          # React components
│   ├── auth/           # Authentication components
│   ├── mapping/        # Column mapping UI
│   ├── upload/         # File upload handling
│   ├── validation/     # Data validation components
│   └── ui/             # Reusable UI components
├── services/           # Core business logic
│   ├── plandayApi.ts   # Planday API integration
│   ├── excelParser.ts  # Excel file processing
│   └── mappingService.ts # Data mapping logic
├── types/              # TypeScript type definitions
└── utils/              # Utility functions
```

## 🏗 Architecture Principles

- **Client-Side First** - All processing happens in the browser
- **Progressive Enhancement** - Works without JavaScript for basic features
- **Error Resilience** - Comprehensive error handling and recovery
- **Performance Optimized** - Efficient handling of large datasets
- **Accessibility** - WCAG 2.1 compliant interface

## 📊 Supported Data Fields

### **Required Fields** (varies by portal)
- Employee ID, First Name, Last Name, Email
- Department, Employee Group, Employee Type
- Start Date, Phone Numbers

### **Optional Fields**
- Address information, Custom fields
- Employment details, Additional contact info

## 🐛 Troubleshooting

### **Common Issues**
- **Authentication Fails**: Verify your refresh token is current
- **Upload Errors**: Check internet connection and Planday portal status
- **Validation Issues**: Review field mappings and data format

### **Getting Help**
- Check browser console for detailed error messages
- Review the network activity in browser DevTools
- Open an issue on GitHub with error details

## 📄 License

MIT License - feel free to use, modify, and distribute.

## 🙏 Contributing

Contributions welcome! Please read our contributing guidelines and submit pull requests for any improvements.

---

**Built with ❤️ for Planday users who value privacy and efficiency.**
