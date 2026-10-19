import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsBoundedString } from '../../../common/validators/text.validators';
import { i18nValidationMessage } from '../../../i18n/i18n-validation';
import { Passkey } from '../entities/passkey.entity';

const OPTIONS_HELP =
  'Pass `options` as-is to the browser (`navigator.credentials` / `@simplewebauthn/browser`) and send `challengeToken` back with the result. Valid for 5 minutes, once.';

export class PasskeyOptionsDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: `WebAuthn options (JSON). ${OPTIONS_HELP}`,
  })
  options: Record<string, unknown>;

  @ApiProperty({ description: 'Signed, single-use challenge to send back with the response' })
  challengeToken: string;
}

class WebAuthnResponseDto {
  @ApiProperty({ description: 'Signed challenge received with the options' })
  @IsString()
  @MaxLength(2048, { message: i18nValidationMessage() })
  challengeToken: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'What the browser returned (the JSON of the credential), as-is',
  })
  @IsObject()
  response: Record<string, unknown>;
}

export class RegisterPasskeyDto extends WebAuthnResponseDto {
  @ApiPropertyOptional({
    example: 'MacBook',
    maxLength: 100,
    description: 'Defaults to the browser and system (e.g. "Chrome · Windows")',
  })
  @IsOptional()
  @IsBoundedString(100)
  name?: string;
}

export class PasskeyLoginDto extends WebAuthnResponseDto {}

export class RenamePasskeyDto {
  @ApiProperty({ example: 'Work laptop', maxLength: 100 })
  @IsBoundedString(100)
  name: string;
}

export class PasskeyDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Chrome · Windows' })
  name: string;

  @ApiProperty({
    enum: ['singleDevice', 'multiDevice'],
    description: 'multiDevice = synced by a password manager (iCloud Keychain, Google...)',
  })
  deviceType: string;

  @ApiProperty({
    description: 'The passkey is backed up (synced), so losing one device does not lose it',
  })
  backedUp: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  lastUsedAt: Date | null;

  static from(p: Passkey): PasskeyDto {
    const { id, name, deviceType, backedUp, createdAt, lastUsedAt } = p;
    return { id, name, deviceType, backedUp, createdAt, lastUsedAt };
  }
}
