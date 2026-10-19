import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '../../users/entities/user.entity';

export class AuthTokensDto {
  @ApiProperty({ description: 'Short-lived JWT — send it as `Authorization: Bearer <token>`' })
  accessToken: string;

  @ApiPropertyOptional({
    description:
      'Long-lived opaque token — single use, exchange it at POST /api/v1/auth/refresh. Omitted when the request sends `X-Session-Cookie: 1`: then it goes in an httpOnly cookie instead (web front).',
    example: '3f1c2b9e-8a4d-4f6e-9b1a-2c3d4e5f6a7b.kJ8x...',
  })
  // Sempre gerado aqui dentro; o interceptor do modo cookie é que o tira da resposta
  refreshToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({ example: 900, description: 'Access token lifetime in seconds' })
  expiresIn: number;

  @ApiProperty({ example: 2592000, description: 'Refresh token lifetime in seconds' })
  refreshExpiresIn: number;
}

export class AuthResponseDto extends AuthTokensDto {
  @ApiProperty({ type: User })
  user: User;
}

export class MessageResponseDto {
  @ApiProperty({ description: 'Message translated to the request language (Accept-Language)' })
  message: string;
}
