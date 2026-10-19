import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/decorators/api-error.decorator';
import { AllowUnverified } from '../../common/decorators/allow-unverified.decorator';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthRateLimit } from '../../rate-limit/auth-rate-limit.decorator';
import { I18nService } from '../../i18n/i18n.service';
import { Lang } from '../../i18n/lang.decorator';
import { AuthTokensDto, MessageResponseDto } from '../dto/auth-response.dto';
import { SetPasswordDto } from '../dto/magic-link.dto';
import { ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto } from '../dto/password.dto';
import { PasswordService } from '../services/password.service';

@ApiTags('Auth / Password')
@Controller('auth/password')
export class PasswordController {
  constructor(
    private readonly passwordService: PasswordService,
    private readonly i18n: I18nService,
  ) {}

  @Public()
  @Post('forgot')
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request a password reset',
    description:
      'Sends an email with the password reset link. Always returns 200, so it does not reveal whether the email is registered.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiErrors([400, 'Validation failed'])
  async forgot(@Body() dto: ForgotPasswordDto, @Lang() lang: string): Promise<MessageResponseDto> {
    await this.passwordService.forgot(dto.email);
    return { message: this.i18n.t('password.forgotRequested', lang) };
  }

  @Public()
  @Post('reset')
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset the password',
    description:
      'Sets a new password using the token from the email. The token is single use. Ends all of the user’s sessions.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiErrors([400, 'Validation failed, or invalid/expired token'])
  async reset(@Body() dto: ResetPasswordDto, @Lang() lang: string): Promise<MessageResponseDto> {
    await this.passwordService.reset(dto.token, dto.password);
    return { message: this.i18n.t('password.resetDone', lang) };
  }

  @Post('change')
  @Auth()
  @AllowUnverified()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change the password',
    description:
      'Changes the password of the signed-in user. Ends all sessions and returns a new token pair for the current client.',
  })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiErrors([400, 'Validation failed, or the current password is incorrect'])
  change(@CurrentUser('id') userId: string, @Body() dto: ChangePasswordDto) {
    return this.passwordService.change(userId, dto.currentPassword, dto.newPassword);
  }

  @Post('set')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create the first password',
    description:
      'For a signed-in account that has no password yet (invited by an admin and signed in with the email link, or created with Google/Apple). Requires a recent sign-in (REAUTH_WINDOW_SECONDS) and, with 2FA, the `code`. Ends all sessions and returns a new token pair for the current client.',
  })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiErrors(
    [
      400,
      'Validation failed, the account already has a password, or the 2FA code is missing/wrong',
    ],
    [401, '`account.reauthRequired`: the sign-in is too old, sign in again'],
  )
  setFirst(@CurrentUser('id') userId: string, @Body() dto: SetPasswordDto) {
    return this.passwordService.setFirst(userId, dto.newPassword, dto.code);
  }
}
