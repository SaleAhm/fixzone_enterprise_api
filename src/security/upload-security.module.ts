import { Module } from '@nestjs/common';
import { UploadSecurityService } from './upload-security.service';

@Module({
  providers: [UploadSecurityService],
  exports: [UploadSecurityService],
})
export class UploadSecurityModule {}
