import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

/** O navegador sabe usar passkeys (quase todos os atuais; não em alguns webviews antigos). */
export const passkeysSupported = (): boolean =>
  typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';

// A biblioteca só é baixada quando a pessoa usa uma passkey (fica fora do carregamento inicial)
const webauthn = () => import('@simplewebauthn/browser');

/** Por que o navegador não conseguiu — cada motivo tem uma mensagem própria na tela. */
export type PasskeyFailure =
  | 'already-registered' // a passkey desta conta já está salva neste aparelho/gerenciador
  | 'wrong-domain' // o endereço do site não bate com o domínio da passkey (FRONTEND_URL da API)
  | 'no-lock' // o aparelho não tem PIN/biometria (ex.: Windows Hello não configurado)
  | 'unsupported' // nenhum autenticador compatível
  | 'unknown';

/** O navegador não conseguiu (sem ser a pessoa cancelando). `detail` = o erro original, para suporte. */
export class PasskeyBrowserError extends Error {
  override name = 'PasskeyBrowserError';

  constructor(
    readonly reason: PasskeyFailure,
    readonly detail: string,
  ) {
    super(detail);
  }
}

/** Traduz o erro do navegador (ou o código que a @simplewebauthn/browser deduz dele) num motivo. */
function failureOf(error: unknown): PasskeyFailure {
  const name = error instanceof Error ? error.name : '';
  const code = error instanceof Error && 'code' in error ? String(error.code) : '';
  if (name === 'InvalidStateError' || code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
    return 'already-registered';
  }
  if (
    name === 'SecurityError' ||
    code === 'ERROR_INVALID_RP_ID' ||
    code === 'ERROR_INVALID_DOMAIN'
  ) {
    return 'wrong-domain';
  }
  if (name === 'ConstraintError' || code.startsWith('ERROR_AUTHENTICATOR_MISSING_'))
    return 'no-lock';
  if (name === 'NotSupportedError') return 'unsupported';
  return 'unknown';
}

/** A pessoa fechou a janela do navegador ou o tempo acabou: não é erro, só não aconteceu. */
function cancelled(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'NotAllowedError' ||
      error.name === 'AbortError' ||
      ('code' in error && error.code === 'ERROR_CEREMONY_ABORTED'))
  );
}

async function ceremony<T>(run: () => Promise<T>): Promise<Record<string, unknown> | null> {
  try {
    return (await run()) as unknown as Record<string, unknown>;
  } catch (error) {
    if (cancelled(error)) return null;
    console.error('[passkey]', error); // o erro completo fica no console (F12) para diagnóstico
    const detail =
      error instanceof Error
        ? [error.name, 'code' in error && error.code, error.message].filter(Boolean).join(': ')
        : String(error);
    throw new PasskeyBrowserError(failureOf(error), detail);
  }
}

/** Pede ao navegador para criar a passkey. `null` = a pessoa cancelou. */
export const createPasskey = (options: Record<string, unknown>) =>
  ceremony(async () =>
    (await webauthn()).startRegistration({
      optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
    }),
  );

/** Pede ao navegador para assinar o desafio com uma passkey salva. `null` = a pessoa cancelou. */
export const signWithPasskey = (options: Record<string, unknown>) =>
  ceremony(async () =>
    (await webauthn()).startAuthentication({
      optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
    }),
  );

/** Mensagem da tela para uma falha do navegador, com o detalhe técnico no fim. */
export function passkeyFailureMessage(
  messages: Record<PasskeyFailure, string>,
  error: PasskeyBrowserError,
): string {
  return `${messages[error.reason]} (${error.detail})`;
}
