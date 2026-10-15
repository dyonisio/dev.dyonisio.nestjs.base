import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowUnverified } from '../../common/decorators/allow-unverified.decorator';
import { ApiErrors } from '../../common/decorators/api-error.decorator';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { I18nService } from '../../i18n/i18n.service';
import { Lang } from '../../i18n/lang.decorator';
import { AuthRateLimit } from '../../rate-limit/auth-rate-limit.decorator';
import { EmailVerificationService } from '../../users/email-verification.service';
import { User } from '../../users/entities/user.entity';
import { MessageResponseDto } from '../dto/auth-response.dto';
import { VerifyEmailDto } from '../dto/verify-email.dto';

@ApiTags('Auth / Email verification')
@Controller('auth/email')
export class EmailVerificationController {
  constructor(
    private readonly emailVerification: EmailVerificationService,
    private readonly i18n: I18nService,
  ) {}

  @Public()
  @Post('verify')
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm the email address',
    description:
      'Confirms the email using the token from the link sent at sign-up (or after an email change). Idempotent. Sends the welcome email on the first confirmation.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiErrors([400, 'Validation failed, or invalid/expired token'])
  async verify(@Body() dto: VerifyEmailDto, @Lang() lang: string): Promise<MessageResponseDto> {
    await this.emailVerification.verify(dto.token);
    return { message: this.i18n.t('emailVerification.verified', lang) };
  }

  @Post('resend')
  @Auth()
  @AllowUnverified()
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend the confirmation email',
    description: 'Sends a new confirmation link to the signed-in user email.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiErrors([400, 'The email is already verified'])
  async resend(@CurrentUser() user: User, @Lang() lang: string): Promise<MessageResponseDto> {
    await this.emailVerification.resend(user);
    return { message: this.i18n.t('emailVerification.sent', lang) };
  }
}
