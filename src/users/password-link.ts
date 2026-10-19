import { deriveSecret } from '../common/crypto/derive-secret';
import { User } from './entities/user.entity';

/**
 * Segredo dos links de "definir senha" (esqueci a senha e convite do admin).
 * O hash da senha atual entra na derivação: assim que a senha muda, todo link já
 * enviado deixa de valer (uso único), sem tabela de tokens. Conta sem senha (convite,
 * login social) usa o id — e o link morre quando a primeira senha é criada.
 */
export function passwordLinkSecret(
  masterSecret: string,
  user: Pick<User, 'id'> & { password?: string | null },
): string {
  return deriveSecret(masterSecret, 'reset-password', user.password ?? `no-password:${user.id}`);
}
