import { ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

/** Usado por admins para editar qualquer usuário. */
export class UpdateUserDto extends PartialType(
  PickType(CreateUserDto, ['name', 'email', 'locale'] as const),
) {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Usado pelo próprio usuário para editar o seu perfil. O e-mail NÃO entra aqui:
 * trocá-lo exige confirmar a senha e o novo endereço (POST /users/me/email).
 */
export class UpdateProfileDto extends PartialType(
  PickType(CreateUserDto, ['name', 'locale'] as const),
) {}
