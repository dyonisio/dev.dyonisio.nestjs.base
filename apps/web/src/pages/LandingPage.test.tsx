import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { APP_NAME } from '../config';
import { I18nProvider } from '../i18n/I18nProvider';
import { setLanguage } from '../i18n/language';
import { makeUser, renderApp } from '../test/render';

/** O app inteiro SEM sessão (visitante), na rota `path`. */
function renderAnonymous(path = '/') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => setLanguage('en'));
afterEach(() => vi.unstubAllGlobals());

describe('página inicial pública', () => {
  it('sem login, / mostra a página do produto (e não manda para o login)', async () => {
    renderAnonymous();

    // a página é carregada sob demanda (lazy)
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(APP_NAME);
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register',
    );
  });

  it('logado, / continua sendo o Início do painel', async () => {
    renderApp('/', makeUser());

    expect(await screen.findByRole('link', { name: 'Security' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument();
  });

  it('as outras rotas logadas continuam mandando para o login', async () => {
    renderAnonymous('/account');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('"give it your name": o comando e os recursos da AWS seguem o nome digitado', async () => {
    renderAnonymous();
    const field = await screen.findByLabelText('Your product name');

    await userEvent.clear(field);
    await userEvent.type(field, 'Café São João');

    expect(
      screen.getByText('node scripts/new-project.mjs --name "Café São João" --color "#1b6c80"'),
    ).toBeInTheDocument();
    expect(screen.getByText(/cafe-sao-joao-api, cafe-sao-joao-web/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Blue' }));
    expect(screen.getByText(/--color "#2563eb"/)).toBeInTheDocument();
  });

  it('o e-mail da chamada final chega preenchido no cadastro', async () => {
    renderAnonymous();

    await userEvent.type(await screen.findByLabelText('your email'), 'ana@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'start' }));

    expect(await screen.findByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveValue('ana@example.com');
  });
});
