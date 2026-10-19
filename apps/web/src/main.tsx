import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { I18nProvider } from './i18n/I18nProvider';
import { getLanguage } from './i18n/language';
import { applyTheme } from './lib/theme';
import './styles.css';

document.documentElement.lang = getLanguage();
applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
