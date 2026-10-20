/** Configuração definida no build (variáveis VITE_*: vão para o JavaScript público — nada secreto). */
const env = import.meta.env;

/** Nome do produto (barra lateral, login, título da aba). No deploy vem da variável APP_NAME. */
export const APP_NAME: string = env.VITE_APP_NAME || 'NestJS Base';

/**
 * Páginas públicas de Privacidade e Termos (/privacy, /terms): quem é o responsável pelos dados
 * e o e-mail de contato. No deploy vêm das variáveis LEGAL_OWNER e SUPPORT_EMAIL.
 */
export const LEGAL_OWNER: string = env.VITE_LEGAL_OWNER || APP_NAME;
export const SUPPORT_EMAIL: string = env.VITE_SUPPORT_EMAIL || 'support@example.com';

/** Endereço da API, sem barra no final. */
export const API_URL = (env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * Login social: o botão só aparece com o client ID preenchido. Use o MESMO client ID que está
 * em GOOGLE_CLIENT_IDS / APPLE_CLIENT_IDS na API (senão a API recusa o token).
 */
export const GOOGLE_CLIENT_ID: string = env.VITE_GOOGLE_CLIENT_ID ?? '';
/** Apple: o "Services ID" (ex.: com.exemplo.web) e a URL de retorno cadastrada nele. */
export const APPLE_CLIENT_ID: string = env.VITE_APPLE_CLIENT_ID ?? '';
export const APPLE_REDIRECT_URI: string = env.VITE_APPLE_REDIRECT_URI ?? '';
