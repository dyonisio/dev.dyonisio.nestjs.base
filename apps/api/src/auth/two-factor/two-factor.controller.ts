import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/decorators/api-error.decorator';
import { Auth } from '../../common/decorators/auth.decorator';
import { Authorize } from '../../common/decorators/authorize.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Permission } from '../../common/enums/permission.enum';
import { AuthRateLimit } from '../../rate-limit/auth-rate-limit.decorator';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { AuthService } from '../services/auth.service';
import {
  RecoveryCodesResponseDto,
  TwoFactorCodeDto,
  TwoFactorSetupResponseDto,
  TwoFactorVerifyDto,
} from './dto/two-factor.dto';
import { ReauthDto } from '../../users/account/dto/account.dto';
import { ReauthService } from '../../users/account/reauth.service';
import { TwoFactorService } from './two-factor.service';

@ApiTags('Auth / Two-factor (2FA)')
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly auth: AuthService,
    private readonly reauth: ReauthService,
  ) {}

  @Post('setup')
  @Auth()
  @ApiOperation({
    summary: '1) Start enabling 2FA',
    description:
      'Generates a new secret (not active yet). Show `otpauthUrl` as a QR code for the authenticator app, then confirm with POST /auth/2fa/enable. Requires `currentPassword` (accounts without a password: a recent sign-in) — a stolen token cannot turn on 2FA and lock the owner out.',
  })
  @ApiCreatedResponse({ type: TwoFactorSetupResponseDto })
  @AuthRateLimit()
  @ApiErrors([400, '2FA already enabled or wrong password'], [401, 'Sign in again to confirm'])
  async setup(@CurrentUser('id') userId: string, @Body() dto: ReauthDto) {
    await this.reauth.confirm(userId, dto, { skipTwoFactor: true });
    return this.twoFactor.setup(userId);
  }

  @Post('enable')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '2) Confirm and enable 2FA',
    description:
      'Send a code from the app to prove it was set up correctly. Returns the recovery codes — shown ONLY ONCE.',
  })
  @ApiOkResponse({ type: RecoveryCodesResponseDto })
  @ApiErrors(
    [400, 'Invalid code, setup not started or already enabled'],
    [429, 'Too many attempts'],
  )
  enable(@CurrentUser('id') userId: string, @Body() dto: TwoFactorCodeDto) {
    return this.twoFactor.enable(userId, dto.code);
  }

  @Public()
  @Post('verify')
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Second login step',
    description:
      'When the login returns `twoFactorRequired: true`, send the `twoFactorToken` with a code from the app (or a recovery code) to receive the session tokens.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiErrors(
    [400, 'Invalid code'],
    [401, 'Invalid or expired twoFactorToken'],
    [429, 'Too many attempts'],
  )
  verify(@Body() dto: TwoFactorVerifyDto) {
    return this.auth.verifyTwoFactor(dto.twoFactorToken, dto.code);
  }

  @Post('disable')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Disable 2FA',
    description: 'Requires a code from the app (or a recovery code).',
  })
  @ApiNoContentResponse()
  @ApiErrors([400, 'Invalid code or 2FA not enabled'], [429, 'Too many attempts'])
  async disable(@CurrentUser('id') userId: string, @Body() dto: TwoFactorCodeDto): Promise<void> {
    await this.twoFactor.disable(userId, dto.code);
  }

  @Post('recovery-codes')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate new recovery codes',
    description: 'The previous codes stop working. Requires a code from the app.',
  })
  @ApiOkResponse({ type: RecoveryCodesResponseDto })
  @ApiErrors([400, 'Invalid code or 2FA not enabled'], [429, 'Too many attempts'])
  regenerate(@CurrentUser('id') userId: string, @Body() dto: TwoFactorCodeDto) {
    return this.twoFactor.regenerateRecoveryCodes(userId, dto.code);
  }
}

/** Rota de admin: fica em /users/:id/... mas usa o serviço de 2FA (que mora no módulo de auth). */
@ApiTags('Users')
@Controller('users')
export class AdminTwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Delete(':id/two-factor')
  @Authorize(Permission.USERS_RESET_2FA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Reset a user's 2FA",
    description:
      'For users who lost the authenticator app AND the recovery codes. Confirm the identity by other means first. Permission: `users:reset-2fa`.',
  })
  @ApiNoContentResponse()
  @ApiErrors([404, 'User not found'])
  async reset(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.twoFactor.adminReset(id);
  }
}
