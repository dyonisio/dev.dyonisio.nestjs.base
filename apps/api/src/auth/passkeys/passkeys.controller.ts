import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AllowUnverified } from '../../common/decorators/allow-unverified.decorator';
import { ApiErrors } from '../../common/decorators/api-error.decorator';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UuidParam } from '../../common/pipes/uuid-param.pipe';
import { AuthRateLimit } from '../../rate-limit/auth-rate-limit.decorator';
import { ReauthDto } from '../../users/account/dto/account.dto';
import { AuthResponseDto } from '../dto/auth-response.dto';
import {
  PasskeyDto,
  PasskeyLoginDto,
  PasskeyOptionsDto,
  RegisterPasskeyDto,
  RenamePasskeyDto,
} from './dto/passkey.dto';
import { PasskeyService } from './passkey.service';

@ApiTags('Auth / Passkeys')
@Controller()
export class PasskeysController {
  constructor(private readonly passkeys: PasskeyService) {}

  @Public()
  @Post('auth/passkeys/login/options')
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start signing in with a passkey',
    description:
      'Step 1 of 2. No email needed: the browser lists the passkeys saved for this site and the person picks one (fingerprint, face or device PIN).',
  })
  @ApiOkResponse({ type: PasskeyOptionsDto })
  loginOptions(): Promise<PasskeyOptionsDto> {
    return this.passkeys.loginOptions();
  }

  @Public()
  @Post('auth/passkeys/login')
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with a passkey',
    description:
      'Step 2 of 2: send what the browser returned. Returns the session directly — a passkey already proves two factors (the device and the fingerprint/PIN), so there is no 2FA step.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiErrors(
    [400, 'Challenge expired or already used'],
    [401, 'Unknown passkey, invalid signature or inactive account'],
  )
  login(@Body() dto: PasskeyLoginDto): Promise<AuthResponseDto> {
    return this.passkeys.login(dto);
  }

  @Post('auth/passkeys/register/options')
  @Auth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start adding a passkey',
    description:
      'Step 1 of 2. A passkey is a new way into the account, so it asks to confirm it is you: the password (accounts without one: signed in recently) and, with 2FA on, the code.',
  })
  @ApiOkResponse({ type: PasskeyOptionsDto })
  @ApiErrors(
    [400, 'Missing/wrong password or code, or the passkey limit was reached'],
    [401, 'Sign in again to confirm it is you (accounts without a password)'],
  )
  registrationOptions(
    @CurrentUser('id') userId: string,
    @Body() dto: ReauthDto,
  ): Promise<PasskeyOptionsDto> {
    return this.passkeys.registrationOptions(userId, dto);
  }

  @Post('auth/passkeys/register')
  @Auth()
  @ApiOperation({
    summary: 'Add a passkey',
    description: 'Step 2 of 2: send what the browser returned. The account email gets a notice.',
  })
  @ApiCreatedResponse({ type: PasskeyDto })
  @ApiErrors([400, 'Challenge expired, invalid response or passkey already added'])
  async register(
    @CurrentUser('id') userId: string,
    @Body() dto: RegisterPasskeyDto,
  ): Promise<PasskeyDto> {
    return PasskeyDto.from(await this.passkeys.register(userId, dto));
  }

  @Post('auth/passkeys/reauth/options')
  @Auth()
  @AllowUnverified()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm it is you with a passkey',
    description:
      'For sensitive actions (change email, delete account, add a passkey, turn on 2FA): sign this challenge with one of your passkeys and send `{ passkey: { challengeToken, response } }` in place of the password and code.',
  })
  @ApiOkResponse({ type: PasskeyOptionsDto })
  @ApiErrors([400, 'The account has no passkeys'])
  reauthOptions(@CurrentUser('id') userId: string): Promise<PasskeyOptionsDto> {
    return this.passkeys.reauthOptions(userId);
  }

  @Get('users/me/passkeys')
  @Auth()
  @AllowUnverified()
  @ApiTags('Users')
  @ApiOperation({ summary: 'My passkeys' })
  @ApiOkResponse({ type: [PasskeyDto] })
  async list(@CurrentUser('id') userId: string): Promise<PasskeyDto[]> {
    return (await this.passkeys.list(userId)).map((p) => PasskeyDto.from(p));
  }

  @Patch('users/me/passkeys/:id')
  @Auth()
  @ApiTags('Users')
  @ApiOperation({ summary: 'Rename a passkey' })
  @ApiOkResponse({ type: PasskeyDto })
  @ApiErrors([400, 'Invalid id or name'], [404, 'Passkey not found'])
  async rename(
    @CurrentUser('id') userId: string,
    @Param('id', UuidParam) id: string,
    @Body() dto: RenamePasskeyDto,
  ): Promise<PasskeyDto> {
    return PasskeyDto.from(await this.passkeys.rename(userId, id, dto.name));
  }

  @Delete('users/me/passkeys/:id')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiTags('Users')
  @ApiOperation({
    summary: 'Remove a passkey',
    description:
      'It stops working on this site right away. The copy saved on the device or password manager stays there; the person can delete it there too.',
  })
  @ApiNoContentResponse()
  @ApiErrors([400, 'Invalid id'], [404, 'Passkey not found'])
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', UuidParam) id: string,
  ): Promise<void> {
    await this.passkeys.remove(userId, id);
  }
}
