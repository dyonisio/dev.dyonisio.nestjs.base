import { Route, Routes } from 'react-router';
import { RequireAuth } from './components/RequireAuth';
import { AccountSecurityPage, HomePage, NotFoundPage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordPages';
import { RegisterPage } from './pages/RegisterPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';

/**
 * Rotas. As marcadas com (e-mail) recebem links dos e-mails da API: o caminho precisa ser
 * exatamente este (veja docs/GETTING_STARTED.md → "Telas que o front precisa ter").
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} /> {/* (e-mail) */}
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} /> {/* (e-mail) */}
      <Route path="/reset-password" element={<ResetPasswordPage />} /> {/* (e-mail) */}
      <Route path="/verify-email" element={<VerifyEmailPage />} /> {/* (e-mail) */}
      <Route
        path="/"
        element={
          <RequireAuth>
            <HomePage />
          </RequireAuth>
        }
      />
      <Route
        path="/account/security" /* (e-mail) */
        element={
          <RequireAuth>
            <AccountSecurityPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
