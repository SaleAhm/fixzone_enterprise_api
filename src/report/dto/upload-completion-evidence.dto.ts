import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GeoLocationMetadataDto } from './geo-location.dto';

export class CompletionEvidenceImageDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsOptional()
  @IsString()
  @IsIn(['image/jpeg', 'image/png', 'image/webp'])
  contentType: string;

  @IsOptional()
  @IsString()
  imageBase64: string;

  @IsOptional()
  @IsIn(['before', 'during', 'after', 'completion'])
  classification?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => GeoLocationMetadataDto)
  geoMetadata?: GeoLocationMetadataDto;
}

export class UploadCompletionEvidenceDto extends CompletionEvidenceImageDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => CompletionEvidenceImageDto)
  images?: CompletionEvidenceImageDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => GeoLocationMetadataDto)
  imageGeoMetadata?: GeoLocationMetadataDto[];
}
