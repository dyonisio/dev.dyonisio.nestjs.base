import { ApiProperty } from '@nestjs/swagger';
import { IsBoundedString } from '../../common/validators/text.validators';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token received from the login or the last refresh' })
  @IsBoundedString(512)
  refreshToken: string;
}
