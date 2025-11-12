import { Module } from '@nestjs/common';
import { S3Service } from './s3.service';
import { PrismaService } from './prisma.service';
import { ConfigModule } from '@nestjs/config';
import { LLMService } from './llm.service';
import { ChromaService } from './chroma.service';

@Module({
  imports: [ConfigModule],
  providers: [S3Service, PrismaService, LLMService, ChromaService],
  exports: [S3Service, PrismaService, LLMService, ChromaService],
})
export class SharedModule {}
