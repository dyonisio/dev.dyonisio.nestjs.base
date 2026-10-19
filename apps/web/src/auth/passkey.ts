import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

/** O navegador sabe usar passkeys (quase todos os atuais; não em alguns webviews antigos). */
export const passkeysSupported = (): boolean =>
  typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';

// A biblioteca só é baixada quando a pessoa usa uma passkey (fica fora do carregamento inicial)
const webauthn = () => import('@simplewebauthn/browser');

/** O navegador não conseguiu (sem ser a pessoa cancelando): a tela mostra uma mensagem própria. */
export class PasskeyBrowserError extends Error {
  override name = 'PasskeyBrowserError';
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
    throw new PasskeyBrowserError(error instanceof Error ? error.message : String(error));
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
