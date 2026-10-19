/**
 * Pré-visualização das telas com dados de exemplo, SEM API e sem login (só em desenvolvimento).
 *
 *   http://localhost:5173/preview.html?path=/admin/users        logado como admin
 *   http://localhost:5173/preview.html?path=/account&as=user    logado como usuário comum
 *   http://localhost:5173/preview.html?path=/login&as=anonymous tela pública
 *   ...&theme=light | &theme=dark | &lang=en                     tema e idioma
 *
 * Serve para ajustar o visual e para ver telas de admin sem ter um admin. Não entra no build
 * (o `vite build` só empacota o index.html).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { App } from '../App';
import { AuthProvider } from '../auth/AuthProvider';
import { session } from '../auth/session';
import { I18nProvider } from '../i18n/I18nProvider';
import { getLanguage, setLanguage, type Language } from '../i18n/language';
import { applyTheme } from '../lib/theme';
import '../styles.css';
import { me } from './data';
import { installMockApi } from './mock-api';

const params = new URLSearchParams(location.search);
const as = params.get('as') ?? 'admin';
const lang = params.get('lang') as Language | null;
if (lang) setLanguage(lang);
// ?theme= força só nesta visita (sem salvar); sem ele, vale o tema escolhido no app (claro por padrão)
const theme = params.get('theme');
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
else applyTheme();
document.documentElement.lang = getLanguage();

session.clear();
if (as === 'admin' || as === 'user') {
  installMockApi(me[as]);
  session.start({ accessToken: 'preview', refreshToken: 'preview' });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MemoryRouter initialEntries={[params.get('path') ?? '/']}>
      <I18nProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>
  </StrictMode>,
);
