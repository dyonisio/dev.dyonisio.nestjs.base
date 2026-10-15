import { ApiProperty } from '@nestjs/swagger';
import { IsBoundedString } from '../../common/validators/text.validators';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token received in the confirmation email link' })
  @IsBoundedString(2048)
  token: string;
}
