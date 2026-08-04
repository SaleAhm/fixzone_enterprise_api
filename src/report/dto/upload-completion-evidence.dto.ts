import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UploadCompletionEvidenceDto {
  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType: string;

  @IsString()
  imageBase64: string;

  @IsOptional()
  @IsIn(['before', 'during', 'after', 'completion'])
  classification?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
