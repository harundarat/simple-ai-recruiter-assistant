import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import {
  FileValidationPipe,
  FilesValidationPipe,
} from './file-validation.pipe';
import { FILE_VALIDATION_CONSTANTS } from '../constants/file-validation.constants';

function createFile(
  overrides: Partial<Express.MulterS3.File> = {},
): Express.MulterS3.File {
  return {
    originalname: 'candidate.pdf',
    mimetype: 'application/pdf',
    size: 1_024,
    ...overrides,
  } as Express.MulterS3.File;
}

describe('FileValidationPipe', () => {
  const pipe = new FileValidationPipe({ fieldName: 'CV' });

  it('accepts a PDF within the size limit', () => {
    const file = createFile();

    expect(pipe.transform(file)).toBe(file);
  });

  it('rejects an invalid MIME type', () => {
    expect(() => pipe.transform(createFile({ mimetype: 'image/png' }))).toThrow(
      new BadRequestException(
        'CV must be a PDF file. Got MIME type: image/png',
      ),
    );
  });

  it('rejects an invalid extension', () => {
    expect(() =>
      pipe.transform(createFile({ originalname: 'candidate.txt' })),
    ).toThrow(
      new BadRequestException('CV must have a valid PDF extension (.pdf)'),
    );
  });

  it('rejects an oversized file', () => {
    expect(() =>
      pipe.transform(
        createFile({
          size: FILE_VALIDATION_CONSTANTS.MAX_FILE_SIZE_BYTES + 1,
        }),
      ),
    ).toThrow(BadRequestException);
  });
});

describe('FilesValidationPipe', () => {
  const pipe = new FilesValidationPipe();

  it('requires both upload fields', () => {
    expect(() => pipe.transform({ cv: [createFile()] })).toThrow(
      'Project Report file is required',
    );
  });

  it('returns validated files', () => {
    const files = {
      cv: [createFile()],
      project_report: [createFile({ originalname: 'project.pdf' })],
    };

    expect(pipe.transform(files)).toBe(files);
  });
});
