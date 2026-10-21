/**
 * Dados de EXEMPLO da pré-visualização (preview.html). Nada daqui vai para o build de produção.
 * Datas relativas a "agora", para a tela sempre parecer de hoje. Totais são contados das linhas.
 */
import type { components } from '../api/schema';
import type { Permission } from '../auth/permissions';
import type { User } from '../auth/session';

type AuditLog = components['schemas']['AuditLog'];
type Session = components['schemas']['SessionResponseDto'];

const now = Date.now();
const minutes = (n: number) => new Date(now - n * 60_000).toISOString();
const days = (n: number) => minutes(n * 24 * 60);

const ALL: Permission[] = [
  'users:read',
  'users:create',
  'users:update',
  'users:delete',
  'users:manage-roles',
  'users:reset-2fa',
  'audit:read',
];

function user(
  n: number,
  name: string,
  email: string,
  role: User['role'],
  extra: Partial<User> = {},
): User {
  return {
    id: `0b9e${String(n).padStart(4, '0')}-4c1a-4f2e-9d3b-7a51c0e8${String(n).padStart(4, '0')}`,
    name,
    email,
    pendingEmail: null,
    role,
    permissions: role === 'admin' ? ALL : role === 'manager' ? ['users:read'] : [],
    isActive: true,
    emailVerifiedAt: days(120 - n * 4),
    locale: 'pt-BR',
    avatarUrl: null,
    twoFactorEnabledAt: null,
    createdAt: days(120 - n * 4),
    updatedAt: days(10 - (n % 9)),
    deletedAt: null,
    anonymizedAt: null,
    ...extra,
  };
}

export const users: User[] = [
  user(1, 'Mateus Dyonisio', 'mateus@dyonisio.dev', 'admin', { twoFactorEnabledAt: days(60) }),
  user(2, 'Beatriz Nogueira', 'beatriz.nogueira@estudio-lume.com.br', 'admin', {
    twoFactorEnabledAt: days(41),
  }),
  user(3, 'Rafael Antunes', 'rafael@antunes.dev', 'manager'),
  user(4, 'Camila Ferraz', 'camila.ferraz@gmail.com', 'user', { twoFactorEnabledAt: minutes(130) }),
  user(5, 'Thiago Moreira', 'thiago.moreira@outlook.com', 'user'),
  user(6, 'Juliana Prado', 'ju.prado@hotmail.com', 'user', {
    emailVerifiedAt: null,
    createdAt: days(9),
  }),
  // 2FA desligado pelo admin há 7 dias (perdeu o celular): veja a auditoria
  user(7, 'Lucas Barreto', 'lucas.barreto@estudio-lume.com.br', 'manager'),
  user(8, 'Fernanda Rocha', 'fernanda.rocha@gmail.com', 'user'),
  user(9, 'Gabriel Teixeira', 'gabriel.t@proton.me', 'user', { isActive: false }),
  user(10, 'Larissa Campos', 'larissa.campos@gmail.com', 'user', { locale: 'en' }),
  user(11, 'Pedro Henrique Lima', 'pedrohlima@yahoo.com.br', 'user'),
  // Criada pelo admin há 43 min (convite): e-mail já vale como confirmado
  user(12, 'Aline Duarte', 'aline.duarte@estudio-lume.com.br', 'user', {
    emailVerifiedAt: minutes(43),
    createdAt: minutes(43),
  }),
  user(13, 'Vinícius Souza', 'vini.souza@gmail.com', 'user', {
    deletedAt: days(6),
  }),
  user(14, 'Marina Albuquerque', 'marina.alb@gmail.com', 'user', {
    deletedAt: days(19),
  }),
];

/** Quem está "logado" em cada modo da pré-visualização. */
export const me = {
  admin: users[0]!,
  user: users[3]!,
};

export const sessions: Session[] = [
  {
    id: 's-1',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
    ip: '177.92.14.201',
    createdAt: days(3),
    lastUsedAt: minutes(2),
    current: true,
  },
  {
    id: 's-2',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    ip: '189.40.77.12',
    createdAt: days(9),
    lastUsedAt: minutes(5 * 60 + 12),
    current: false,
  },
  {
    id: 's-3',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
    ip: '200.155.3.88',
    createdAt: days(21),
    lastUsedAt: days(4),
    current: false,
  },
];

export const identities = {
  hasPassword: true,
  identities: [{ provider: 'google', email: 'mateus@dyonisio.dev', createdAt: days(58) }],
  passkeys: 2,
};

