import {
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReportEvidenceImageDto {
  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  imageBase64: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class UploadReportEvidenceDto extends ReportEvidenceImageDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => ReportEvidenceImageDto)
  images?: ReportEvidenceImageDto[];
}
