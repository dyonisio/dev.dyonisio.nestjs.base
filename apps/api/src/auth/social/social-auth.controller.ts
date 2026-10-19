import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { AllowUnverified } from '../../common/decorators/allow-unverified.decorator';
import { ApiErrors } from '../../common/decorators/api-error.decorator';
import { Auth } from '../../common/decorators/auth.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { i18nKey } from '../../i18n/translations';
import { AuthRateLimit } from '../../rate-limit/auth-rate-limit.decorator';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { TwoFactorChallengeDto } from '../two-factor/dto/two-factor.dto';
import { LoginMethodsDto, SocialLoginDto } from './dto/social.dto';
import { SOCIAL_PROVIDERS, SocialProvider } from './oidc-verifier.service';
import { SocialAuthService } from './social-auth.service';

const asProvider = (value: string): SocialProvider => {
  if (!(SOCIAL_PROVIDERS as readonly string[]).includes(value)) {
    throw new BadRequestException(i18nKey('social.unknownProvider'));
  }
  return value as SocialProvider;
};

@ApiTags('Auth / Social login')
@ApiExtraModels(AuthResponseDto, TwoFactorChallengeDto)
@Controller()
export class SocialAuthController {
  constructor(private readonly social: SocialAuthService) {}

  @Public()
  @Post('auth/social/:provider')
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'provider', enum: SOCIAL_PROVIDERS })
  @ApiOperation({
    summary: 'Sign in with Google / Apple',
    description:
      'The frontend signs in with the provider and sends the ID token it received. Existing link -> signs in; verified email of an existing account -> links it; new email -> creates the account (already verified, no password). If the user has 2FA, returns the 2FA challenge instead of the tokens.',
  })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AuthResponseDto) },
        { $ref: getSchemaPath(TwoFactorChallengeDto) },
      ],
    },
  })
  @ApiErrors(
    [400, 'Unknown/unconfigured provider, or the provider did not verify the email'],
    [401, 'Invalid, expired or foreign ID token'],
  )
  login(@Param('provider') provider: string, @Body() dto: SocialLoginDto) {
    return this.social.login(asProvider(provider), dto);
  }

  @Get('users/me/identities')
  @Auth()
  @AllowUnverified()
  @ApiTags('Users')
  @ApiOperation({ summary: 'My sign-in methods (password and linked social accounts)' })
  @ApiOkResponse({ type: LoginMethodsDto })
  identities(@CurrentUser('id') userId: string) {
    return this.social.loginMethods(userId);
  }

  @Delete('users/me/identities/:provider')
  @Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiTags('Users')
  @ApiParam({ name: 'provider', enum: SOCIAL_PROVIDERS })
  @ApiOperation({
    summary: 'Unlink a social account',
    description: 'Refused if it is the only way to sign in (no password and no other provider).',
  })
  @ApiNoContentResponse()
  @ApiErrors([400, 'It is the last sign-in method'], [404, 'Provider not linked'])
  async unlink(
    @CurrentUser('id') userId: string,
    @Param('provider') provider: string,
  ): Promise<void> {
    await this.social.unlink(userId, asProvider(provider));
  }
}
