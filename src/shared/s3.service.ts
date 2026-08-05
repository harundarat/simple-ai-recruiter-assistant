import {
  DeleteObjectsCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileStore, StoredFileReference } from './infrastructure.tokens';
import { CircuitBreakerExecutor } from './circuit-breaker.executor';

@Injectable()
export class S3Service implements FileStore {
  private readonly s3Client: S3Client;
  constructor(
    private readonly configService: ConfigService,
    private readonly circuitBreakerExecutor: CircuitBreakerExecutor,
  ) {
    const endpoint = configService.get<string>('S3_ENDPOINT');
    this.s3Client = new S3Client({
      region: configService.getOrThrow<string>('S3_REGION'),
      credentials: {
        accessKeyId: configService.getOrThrow<string>('S3_ACCESS_KEY_ID'),
        secretAccessKey: configService.getOrThrow<string>(
          'S3_SECRET_ACCESS_KEY',
        ),
      },
      ...(endpoint
        ? {
            endpoint,
            forcePathStyle:
              configService.get<boolean>('S3_FORCE_PATH_STYLE') ?? true,
          }
        : {}),
    });
    this.s3Client.middlewareStack.add(
      (next, context) => (args) =>
        this.circuitBreakerExecutor.execute(
          's3',
          context.commandName ?? 'UnknownS3Command',
          () => next(args),
        ),
      { step: 'initialize', name: 's3CircuitBreaker' },
    );
  }

  getS3Client(): S3Client {
    return this.s3Client;
  }

  async getFile(bucket: string, key: string): Promise<Buffer> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await this.s3Client.send(command);

    if (!response.Body) {
      throw new Error(`S3 object ${key} returned an empty response body`);
    }

    return Buffer.from(await response.Body.transformToByteArray());
  }

  async deleteFiles(files: StoredFileReference[]): Promise<void> {
    const filesByBucket = new Map<string, string[]>();
    for (const file of files) {
      const keys = filesByBucket.get(file.bucket) ?? [];
      keys.push(file.key);
      filesByBucket.set(file.bucket, keys);
    }

    await Promise.all(
      [...filesByBucket.entries()].map(([bucket, keys]) =>
        this.s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
          }),
        ),
      ),
    );
  }
}
