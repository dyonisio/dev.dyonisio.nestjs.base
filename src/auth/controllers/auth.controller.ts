import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ApiErrors } from '../../common/decorators/api-error.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthRateLimit } from '../../rate-limit/auth-rate-limit.decorator';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';
import { AuthService } from '../services/auth.service';
import { TwoFactorChallengeDto } from '../two-factor/dto/two-factor.dto';

@ApiTags('Auth')
@ApiExtraModels(AuthResponseDto, TwoFactorChallengeDto)
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in',
    description:
      'Opens a new session and returns the tokens. If the user has 2FA enabled, returns `{ twoFactorRequired: true, twoFactorToken }` instead — complete it at POST /api/v1/auth/2fa/verify.',
  })
  @ApiOkResponse({
    schema: {
      oneOf: [
        { $ref: getSchemaPath(AuthResponseDto) },
        { $ref: getSchemaPath(TwoFactorChallengeDto) },
      ],
    },
  })
  @ApiErrors([400, 'Validation failed'], [401, 'Invalid email or password, or inactive user'])
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh the tokens',
    description:
      'Exchanges the refresh token for a new token pair in the same session. Each refresh token can be used only once: reusing an already used token revokes the whole session (refresh and access tokens).',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiErrors([400, 'Validation failed'], [401, 'Invalid, expired or already used refresh token'])
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Sign out',
    description:
      'Revokes the session of the given refresh token. Its access tokens stop working immediately.',
  })
  @ApiNoContentResponse()
  @ApiErrors([400, 'Validation failed'])
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }
}
