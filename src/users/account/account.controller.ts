import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AllowUnverified } from '../../common/decorators/allow-unverified.decorator';
import { ApiErrors } from '../../common/decorators/api-error.decorator';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { I18nService } from '../../i18n/i18n.service';
import { Lang } from '../../i18n/lang.decorator';
import { AuthRateLimit } from '../../rate-limit/auth-rate-limit.decorator';
import { AccountService } from './account.service';
import {
  AccountExportDto,
  ChangeEmailDto,
  ChangeEmailResponseDto,
  ReauthDto,
} from './dto/account.dto';

const REAUTH_HELP =
  'Requires `currentPassword` (accounts with a password) and `code` (accounts with 2FA). Accounts without a password (social sign-in only) must have signed in during the last few minutes — otherwise 401, sign in again.';

/**
 * Ações do usuário sobre a própria conta. Registrado ANTES do UsersController (users.module.ts)
 * para que `DELETE /users/me` não seja capturado por `DELETE /users/:id`.
 */
@ApiTags('Users / My account')
@Controller('users')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly i18n: I18nService,
  ) {}

  @Post('me/email')
  @Auth()
  @AllowUnverified()
  @AuthRateLimit()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Change my email',
    description: `Sends a confirmation link to the new address; the email only changes after the link is used (\`POST /auth/email/verify\`), and the old address is notified. ${REAUTH_HELP}`,
  })
  @ApiAcceptedResponse({ type: ChangeEmailResponseDto })
  @ApiErrors(
    [400, 'Validation failed, wrong password/code, or same email'],
    [409, 'Email already registered'],
  )
  async changeEmail(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangeEmailDto,
    @Lang() lang: string,
  ): Promise<ChangeEmailResponseDto> {
    const pendingEmail = await this.account.changeEmail(userId, dto);
    return {
      message: this.i18n.t('account.emailChangeRequested', lang, { email: pendingEmail }),
      pendingEmail,
    };
  }

  @Get('me/export')
  @Auth()
  @AllowUnverified()
  @AuthRateLimit()
  @Header('Content-Disposition', 'attachment; filename="my-data.json"')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Download my data',
    description:
      'Everything the API stores about the signed-in user (profile, sign-in methods, sessions, files, activity) as JSON — the LGPD/GDPR right of access. Secrets (password hash, 2FA secret) are never included.',
  })
  @ApiOkResponse({ type: AccountExportDto })
  exportData(@CurrentUser('id') userId: string): Promise<AccountExportDto> {
    return this.account.exportData(userId);
  }

  @Delete('me')
  @Auth()
  @AllowUnverified()
  @AuthRateLimit()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete my account',
    description: `The account is deleted immediately (all sessions end, the email becomes available) and the personal data is permanently erased after ACCOUNT_PURGE_AFTER_DAYS days (default 30) — until then an admin can still restore it. The only admin cannot delete their own account. ${REAUTH_HELP}`,
  })
  @ApiNoContentResponse()
  @ApiErrors([400, 'Wrong password/code, or last admin'], [401, 'Sign in again to confirm'])
  async deleteAccount(@CurrentUser('id') userId: string, @Body() dto: ReauthDto): Promise<void> {
    await this.account.deleteAccount(userId, dto);
  }
}
