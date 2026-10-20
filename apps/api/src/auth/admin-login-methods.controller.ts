import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../common/decorators/api-error.decorator';
import { Authorize } from '../common/decorators/authorize.decorator';
import { Permission } from '../common/enums/permission.enum';
import { UuidParam } from '../common/pipes/uuid-param.pipe';
import { i18nKey } from '../i18n/translations';
import { UsersService } from '../users/users.service';
import { AdminLoginMethodsDto, PasskeyDto } from './passkeys/dto/passkey.dto';
import { PasskeyService } from './passkeys/passkey.service';
import { SOCIAL_PROVIDERS } from './social/oidc-verifier.service';
import { SocialAuthService } from './social/social-auth.service';

/**
 * Formas de login de um usuário, vistas pelo admin: no "invadiram minha conta", encerrar as
 * sessões não basta — uma passkey ou um Google vinculado pelo invasor o deixaria entrar de novo.
 *
 * Registrado DEPOIS dos controllers de /users/me/... (passkeys, identities): o "me" nunca vira :id.
 */
@ApiTags('Users')
@Controller('users/:id')
export class AdminLoginMethodsController {
  constructor(
    private readonly users: UsersService,
    private readonly social: SocialAuthService,
    private readonly passkeys: PasskeyService,
  ) {}

  @Get('login-methods')
  @Authorize(Permission.USERS_READ)
  @ApiOperation({
    summary: "A user's sign-in methods",
    description:
      'Password (whether it is set), linked Google/Apple and passkeys. Permission: `users:read`.',
  })
  @ApiOkResponse({ type: AdminLoginMethodsDto })
  @ApiErrors([400, 'Invalid id'], [404, 'User not found'])
  async list(@Param('id', UuidParam) id: string): Promise<AdminLoginMethodsDto> {
    await this.users.getById(id);
    const [methods, passkeys] = await Promise.all([
      this.social.loginMethods(id),
      this.passkeys.list(id),
    ]);
    return {
      hasPassword: methods.hasPassword,
      identities: methods.identities,
      passkeys: passkeys.map((p) => PasskeyDto.from(p)),
    };
  }

  @Delete('passkeys/:passkeyId')
  @Authorize(Permission.USERS_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Remove a user's passkey",
    description:
      'It stops working right away. Recorded in the audit log. Permission: `users:update`.',
  })
  @ApiNoContentResponse()
  @ApiErrors([400, 'Invalid id'], [404, 'User or passkey not found'])
  async removePasskey(
    @Param('id', UuidParam) id: string,
    @Param('passkeyId', UuidParam) passkeyId: string,
  ): Promise<void> {
    await this.passkeys.removeByAdmin(id, passkeyId);
  }

  @Delete('identities/:provider')
  @Authorize(Permission.USERS_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'provider', enum: SOCIAL_PROVIDERS })
  @ApiOperation({
    summary: "Unlink a user's Google/Apple account",
    description:
      'Allowed even if it is the only way in: the person can still use the email sign-in link or set a password via "forgot password". Permission: `users:update`.',
  })
  @ApiNoContentResponse()
  @ApiErrors([400, 'Invalid id or provider'], [404, 'User not found or provider not linked'])
  async unlink(
    @Param('id', UuidParam) id: string,
    @Param('provider') provider: string,
  ): Promise<void> {
    if (!(SOCIAL_PROVIDERS as readonly string[]).includes(provider)) {
      throw new BadRequestException(i18nKey('social.unknownProvider'));
    }
    await this.social.unlinkByAdmin(id, provider);
  }
}
