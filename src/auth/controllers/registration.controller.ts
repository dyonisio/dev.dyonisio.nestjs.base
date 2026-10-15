import { Body, Controller, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/decorators/api-error.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthRateLimit } from '../../rate-limit/auth-rate-limit.decorator';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { RegisterDto } from '../dto/register.dto';
import { RegistrationService } from '../services/registration.service';

@ApiTags('Auth / Registration')
@Controller('auth/register')
export class RegistrationController {
  constructor(private readonly registrationService: RegistrationService) {}

  @Public()
  @Post()
  @AuthRateLimit()
  @ApiOperation({
    summary: 'Create an account',
    description:
      'Creates a user with the `user` role and signs the user in. The email starts as NOT verified: a confirmation link is sent, and until it is confirmed only a few routes are allowed (profile, resend link, change password). Sending `role` is rejected.',
  })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiErrors([400, 'Validation failed'], [409, 'Email already registered'])
  register(@Body() dto: RegisterDto) {
    return this.registrationService.register(dto);
  }
}
