# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Planday Bulk Employee Uploader - A privacy-first React application for bulk uploading employees to Planday portals. All data processing happens client-side in the browser.

## Development Commands

```bash
npm run dev      # Start Vite development server on localhost:5173
npm run build    # TypeScript check + Vite production build to dist/
npm run lint     # Run ESLint on all files
npm run preview  # Preview production build locally
```

## Architecture

### Core Services (`src/services/`)
- **plandayApi.ts**: Planday API client with OAuth token management, rate limiting, and exponential backoff
- **excelParser.ts**: Client-side Excel/CSV processing using ExcelJS
- **mappingService.ts**: Column mapping logic and validation service

### Key Features
- **Multi-step workflow**: 7-step guided process (Auth → Upload → Map → Validate → Correct → Preview → Upload)
- **Bulk Edit module** (`src/edit/`): Separate feature for editing existing employees
- **Client-side processing**: Excel files never leave the browser
- **Smart mapping**: Auto-detects column mappings using rules in `constants/autoMappingRules.ts`

### API Integration
- **Authentication**: OAuth 2.0 with refresh tokens (App ID: `13000bf2-dd1f-41ab-a1a0-eeec783f50d7`)
- **Rate limiting**: Respects Planday's 429 responses with automatic retry
- **Endpoints**: All API calls go directly to user's Planday portal (`https://openapi.planday.com`)

### State Management
- React hooks for local state (`usePlandayApi`, `useEditApi`)
- No global state management library - components pass props
- Token persistence in localStorage with automatic refresh

### UI Components
- **Tailwind CSS** for styling with custom components in `src/components/ui/`
- **Wouter** for routing (not React Router despite types import)
- Responsive design with mobile support

## Important Patterns

### Error Handling
- All API errors mapped to user-friendly messages
- Validation errors collected and presented for bulk correction
- Network failures trigger automatic retry with exponential backoff

### Data Validation
- Phone numbers validated against 27+ country codes
- Email normalization and duplicate detection
- Required fields validated based on portal configuration
- Date formats auto-detected with pattern analysis

### Performance
- Large datasets (1000+ employees) handled with batch processing
- Progress tracking for long-running operations
- Lazy loading for modal components

## Issues
GitHub issues are often filed thin by non-technical reporters. When the user links an issue for review, see [ISSUE_CONVENTIONS.md](ISSUE_CONVENTIONS.md) — it defines the triage workflow (reproduce in code, separate symptom from cause, ask targeted questions) and the body/title/label/closing format to follow.

## Testing
No test framework configured. Manual testing required for changes.

## Deployment
Static site deployment to Netlify. Build outputs to `dist/` directory.