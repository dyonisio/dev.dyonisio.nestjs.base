import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError, type ApiError } from '../api/client';

/**
 * Executa uma ação (salvar, excluir...) cuidando do "carregando" e do erro.
 *
 * @example
 * const { run, busy, error } = useAction();
 * <form onSubmit={(e) => { e.preventDefault(); void run(async () => { ...; setDone(true); }); }}>
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (e) {
      setError(toApiError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { run, busy, error, setError };
}

/**
 * Carrega dados ao abrir a tela (e de novo quando `deps` mudam ou ao chamar `reload`).
 * A função recebe o resultado do openapi-fetch ({ data, error }) — o erro vira `error`.
 *
 * @example
 * const sessions = useQuery(() => api.GET('/api/v1/users/me/sessions'), []);
 */
export function useQuery<T>(
  load: () => Promise<{ data?: T; error?: unknown }>,
  deps: readonly unknown[],
) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadRef
      .current()
      .then(({ data: result, error: apiError }) => {
        if (!active) return;
        if (apiError) throw apiError;
        setData(result);
        setError(null);
      })
      .catch((e: unknown) => active && setError(toApiError(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload, setData };
}
