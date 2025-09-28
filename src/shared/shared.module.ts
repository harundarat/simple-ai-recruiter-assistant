import { Module } from '@nestjs/common';
import { S3Service } from './s3.service';
import { PrismaService } from './prisma.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [S3Service, PrismaService],
  exports: [S3Service, PrismaService],
})
export class SharedModule {}