export const plans: components['schemas']['PlansResponseDto'] = {
  plans: [
    {
      id: 'pro-lifetime',
      kind: 'one_time',
      amount: 9900,
      currency: 'BRL',
      name: 'Pro vitalício',
      description: 'Paga uma vez e fica com o Pro para sempre.',
      providers: ['stripe', 'infinitepay', 'abacatepay'],
    },
    {
      id: 'pro-monthly',
      kind: 'subscription',
      interval: 'month',
      amount: 2990,
      currency: 'BRL',
      name: 'Pro mensal',
      description: 'Cobrado todo mês. Cancele quando quiser.',
      providers: ['stripe', 'abacatepay'],
    },
  ],
  providers: [
    { id: 'stripe', methods: ['card'] },
    { id: 'infinitepay', methods: ['pix', 'card'] },
    { id: 'abacatepay', methods: ['pix', 'card'] },
  ],
};

export const billing: components['schemas']['BillingDto'] = {
  plan: 'pro',
  subscription: {
    id: '5b1c0001-0000-4000-8000-000000000001',
    planId: 'pro-monthly',
    provider: 'stripe',
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: days(-18),
    canceledAt: null,
    createdAt: days(42),
  },
  payments: [
    {
      id: '5b1c0002-0000-4000-8000-000000000002',
      planId: 'pro-monthly',
      kind: 'subscription',
      provider: 'stripe',
      status: 'paid',
      amount: 2990,
      currency: 'BRL',
      paidAt: days(42),
      createdAt: days(42),
    },
  ],
};

export const passkeys: components['schemas']['PasskeyDto'][] = [
  {
    id: '7d1c0001-0000-4000-8000-000000000001',
    name: 'iCloud · iPhone',
    deviceType: 'multiDevice',
    backedUp: true,
    createdAt: days(40),
    lastUsedAt: minutes(95),
  },
  {
    id: '7d1c0002-0000-4000-8000-000000000002',
    name: 'Chave de segurança',
    deviceType: 'singleDevice',
    backedUp: false,
    createdAt: days(12),
    lastUsedAt: null,
  },
];

// Cada dispositivo sai sempre do mesmo IP (o mesmo das sessões acima)
const ipOf: Record<string, string> = {};
const chromeWin =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const iphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

let seq = 0;
function log(
  ago: number,
  action: AuditLog['action'],
  actor: User | null,
  target: User | null,
  metadata: Record<string, unknown> | null = null,
  agent = chromeWin,
): AuditLog {
  seq += 1;
  return {
    id: `a-${seq}`,
    action,
    actorId: actor?.id ?? null,
    targetType: target ? 'user' : null,
    targetId: target?.id ?? null,
    metadata,
    ip: (ipOf[agent] ??= agent === iphone ? '189.40.77.12' : '177.92.14.201'),
    userAgent: agent,
    requestId: `req-${(91_000 + seq * 37).toString(16)}`,
    createdAt: minutes(ago),
  };
}

const [mateus, beatriz, rafael, camila, thiago, juliana, lucas, , gabriel, , , aline, vinicius] =
  users;

/** Mais recentes primeiro. Cada evento bate com o estado dos usuários acima. */
export const auditLogs: AuditLog[] = [
  log(2, 'auth.login', mateus!, mateus!),
  log(38, 'user.role_changed', mateus!, rafael!, { from: 'user', to: 'manager' }),
  log(41, 'user.invitation_sent', mateus!, aline!),
  log(43, 'user.created', mateus!, aline!, { email: aline!.email, role: 'user' }),
  log(95, 'auth.login_failed', null, null, { email: 'camila.ferraz@gmail.com' }, iphone),
  log(97, 'auth.login_failed', null, null, { email: 'camila.ferraz@gmail.com' }, iphone),
  log(130, 'auth.2fa_enabled', camila!, camila!),
  log(5 * 60, 'session.revoked', thiago!, thiago!),
  log(6 * 60, 'auth.password_changed', thiago!, thiago!),
  log(9 * 60, 'user.updated', beatriz!, gabriel!, { isActive: false }),
  log(26 * 60, 'auth.login', lucas!, lucas!, null, iphone),
  log(30 * 60, 'auth.social_linked', mateus!, mateus!, { provider: 'google' }),
  log(2 * 24 * 60, 'user.data_exported', camila!, camila!),
  log(3 * 24 * 60, 'auth.refresh_token_reuse', null, thiago!),
  log(4 * 24 * 60, 'user.avatar_changed', beatriz!, beatriz!),
  log(6 * 24 * 60, 'user.self_deleted', vinicius!, vinicius!),
  log(7 * 24 * 60, 'auth.2fa_reset_by_admin', mateus!, lucas!),
  log(9 * 24 * 60, 'user.registered', juliana!, juliana!),
];
