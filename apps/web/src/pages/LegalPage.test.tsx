import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../auth/AuthProvider';
import { SUPPORT_EMAIL } from '../config';
import { I18nProvider } from '../i18n/I18nProvider';
import { setLanguage } from '../i18n/language';
import { LEGAL } from '../legal/content';
import { LegalPage } from './LegalPage';

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <AuthProvider>
          <Routes>
            <Route path="/privacy" element={<LegalPage doc="privacy" />} />
            <Route path="/terms" element={<LegalPage doc="terms" />} />
          </Routes>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => setLanguage('pt-BR'));

describe('Privacidade e Termos (públicas)', () => {
  it('a política abre sem login, com o e-mail de contato como link', () => {
    renderAt('/privacy');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Política de Privacidade' }),
    ).toBeVisible();
    const contact = screen.getAllByRole('link', { name: SUPPORT_EMAIL })[0];
    expect(contact).toHaveAttribute('href', `mailto:${SUPPORT_EMAIL}`);
    expect(screen.queryByText(/\{(appName|owner|email|site)\}/)).not.toBeInTheDocument();
  });

  it('os termos abrem sem login e apontam para a política', () => {
    renderAt('/terms');

    expect(screen.getByRole('heading', { level: 1, name: 'Termos de Uso' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Política de Privacidade' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });

  it('os dois idiomas têm as mesmas seções', () => {
    for (const doc of ['privacy', 'terms'] as const) {
      expect(LEGAL[doc].en.sections).toHaveLength(LEGAL[doc]['pt-BR'].sections.length);
    }
  });
});
