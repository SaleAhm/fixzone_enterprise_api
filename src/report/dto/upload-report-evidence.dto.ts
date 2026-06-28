import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UploadReportEvidenceDto {
  @IsOptional()
  @IsString()
  fileName?: string;

  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType: string;

  @IsString()
  @IsNotEmpty()
  imageBase64: string;
}
