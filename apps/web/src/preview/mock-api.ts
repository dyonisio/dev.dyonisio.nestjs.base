/**
 * API falsa da pré-visualização: responde no próprio navegador, a partir de data.ts.
 * Cobre as leituras das telas e responde "ok" às ações (sem gravar nada de verdade, exceto em memória).
 */
import type { User } from '../auth/session';
import {
  adminPlans,
  auditLogs,
  billing,
  identities,
  passkeys,
  plans,
  sessions,
  users,
} from './data';

const json = (status: number, body: unknown) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const notFound = () => json(404, { statusCode: 404, code: 'users.notFound', message: 'Not found' });

function paginate<T>(rows: T[], page: number, limit: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / limit));
  return {
    data: rows.slice((page - 1) * limit, page * limit),
    meta: { page, limit, total: rows.length, totalPages },
  };
}

export function installMockApi(me: User) {
  let current = { ...me };
  let uploaded: string | null = null;
  const list = users.map((u) => (u.id === me.id ? current : u));

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const q = url.searchParams;
    const isJson = req.headers.get('content-type')?.includes('application/json');
    const body =
      isJson && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)
        ? await req
            .clone()
            .json()
            .catch(() => ({}))
        : {};
    await new Promise((r) => setTimeout(r, 120)); // um pouco de rede, para ver os estados

    const route = `${req.method} ${path}`;
    if (route === 'POST /auth/refresh') {
      return json(200, { accessToken: 'preview', refreshToken: 'preview', user: current });
    }
    if (route === 'GET /users/me') return json(200, current);
    if (route === 'PATCH /users/me') {
      current = { ...current, ...body };
      return json(200, current);
    }
    if (route === 'GET /users/me/identities') return json(200, identities);

    // Upload da foto: pedido → "bucket" falso → confirmação → avatar (fica só no navegador)
    if (route === 'POST /files') {
      return json(201, {
        file: { id: 'preview-file', status: 'pending' },
        upload: { url: `${location.origin}/mock-bucket/`, method: 'POST', fields: {} },
      });
    }
    if (req.method === 'POST' && url.pathname === '/mock-bucket/') {
      const file = (await req.formData()).get('file');
      if (file instanceof Blob) uploaded = URL.createObjectURL(file);
      return new Response(null, { status: 204 });
    }
    if (route === 'POST /files/preview-file/complete') return json(200, { id: 'preview-file' });
    if (route === 'PUT /users/me/avatar') {
      current = { ...current, avatarUrl: uploaded };
      return json(200, current);
    }
    if (route === 'DELETE /users/me/avatar') {
      current = { ...current, avatarUrl: null };
      return json(200, current);
    }
    if (route === 'GET /users/me/sessions') return json(200, sessions);
    if (route === 'GET /users/me/passkeys') return json(200, passkeys);
    if (route === 'GET /payments/plans') return json(200, plans);
    if (route === 'GET /users/me/billing') return json(200, billing);
    if (route === 'GET /admin/plans') return json(200, adminPlans);
    // Formas de login de outro usuário (admin)
    if (req.method === 'GET' && /^\/users\/[^/]+\/login-methods$/.test(path)) {
      return json(200, { ...identities, passkeys });
    }
    // Sessões de outro usuário (admin): as mesmas do exemplo, sem a "deste dispositivo"
    if (req.method === 'GET' && /^\/users\/[^/]+\/sessions$/.test(path)) {
      return json(
        200,
        sessions.map((s) => ({ ...s, current: false })),
      );
    }

    if (route === 'GET /users') {
      const deleted = q.get('deleted') === 'true';
      const search = (q.get('search') ?? '').toLowerCase();
      const role = q.get('role');
      const sortBy = (q.get('sortBy') ?? 'createdAt') as 'createdAt' | 'name' | 'email';
      const order = q.get('order') === 'asc' ? 1 : -1;
      const rows = list
        .filter((u) => !!u.deletedAt === deleted)
        .filter((u) => !role || u.role === role)
        .filter((u) => !search || u.name.toLowerCase().includes(search) || u.email.includes(search))
        .sort((a, b) => (a[sortBy] < b[sortBy] ? -order : a[sortBy] > b[sortBy] ? order : 0));
      return json(200, paginate(rows, Number(q.get('page') ?? 1), Number(q.get('limit') ?? 20)));
    }
    const one = path.match(/^\/users\/([^/]+)$/);
    if (one && req.method === 'GET') {
      const u = list.find((x) => x.id === one[1] && !x.deletedAt);
      return u ? json(200, u) : notFound();
    }
    if (one && req.method === 'PATCH') {
      const u = list.find((x) => x.id === one[1]);
      if (!u) return notFound();
      // como a API: o e-mail novo fica pendente até ser confirmado pelo link
      const { email, ...rest } = body as { email?: string };
      Object.assign(u, rest, email && email !== u.email ? { pendingEmail: email } : {});
      return json(200, u);
    }
    const role = path.match(/^\/users\/([^/]+)\/role$/);
    if (role) {
      const u = list.find((x) => x.id === role[1]);
      return u ? json(200, Object.assign(u, { role: body.role })) : notFound();
    }

    if (route === 'GET /audit-logs') {
      const rows = auditLogs
        .filter((l) => !q.get('action') || l.action === q.get('action'))
        .filter((l) => !q.get('actorId') || l.actorId === q.get('actorId'))
        .filter((l) => !q.get('targetId') || l.targetId === q.get('targetId'));
      return json(200, paginate(rows, Number(q.get('page') ?? 1), Number(q.get('limit') ?? 50)));
    }

    // Demais ações: sucesso sem corpo
    return json(req.method === 'GET' ? 404 : 204, null);
  };
}
