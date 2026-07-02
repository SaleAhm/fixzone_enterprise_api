import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { KycSubmissionStatus } from '@prisma/client';

export class ReviewKycDto {
  @IsEnum(KycSubmissionStatus)
  status!: KycSubmissionStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rejectionReason?: string;
}
