import { useEffect, useSyncExternalStore } from 'react';
import { api, toApiError, type ApiError } from '../api/client';
import type { components } from '../api/schema';
import { useAuth } from './AuthProvider';
import { session } from './session';

export type LoginMethods = components['schemas']['LoginMethodsDto'];

interface State {
  data?: LoginMethods;
  error: ApiError | null;
  loading: boolean;
}

/**
 * Formas de login da pessoa logada (tem senha? Google/Apple vinculados?), buscadas UMA vez e
 * compartilhadas: a moldura, Segurança, Minha conta e a janela "confirme que é você" leem o
 * mesmo resultado. Depois de mudar algo (criar a senha, desvincular), chame
 * refreshLoginMethods() e todas as telas se atualizam juntas.
 */
let state: State = { error: null, loading: false };
let owner: string | null = null; // de quem são os dados (trocou de conta → busca de novo)
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Busca de novo (uma só, mesmo se várias telas pedirem ao mesmo tempo). */
export function refreshLoginMethods(): Promise<void> {
  inflight ??= (async () => {
    set({ ...state, loading: true });
    try {
      const { data, error } = await api.GET('/api/v1/users/me/identities');
      if (error || !data) throw error;
      set({ data, error: null, loading: false });
    } catch (e) {
      set({ ...state, error: toApiError(e), loading: false });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Esquece tudo (saiu da conta; e nos testes, entre um teste e outro). */
export function resetLoginMethods() {
  owner = null;
  inflight = null;
  state = { error: null, loading: false };
}

// Saiu da conta: o próximo login busca do zero
session.subscribe(() => {
  if (!session.getAccessToken() && !session.hasSession()) resetLoginMethods();
});

export function useLoginMethods() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const current = useSyncExternalStore(subscribe, () => state);

  useEffect(() => {
    if (!userId || owner === userId) return;
    owner = userId;
    set({ error: null, loading: true });
    void refreshLoginMethods();
  }, [userId]);

  return { ...current, reload: refreshLoginMethods };
}
