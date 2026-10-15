import * as bcrypt from 'bcryptjs';

/**
 * Hash de senhas (bcrypt). Custo em BCRYPT_ROUNDS (padrão 12; cada +1 dobra o tempo).
 * Lido na hora do uso: o .env já foi carregado pelo ConfigModule.
 */
export const bcryptRounds = () => parseInt(process.env.BCRYPT_ROUNDS ?? '', 10) || 12;

export const hashPassword = (plain: string) => bcrypt.hash(plain, bcryptRounds());

let dummyHash: string | undefined;

/**
 * Confere a senha. Sem hash (usuário inexistente ou conta só com login social), compara
 * contra um hash qualquer do MESMO custo e devolve false: o tempo de resposta é igual
 * nos dois casos, então não dá para descobrir quais e-mails estão cadastrados medindo-o.
 */
export async function verifyPassword(plain: string, hash: string | null | undefined) {
  dummyHash ??= bcrypt.hashSync('dummy-password-for-timing', bcryptRounds());
  const valid = await bcrypt.compare(plain, hash ?? dummyHash);
  return !!hash && valid;
}
