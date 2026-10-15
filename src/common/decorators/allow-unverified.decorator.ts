import { SetMetadata } from '@nestjs/common';

export const ALLOW_UNVERIFIED_KEY = 'allowUnverified';

/**
 * Libera a rota para usuários logados que ainda NÃO confirmaram o e-mail.
 * Por padrão toda rota autenticada exige e-mail confirmado (EmailVerifiedGuard) —
 * use só no mínimo necessário: ver/editar o perfil, reenviar o link, trocar a senha.
 */
export const AllowUnverified = () => SetMetadata(ALLOW_UNVERIFIED_KEY, true);
