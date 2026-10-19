/** Endereço da API, definido no build (VITE_API_URL). Sem barra no final. */
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
