import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/decorators/api-error.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { I18nService } from '../../i18n/i18n.service';
import { Lang } from '../../i18n/lang.decorator';
import { AuthRateLimit } from '../../rate-limit/auth-rate-limit.decorator';
import { AuthResponseDto, MessageResponseDto } from '../dto/auth-response.dto';
import { RequestMagicLinkDto, VerifyMagicLinkDto } from '../dto/magic-link.dto';
import { MagicLinkService } from '../services/magic-link.service';
import { TwoFactorChallengeDto } from '../two-factor/dto/two-factor.dto';

@ApiTags('Auth')
@ApiExtraModels(AuthResponseDto, TwoFactorChallengeDto)
@Controller('auth/magic-link')
export class MagicLinkController {
  constructor(
    private readonly magicLinks: MagicLinkService,
    private readonly i18n: I18nService,
  ) {}

  @Public()
  @Post()
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Email me a sign-in link',
    description:
      'Sends a single-use sign-in link (valid for MAGIC_LINK_EXPIRES_IN, default 15 min) to the account’s email. Never signs in by itself, and always returns 200, so it does not reveal whether the email is registered. Asking again invalidates the previous link.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiErrors([400, 'Validation failed'])
  async request(
    @Body() dto: RequestMagicLinkDto,
    @Lang() lang: string,
  ): Promise<MessageResponseDto> {
    await this.magicLinks.request(dto.email);
    return { message: this.i18n.t('auth.magicLinkSent', lang) };
  }

  @Public()
  @Post('verify')
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with the link',
    description:
      'Exchanges the token from the link for a session. Single use. If the user has 2FA enabled, returns `{ twoFactorRequired: true, twoFactorToken }` — complete it at POST /api/v1/auth/2fa/verify. The front calls this from a button on its /magic-link page (a POST, so email scanners that open links do not use it up).',
  })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AuthResponseDto) },
        { $ref: getSchemaPath(TwoFactorChallengeDto) },
      ],
    },
  })
  @ApiErrors([400, 'Invalid, expired or already used link'])
  verify(@Body() dto: VerifyMagicLinkDto) {
    return this.magicLinks.verify(dto.token);
  }
}
