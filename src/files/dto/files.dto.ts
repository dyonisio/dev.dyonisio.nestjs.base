import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, IsUUID, Max, Min } from 'class-validator';
import { i18nValidationMessage } from '../../i18n/i18n-validation';
import { FILE_PURPOSE_NAMES, FilePurpose } from '../file-purposes';

export class CreateUploadDto {
  @ApiProperty({ enum: FILE_PURPOSE_NAMES, example: 'avatar', description: 'What the file is for' })
  @IsIn(FILE_PURPOSE_NAMES, { message: i18nValidationMessage() })
  purpose: FilePurpose;

  @ApiProperty({
    example: 'image/png',
    description: "The file's MIME type (File.type in the browser)",
  })
  @IsString()
  contentType: string;

  @ApiProperty({ example: 48213, description: 'Size in bytes (File.size in the browser)' })
  @IsInt()
  @Min(1, { message: i18nValidationMessage() })
  @Max(1024 * 1024 * 1024, { message: i18nValidationMessage() })
  size: number;
}

export class SetAvatarDto {
  @ApiProperty({ format: 'uuid', description: 'A completed upload with purpose `avatar`' })
  @IsUUID()
  fileId: string;
}

export class PresignedUploadDto {
  @ApiProperty({ example: 'https://my-bucket.s3.us-east-1.amazonaws.com/' })
  url: string;

  @ApiProperty({ example: 'POST' })
  method: 'POST';

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    description:
      'Send a multipart/form-data POST to `url` with ALL these fields (in this order) and the file LAST, in a field named `file`',
  })
  fields: Record<string, string>;

  @ApiProperty({ example: 600, description: 'Seconds the upload URL stays valid' })
  expiresIn: number;
}

export class FileDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'avatar' })
  purpose: string;

  @ApiProperty({ example: 'image/png' })
  contentType: string;

  @ApiProperty({ example: 48213 })
  size: number;

  @ApiProperty({ enum: ['pending', 'ready'] })
  status: string;

  @ApiProperty({
    nullable: true,
    description:
      'Public files: permanent URL. Private files: temporary signed URL. null while pending.',
  })
  url: string | null;

  @ApiProperty()
  createdAt: Date;
}

export class CreateUploadResponseDto {
  @ApiProperty({ type: FileDto })
  file: FileDto;

  @ApiProperty({ type: PresignedUploadDto })
  upload: PresignedUploadDto;
}
