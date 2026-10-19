import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, requestOf } from '../test/fetch-mock';
import { lastBody, makeUser, renderApp } from '../test/render';

// O QR code usa <canvas>, que o navegador simulado não tem
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,qr' } }));

afterEach(() => vi.unstubAllGlobals());

describe('menu e permissões', () => {
  it('usuário comum não vê as telas de admin', async () => {
    renderApp('/', makeUser({ role: 'user' }));

    expect(await screen.findByRole('link', { name: 'Security' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });

  it('abrir uma tela de admin sem permissão mostra "acesso negado" (sem chamar a API)', async () => {
    const fetch = renderApp('/admin/users', makeUser({ role: 'user' }));

    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    const listed = fetch.mock.calls.some((c) =>
      new URL(requestOf(c).url).pathname.endsWith('/api/v1/users'),
    );
    expect(listed).toBe(false);
  });

  it('admin vê usuários e auditoria no menu', async () => {
    renderApp('/', makeUser({ role: 'admin' }));

    expect(await screen.findByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
  });

  it('sem sessão, manda para o login', async () => {
    renderApp('/account', makeUser(), {
      'POST /api/v1/auth/refresh': () =>
        json(401, { statusCode: 401, code: 'auth.invalidRefreshToken', message: '' }),
    });

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('segurança: ativar o 2FA', () => {
  it('senha → QR code → código → códigos de recuperação', async () => {
    let user = makeUser();
    const fetch = renderApp('/account/security', user, {
      'GET /api/v1/users/me': () => json(200, user),
      'GET /api/v1/users/me/sessions': () => json(200, []),
      'POST /api/v1/auth/2fa/setup': () =>
        json(201, { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/x' }),
      'POST /api/v1/auth/2fa/enable': () => {
        user = { ...user, twoFactorEnabledAt: '2026-10-19T12:00:00.000Z' };
        return json(200, { recoveryCodes: ['AAAA-BBBB', 'CCCC-DDDD'] });
      },
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    await userEvent.type(screen.getByLabelText('Current password'), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByAltText('QR code')).toBeInTheDocument();
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(await lastBody(fetch, 'POST', '/api/v1/auth/2fa/setup')).toEqual({
      currentPassword: 'secret123',
    });

    await userEvent.type(screen.getByLabelText('Authenticator code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Activate' }));

    const codes = await screen.findByRole('list', { name: 'Recovery codes' });
    expect(within(codes).getByText('AAAA-BBBB')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'I saved the codes' }));
    expect(await screen.findByText(/On since/)).toBeInTheDocument();
  });
});

describe('privacidade: excluir a conta', () => {
  it('confirma numa janela com a senha; cancelar não exclui; depois vai para o login', async () => {
    const fetch = renderApp('/account/privacy', makeUser(), {
      'DELETE /api/v1/users/me': () => new Response(null, { status: 204 }),
    });
    const deleted = () => fetch.mock.calls.some((c) => requestOf(c).method === 'DELETE');

    // a senha não fica no painel: só aparece na janela de confirmação
    await userEvent.click(await screen.findByRole('button', { name: 'Delete my account' }));
    let dialog = screen.getByRole('dialog', { name: 'Delete your account?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deleted()).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    dialog = screen.getByRole('dialog', { name: 'Delete your account?' });
    await userEvent.type(within(dialog).getByLabelText('Current password'), 'secret123');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete my account' }));

    expect(await screen.findByText(/Your account was deleted/)).toBeInTheDocument();
    expect(await lastBody(fetch, 'DELETE', '/api/v1/users/me')).toEqual({
      currentPassword: 'secret123',
    });
  });
});

describe('tema', () => {
  it('claro por padrão; a escolha vale na hora e fica salva', async () => {
    renderApp('/account', makeUser(), {});
    const select = await screen.findByRole('combobox', { name: 'Theme' });

    expect(select).toHaveValue('light');
    await userEvent.selectOptions(select, 'dark');

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('nb.theme')).toBe('dark');
  });
});

describe('admin: criar usuário', () => {
  it('sem senha manda convite; sem users:manage-roles nem mostra a role', async () => {
    const admin = makeUser({ role: 'admin', permissions: ['users:read', 'users:create'] });
    const fetch = renderApp('/admin/users', admin, {
      'GET /api/v1/users': () =>
        json(200, { data: [admin], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } }),
      'POST /api/v1/users': () =>
        json(201, makeUser({ id: '2', name: 'Bob', email: 'bob@example.com' })),
    });

    await userEvent.click(await screen.findByRole('button', { name: 'New user' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText('Role')).not.toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText('Name'), 'Bob');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'bob@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'New user' }));

    expect(await screen.findByText(/We emailed an invitation to bob@example.com/)).toBeVisible();
    expect(await lastBody(fetch, 'POST', '/api/v1/users')).toEqual({
      name: 'Bob',
      email: 'bob@example.com',
      locale: 'en',
    });
  });
});

describe('minha conta: botões só acendem quando faz sentido', () => {
  it('dados pessoais: Salvar desligado sem mudança; liga ao mudar; desliga se voltar', async () => {
    renderApp('/account', makeUser({ name: 'Jane Doe' }));

    const name = await screen.findByLabelText('Name');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    await userEvent.type(name, 'x');
    expect(save).toBeEnabled();

    await userEvent.type(name, '{Backspace}');
    expect(save).toBeDisabled();
  });

  it('senha: Trocar senha desligado até os três campos estarem preenchidos', async () => {
    renderApp('/account', makeUser());

    const change = await screen.findByRole('button', { name: 'Change password' });
    expect(change).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Current password'), 'Senha123');
    await userEvent.type(screen.getByLabelText('New password'), 'NovaSenha1');
    expect(change).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Confirm the new password'), 'NovaSenha1');
    expect(change).toBeEnabled();
  });
});
