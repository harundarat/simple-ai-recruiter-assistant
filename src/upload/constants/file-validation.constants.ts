/**
 * File validation constants for upload module
 * Used by both Multer configuration and validation pipes
 */

export const FILE_VALIDATION_CONSTANTS = {
  // Maximum file size: 10MB
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024,

  // Maximum file size for display
  MAX_FILE_SIZE_MB: 10,

  // Allowed MIME types (PDF only)
  ALLOWED_MIME_TYPES: ['application/pdf'] as const,

  // Allowed file extensions
  ALLOWED_EXTENSIONS: ['.pdf'] as const,

  // Maximum number of files per upload
  MAX_FILES_COUNT: 2, // CV + Project Report

  // Field names
  FIELD_NAMES: {
    CV: 'cv',
    PROJECT_REPORT: 'project_report',
  } as const,

  // Display names for error messages
  DISPLAY_NAMES: {
    CV: 'CV',
    PROJECT_REPORT: 'Project Report',
  } as const,
} as const;

export const FILE_VALIDATION_ERROR_MESSAGES = {
  NO_FILES: 'No files uploaded. Please upload both CV and Project Report',
  CV_REQUIRED: 'CV file is required (PDF format)',
  PROJECT_REPORT_REQUIRED: 'Project Report file is required (PDF format)',
  INVALID_TYPE: (fieldName: string, mimeType: string) =>
    `${fieldName} must be a PDF file. Got MIME type: ${mimeType}`,
  INVALID_EXTENSION: (fieldName: string) =>
    `${fieldName} must have a valid PDF extension (.pdf)`,
  FILE_TOO_LARGE: (fieldName: string, maxSizeMB: number, fileSizeMB: string) =>
    `${fieldName} is too large. Maximum size is ${maxSizeMB}MB, got ${fileSizeMB}MB`,
  ONLY_PDF_ALLOWED:
    'Only PDF files are allowed. Please upload a valid PDF file.',
} as const;
