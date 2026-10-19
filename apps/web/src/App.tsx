import { Route, Routes } from 'react-router';
import { AppLayout, RequirePermission } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { PrivacyPage } from './pages/account/PrivacyPage';
import { ProfilePage } from './pages/account/ProfilePage';
import { SecurityPage } from './pages/account/SecurityPage';
import { AuditPage } from './pages/admin/AuditPage';
import { UserDetailPage } from './pages/admin/UserDetailPage';
import { UsersPage } from './pages/admin/UsersPage';
import { HomePage, NotFoundPage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { CreatePasswordPage, MagicLinkPage } from './pages/MagicLinkPages';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordPages';
import { RegisterPage } from './pages/RegisterPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';

/**
 * Rotas. As marcadas com (e-mail) recebem links dos e-mails da API: o caminho precisa ser
 * exatamente este (veja docs/WEB.md → Telas).
 */
export function App() {
  return (
    <Routes>
      {/* Públicas */}
      <Route path="/login" element={<LoginPage />} /> {/* (e-mail) */}
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} /> {/* (e-mail) */}
      <Route path="/verify-email" element={<VerifyEmailPage />} /> {/* (e-mail) */}
      <Route path="/magic-link" element={<MagicLinkPage />} /> {/* (e-mail) */}
      <Route
        path="/create-password"
        element={
          <RequireAuth>
            <CreatePasswordPage />
          </RequireAuth>
        }
      />
      {/* Logadas: todas dentro do layout com o menu */}
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="/account" element={<ProfilePage />} />
        <Route path="/account/security" element={<SecurityPage />} /> {/* (e-mail) */}
        <Route path="/account/privacy" element={<PrivacyPage />} />
        <Route
          path="/admin/users"
          element={
            <RequirePermission permission="users:read">
              <UsersPage />
            </RequirePermission>
          }
        />
        <Route
          path="/admin/users/:id"
          element={
            <RequirePermission permission="users:read">
              <UserDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="/admin/audit"
          element={
            <RequirePermission permission="audit:read">
              <AuditPage />
            </RequirePermission>
          }
        />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
