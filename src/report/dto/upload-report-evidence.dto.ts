import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UploadReportEvidenceDto {
  @IsOptional()
  @IsString()
  fileName?: string;

  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType: string;

  @IsString()
  @IsNotEmpty()
  imageBase64: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
