import { Role } from '../../common/enums/role.enum';

export interface JwtPayload {
  sub: string;
  /** Id da sessão — permite revogar o access token antes do `exp`. */
  sid: string;
  email: string;
  role: Role;
}

export interface ResetPasswordPayload {
  sub: string;
  purpose: 'reset-password';
}
