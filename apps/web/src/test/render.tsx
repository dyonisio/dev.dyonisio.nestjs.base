import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import type { Permission } from '../auth/permissions';
import { session, type User } from '../auth/session';
import { I18nProvider } from '../i18n/I18nProvider';
import { setLanguage } from '../i18n/language';
import { json, mockFetch } from './fetch-mock';

const ALL: Permission[] = [
  'users:read',
  'users:create',
  'users:update',
  'users:delete',
  'users:manage-roles',
  'users:reset-2fa',
  'audit:read',
  'plans:manage',
];

/** Usuário de teste. `permissions` padrão: as do papel (admin = todas). */
export function makeUser(overrides: Partial<User> = {}): User {
  const role = overrides.role ?? 'user';
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Jane Doe',
    email: 'jane@example.com',
    pendingEmail: null,
    role,
    permissions: role === 'admin' ? ALL : role === 'manager' ? ['users:read'] : [],
    isActive: true,
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    locale: 'en',
    avatarUrl: null,
    twoFactorEnabledAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    anonymizedAt: null,
    ...overrides,
  };
}

type Routes = Parameters<typeof mockFetch>[0];

/**
 * Abre o app inteiro já logado como `user`, na rota `path`, com a API falsa `routes`.
 * (A sessão é restaurada pelo refresh, como ao recarregar a página.)
 */
export function renderApp(path: string, user: User, routes: Routes = {}) {
  setLanguage('en');
  session.start({ accessToken: 'access' });
  const fetch = mockFetch({
    'POST /api/v1/auth/refresh': () =>
      json(200, { accessToken: 'access', refreshToken: 'refresh', user }),
    'GET /api/v1/users/me': () => json(200, user),
    'GET /api/v1/users/me/identities': () => json(200, { hasPassword: true, identities: [] }),
    ...routes,
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
  return fetch;
}

/** Corpo JSON da última chamada para `method path`. */
export async function lastBody(
  fetch: ReturnType<typeof mockFetch>,
  method: string,
  path: string,
): Promise<unknown> {
  const call = fetch.mock.calls
    .map(([input, init]) => (input instanceof Request ? input : new Request(input, init)))
    .filter((r) => r.method === method && new URL(r.url).pathname === path)
    .at(-1);
  if (!call) throw new Error(`nenhuma chamada ${method} ${path}`);
  return call.clone().json();
}
