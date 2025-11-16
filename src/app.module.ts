import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UploadModule } from './upload/upload.module';
import { EvaluateModule } from './evaluate/evaluate.module';
import { SharedModule } from './shared/shared.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot(), SharedModule, UploadModule, EvaluateModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
