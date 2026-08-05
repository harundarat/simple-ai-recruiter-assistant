import { describe, expect, it, jest } from '@jest/globals';
import { UploadService } from './upload.service';
import { PrismaService } from '../shared/prisma.service';

function createFile(originalname: string, key: string): Express.MulterS3.File {
  return {
    originalname,
    key,
    location: `https://bucket.example/${key}`,
  } as Express.MulterS3.File;
}

describe('UploadService', () => {
  it('persists both uploaded files in one transaction', async () => {
    const createCV = jest.fn(() => Promise.resolve({ id: 11 }));
    const createProjectReport = jest.fn(() => Promise.resolve({ id: 22 }));
    const transactionClient = {
      cV: { create: createCV },
      projectReport: { create: createProjectReport },
    };
    const transaction = jest.fn(
      (callback: (client: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    );
    const service = new UploadService({
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(
      service.processUploadedFiles(
        createFile('candidate.pdf', 'cv/candidate.pdf'),
        createFile('project.pdf', 'project_report/project.pdf'),
      ),
    ).resolves.toEqual({
      cv_id: 11,
      project_report_id: 22,
      message: 'Files uploaded successfully',
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createCV).toHaveBeenCalledWith({
      data: {
        original_name: 'candidate.pdf',
        hosted_name: 'cv/candidate.pdf',
        url: 'https://bucket.example/cv/candidate.pdf',
      },
    });
    expect(createProjectReport).toHaveBeenCalledWith({
      data: {
        cv_id: 11,
        original_name: 'project.pdf',
        hosted_name: 'project_report/project.pdf',
        url: 'https://bucket.example/project_report/project.pdf',
      },
    });
  });
});
