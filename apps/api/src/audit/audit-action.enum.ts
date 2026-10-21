/** Eventos registrados na trilha de auditoria (tabela audit_logs). */
export enum AuditAction {
  // Autenticação e segurança
  AUTH_LOGIN = 'auth.login',
  AUTH_LOGIN_FAILED = 'auth.login_failed',
  AUTH_LOGOUT = 'auth.logout',
  AUTH_REFRESH_TOKEN_REUSE = 'auth.refresh_token_reuse',
  AUTH_PASSWORD_CHANGED = 'auth.password_changed',
  AUTH_PASSWORD_RESET = 'auth.password_reset',
  AUTH_MAGIC_LINK_SENT = 'auth.magic_link_sent',
  AUTH_EMAIL_VERIFIED = 'auth.email_verified',
  AUTH_2FA_ENABLED = 'auth.2fa_enabled',
  AUTH_2FA_DISABLED = 'auth.2fa_disabled',
  AUTH_2FA_FAILED = 'auth.2fa_failed',
  AUTH_2FA_RECOVERY_CODE_USED = 'auth.2fa_recovery_code_used',
  AUTH_2FA_RECOVERY_CODES_REGENERATED = 'auth.2fa_recovery_codes_regenerated',
  AUTH_2FA_RESET_BY_ADMIN = 'auth.2fa_reset_by_admin',
  AUTH_SOCIAL_LINKED = 'auth.social_linked',
  AUTH_SOCIAL_UNLINKED = 'auth.social_unlinked',
  AUTH_PASSKEY_ADDED = 'auth.passkey_added',
  AUTH_PASSKEY_REMOVED = 'auth.passkey_removed',

  // Usuários
  USER_REGISTERED = 'user.registered',
  USER_CREATED = 'user.created',
  USER_INVITATION_SENT = 'user.invitation_sent',
  USER_UPDATED = 'user.updated',
  USER_ROLE_CHANGED = 'user.role_changed',
  USER_DELETED = 'user.deleted',
  USER_RESTORED = 'user.restored',
  USER_AVATAR_CHANGED = 'user.avatar_changed',
  USER_EMAIL_CHANGE_REQUESTED = 'user.email_change_requested',
  USER_EMAIL_CHANGED = 'user.email_changed',
  USER_SELF_DELETED = 'user.self_deleted',
  USER_DATA_EXPORTED = 'user.data_exported',
  USER_ANONYMIZED = 'user.anonymized',

  // Sessões
  SESSION_REVOKED = 'session.revoked',

  // Pagamentos
  PAYMENT_PAID = 'payment.paid',
  PAYMENT_REFUNDED = 'payment.refunded',
  SUBSCRIPTION_STARTED = 'subscription.started',
  SUBSCRIPTION_CANCELED = 'subscription.canceled',
  PLAN_CREATED = 'plan.created',
  PLAN_UPDATED = 'plan.updated',
}

export type AuditTargetType = 'user' | 'session' | 'plan';
