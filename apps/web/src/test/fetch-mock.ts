import { vi } from 'vitest';

type Handler = (request: Request) => Response | Promise<Response>;

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Troca o fetch global por um roteador "MÉTODO /caminho" → resposta.
 * Devolve o mock para conferir as chamadas (cada uma recebe o Request completo).
 */
export function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const key = `${request.method} ${new URL(request.url).pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`fetch inesperado: ${key}`);
    return handler(request);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** O Request de uma chamada do mock (o refresh usa fetch(url, init), o cliente usa fetch(Request)). */
export function requestOf(call: unknown[]): Request {
  const [input, init] = call as [RequestInfo | URL, RequestInit | undefined];
  return input instanceof Request ? input : new Request(input, init);
}
