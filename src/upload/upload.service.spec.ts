import { describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { UploadService } from './upload.service';
import { PrismaService } from '../shared/prisma.service';
import type { FileStore } from '../shared/infrastructure.tokens';

function createFile(originalname: string, key: string): Express.MulterS3.File {
  return {
    originalname,
    key,
    bucket: 'candidate-bucket',
    location: `https://bucket.example/${key}`,
  } as Express.MulterS3.File;
}

function createService(transaction: jest.Mock<any>) {
  const deleteFiles = jest.fn<FileStore['deleteFiles']>().mockResolvedValue();
  const service = new UploadService(
    { $transaction: transaction } as unknown as PrismaService,
    {
      deleteFiles,
      getFile: jest.fn<FileStore['getFile']>(),
      getS3Client: jest.fn<FileStore['getS3Client']>(),
    },
    { get: jest.fn(() => 'candidate-bucket') } as unknown as ConfigService,
  );
  return { service, deleteFiles };
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
    const { service, deleteFiles } = createService(transaction);

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
    expect(deleteFiles).not.toHaveBeenCalled();
    expect(createCV).toHaveBeenCalledWith({
      data: {
        original_name: 'candidate.pdf',
        hosted_name: 'cv/candidate.pdf',
        url: 'https://bucket.example/cv/candidate.pdf',
      },
    });
  });

  it('deletes both objects when database persistence fails', async () => {
    const transaction = jest.fn(() =>
      Promise.reject(new Error('database down')),
    );
    const { service, deleteFiles } = createService(transaction);

    await expect(
      service.processUploadedFiles(
        createFile('candidate.pdf', 'cv/candidate.pdf'),
        createFile('project.pdf', 'project_report/project.pdf'),
      ),
    ).rejects.toMatchObject({ errorCode: 'STORAGE_UNAVAILABLE' });
    expect(deleteFiles).toHaveBeenCalledWith([
      { bucket: 'candidate-bucket', key: 'cv/candidate.pdf' },
      { bucket: 'candidate-bucket', key: 'project_report/project.pdf' },
    ]);
  });
});
