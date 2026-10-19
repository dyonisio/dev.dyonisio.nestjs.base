import { PickType } from '@nestjs/swagger';
import { CreateUserDto } from '../../users/dto/create-user.dto';

/** Auto-cadastro público: sempre cria com role "user" (enviar "role" retorna 400). */
export class RegisterDto extends PickType(CreateUserDto, [
  'name',
  'email',
  'password',
  'locale',
] as const) {}
