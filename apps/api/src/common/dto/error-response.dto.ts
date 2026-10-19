import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ValidationErrorItemDto {
  @ApiProperty({ example: 'password' })
  field: string;

  @ApiProperty({ example: 'validation.minLength', description: 'Stable error code' })
  code: string;

  @ApiProperty({
    example: 'password must be at least 8 characters long',
    description: 'Message translated to the request language (Accept-Language)',
  })
  message: string;
}

export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    example: 'errors.validation',
    description: 'Stable error code — use it in the client instead of the message text',
  })
  code: string;

  @ApiProperty({
    example: 'Validation failed',
    description: 'Message translated to the request language (Accept-Language)',
  })
  message: string;

  @ApiPropertyOptional({
    type: [ValidationErrorItemDto],
    description: 'Present only on validation errors',
  })
  errors?: ValidationErrorItemDto[];
}
