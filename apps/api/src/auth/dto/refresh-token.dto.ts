import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsBoundedString } from '../../common/validators/text.validators';

export class RefreshTokenDto {
  @ApiPropertyOptional({
    description:
      'Refresh token received from the login or the last refresh. Omit it in cookie mode (`X-Session-Cookie: 1`): the httpOnly cookie is used.',
  })
  @IsOptional()
  @IsBoundedString(512)
  refreshToken?: string;
}
