import { useEffect, useRef, useState } from 'react';
import { useAuth, type LoginResult } from '../auth/AuthProvider';
import { APPLE_CLIENT_ID, APPLE_REDIRECT_URI, GOOGLE_CLIENT_ID } from '../config';
import { useI18n } from '../i18n/I18nProvider';
import { ErrorAlert } from './ui';
import { toApiError, type ApiError } from '../api/client';

/*
 * Login social com os SDKs oficiais, carregados só quando o client ID está configurado:
 *  - Google Identity Services: https://developers.google.com/identity/gsi/web
 *  - Sign in with Apple JS:    https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_js
 * O SDK devolve um ID token; a API confere assinatura, audiência e nonce (docs/AUTH.md → Login social).
 */

interface GoogleIdApi {
  initialize(options: {
    client_id: string;
    nonce: string;
    callback: (response: { credential: string }) => void;
  }): void;
  renderButton(
    element: HTMLElement,
    options: { theme?: string; size?: string; width?: number; text?: string; locale?: string },
  ): void;
}

interface AppleAuthApi {
  init(options: {
    clientId: string;
    scope: string;
    redirectURI: string;
    usePopup: boolean;
    nonce: string;
  }): void;
  signIn(): Promise<{
    authorization: { id_token: string };
    user?: { name?: { firstName?: string; lastName?: string } };
  }>;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
    AppleID?: { auth: AppleAuthApi };
  }
}

const scripts = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  let promise = scripts.get(src);
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scripts.delete(src);
        reject(new Error(`não carregou ${src}`));
      };
      document.head.appendChild(script);
    });
    scripts.set(src, promise);
  }
  return promise;
}

/** Valor aleatório de uso único: amarra o ID token a ESTE login (impede reaproveitar um token). */
function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const socialLoginEnabled = !!GOOGLE_CLIENT_ID || !!APPLE_CLIENT_ID;

/**
 * Botões "Continuar com Google/Apple". `onResult` recebe o mesmo resultado do login por senha
 * (entrou, ou precisa do código do 2FA).
 */
export function SocialLogin({ onResult }: { onResult: (result: LoginResult) => void }) {
  const { m } = useI18n();
  const [error, setError] = useState<ApiError | null>(null);
  if (!socialLoginEnabled) return null;

  const handle = (promise: Promise<LoginResult>) => {
    setError(null);
    promise.then(onResult, (e: unknown) => {
      const apiError = toApiError(e);
      setError(apiError.code === 'network' ? { ...apiError, message: m.social.failed } : apiError);
    });
  };

  return (
    <div className="social">
      <div className="divider">
        <span>{m.common.or}</span>
      </div>
      {GOOGLE_CLIENT_ID && <GoogleButton onToken={handle} />}
      {APPLE_CLIENT_ID && <AppleButton onToken={handle} />}
      <ErrorAlert error={error} />
    </div>
  );
}

function GoogleButton({ onToken }: { onToken: (p: Promise<LoginResult>) => void }) {
  const { lang } = useI18n();
  const { socialLogin } = useAuth();
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;

  useEffect(() => {
    let active = true;
    void loadScript('https://accounts.google.com/gsi/client').then(() => {
      const google = window.google?.accounts.id;
      if (!active || !google || !ref.current) return;
      const nonce = newNonce();
      google.initialize({
        client_id: GOOGLE_CLIENT_ID,
        nonce,
        callback: ({ credential }) =>
          callback.current(socialLogin('google', { idToken: credential, nonce, locale: lang })),
      });
      google.renderButton(ref.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'continue_with',
        locale: lang,
      });
    });
    return () => {
      active = false;
    };
  }, [lang, socialLogin]);

  return <div ref={ref} className="google-button" />;
}

function AppleButton({ onToken }: { onToken: (p: Promise<LoginResult>) => void }) {
  const { m, lang } = useI18n();
  const { socialLogin } = useAuth();

  const signIn = () =>
    onToken(
      (async () => {
        await loadScript(
          'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js',
        );
        const apple = window.AppleID!.auth;
        const nonce = newNonce();
        apple.init({
          clientId: APPLE_CLIENT_ID,
          scope: 'name email',
          redirectURI: APPLE_REDIRECT_URI || window.location.origin,
          usePopup: true,
          nonce,
        });
        const { authorization, user } = await apple.signIn();
        // A Apple só manda o nome no PRIMEIRO login: repassa para a API guardar
        const name = [user?.name?.firstName, user?.name?.lastName].filter(Boolean).join(' ');
        return socialLogin('apple', {
          idToken: authorization.id_token,
          nonce,
          ...(name ? { name } : {}),
          locale: lang,
        });
      })(),
    );

  return (
    <button type="button" className="apple-button" onClick={signIn}>
      {m.social.apple}
    </button>
  );
}
