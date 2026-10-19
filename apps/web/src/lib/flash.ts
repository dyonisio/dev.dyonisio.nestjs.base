/**
 * Aviso para a PRÓXIMA tela (ex.: "conta excluída" no login).
 *
 * Não dá para mandar pelo `state` da navegação quando a sessão acaba junto: a proteção de rota
 * (RequireAuth) reage primeiro e redireciona para o login sem o state. Fica só em memória.
 */
export type Notice = 'accountDeleted';

let pending: Notice | null = null;

export const flash = {
  set(notice: Notice) {
    pending = notice;
  },
  peek: (): Notice | null => pending,
  clear() {
    pending = null;
  },
};
