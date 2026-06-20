import { IsIn, IsString, MaxLength } from 'class-validator';

export class UploadCompletionEvidenceDto {
  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType: string;

  @IsString()
  imageBase64: string;
}
