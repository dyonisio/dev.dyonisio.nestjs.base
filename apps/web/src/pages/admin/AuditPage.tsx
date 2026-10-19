import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { useAuth } from '../../auth/AuthProvider';
import { can } from '../../auth/permissions';
import { Badge, ErrorAlert, PageHeader, Pager } from '../../components/ui';
import { useI18n } from '../../i18n/I18nProvider';
import { describeUserAgent, formatDate, formatTime } from '../../lib/format';
import { useQuery } from '../../lib/hooks';

type AuditLog = components['schemas']['AuditLog'];
type AuditAction = AuditLog['action'];

/** Id curto para caber na tabela (o completo aparece ao passar o mouse). */
const shortId = (id: string) => id.slice(0, 8);

/** Eventos que são alarme de segurança: os únicos com cor na tabela. */
const ALARMS: AuditAction[] = ['auth.login_failed', 'auth.refresh_token_reuse', 'auth.2fa_failed'];

/**
 * /admin/audit — trilha de auditoria (permissão `audit:read`), filtrável por ação, por quem fez
 * e pelo alvo. Os filtros ficam na URL (o detalhe do usuário linka para cá com ?targetId=).
 */
export function AuditPage() {
  const { m, f, lang } = useI18n();
  const { user: me } = useAuth();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1) || 1;
  const action = (params.get('action') ?? '') as AuditAction | '';
  const actorId = params.get('actorId') ?? '';
  const targetId = params.get('targetId') ?? '';
  const [ids, setIds] = useState({ actorId, targetId });

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const logs = useQuery(
    () =>
      api.GET('/api/v1/audit-logs', {
        params: {
          query: {
            page,
            limit: 50,
            ...(action ? { action } : {}),
            ...(actorId ? { actorId } : {}),
            ...(targetId ? { targetId } : {}),
          },
        },
      }),
    [page, action, actorId, targetId],
  );

  const applyIds = (e: FormEvent) => {
    e.preventDefault();
    update({ actorId: ids.actorId.trim() || null, targetId: ids.targetId.trim() || null });
  };

  const actions = Object.keys(m.auditActions) as AuditAction[];
  // Com users:read, troca o id pelo nome (uma busca só, das primeiras 100 contas)
  const people = useQuery(
    () =>
      can(me, 'users:read')
        ? api.GET('/api/v1/users', { params: { query: { limit: 100 } } })
        : Promise.resolve({ data: undefined }),
    [],
  );
  const names = new Map((people.data?.data ?? []).map((u) => [u.id, u.name]));
  const userLink = (id: string) => {
    const name = names.get(id);
    const label = name ?? <span className="mono">{shortId(id)}</span>;
    return can(me, 'users:read') ? (
      <Link to={`/admin/users/${id}`} title={id}>
        {label}
      </Link>
    ) : (
      <span title={id}>{label}</span>
    );
  };
  const meta = logs.data?.meta;
  const hasFilters = action || actorId || targetId;

  return (
    <>
      <PageHeader
        title={m.audit.title}
        subtitle={meta ? f(m.audit.subtitle, { n: String(meta.total) }) : m.common.loading}
      />

      <form className="toolbar" onSubmit={applyIds} noValidate>
        <div className="toolbar-group">
          <select
            aria-label={m.audit.action}
            value={action}
            onChange={(e) => update({ action: e.target.value || null })}
          >
            <option value="">{m.audit.allActions}</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {m.auditActions[a]}
              </option>
            ))}
          </select>
          <input
            className="mono id-filter"
            aria-label={m.audit.filterActor}
            placeholder={m.audit.filterActor}
            value={ids.actorId}
            onChange={(e) => setIds({ ...ids, actorId: e.target.value })}
            onBlur={applyIds}
          />
          <input
            className="mono id-filter"
            aria-label={m.audit.filterTarget}
            placeholder={m.audit.filterTarget}
            value={ids.targetId}
            onChange={(e) => setIds({ ...ids, targetId: e.target.value })}
            onBlur={applyIds}
          />
        </div>
        {hasFilters && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setIds({ actorId: '', targetId: '' });
              update({ action: null, actorId: null, targetId: null });
            }}
          >
            {m.audit.clear}
          </button>
        )}
      </form>

      <ErrorAlert error={logs.error} />

      {logs.loading && !logs.data ? (
        <p className="loading-line">{m.common.loading}</p>
      ) : logs.data?.data.length === 0 ? (
        <p className="empty">{m.audit.empty}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{m.audit.action}</th>
                <th className="hide-sm">{m.audit.actor}</th>
                <th className="hide-sm">{m.audit.target}</th>
                <th className="hide-sm">{m.audit.origin}</th>
                <th className="num">{m.audit.when}</th>
              </tr>
            </thead>
            <tbody>
              {logs.data?.data.map((log) => (
                <tr key={log.id}>
                  <td>
                    <span className="row-title">
                      {m.auditActions[log.action] ?? log.action}
                      {ALARMS.includes(log.action) && <Badge tone="danger">{m.audit.alarm}</Badge>}
                    </span>
                    <AuditDetails log={log} />
                  </td>
                  <td className="hide-sm">
                    {log.actorId ? (
                      userLink(log.actorId)
                    ) : (
                      <span className="muted">{m.audit.anonymous}</span>
                    )}
                  </td>
                  <td className="hide-sm">
                    {log.targetId ? (
                      log.targetType === 'user' ? (
                        userLink(log.targetId)
                      ) : (
                        <span className="mono" title={log.targetId}>
                          {log.targetType} {shortId(log.targetId)}
                        </span>
                      )
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="hide-sm">
                    <span className="mono">{log.ip ?? '—'}</span>
                    <span className="cell-sub">{describeUserAgent(log.userAgent) ?? ''}</span>
                  </td>
                  <td className="num nowrap">
                    {formatDate(lang, log.createdAt)}
                    <span className="cell-sub">{formatTime(lang, log.createdAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {meta && meta.totalPages > 1 && (
        <Pager
          page={meta.page}
          totalPages={meta.totalPages}
          label={f(m.audit.page, {
            page: String(meta.page),
            pages: String(meta.totalPages),
            total: String(meta.total),
          })}
          onPage={(p) => update({ page: p > 1 ? String(p) : null })}
        />
      )}
    </>
  );
}

/** Os detalhes que importam do evento, numa linha cinza (nunca senhas ou tokens: a API não grava). */
function AuditDetails({ log }: { log: AuditLog }) {
  const parts = Object.entries(log.metadata ?? {}).map(
    ([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`,
  );
  if (!parts.length) return null;
  return (
    <span className="cell-sub" title={log.requestId ?? undefined}>
      {parts.join(' · ')}
    </span>
  );
}
