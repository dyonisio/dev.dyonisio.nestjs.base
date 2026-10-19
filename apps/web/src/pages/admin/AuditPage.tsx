import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { useAuth } from '../../auth/AuthProvider';
import { can } from '../../auth/permissions';
import { ErrorAlert, Field, Pager, SelectField } from '../../components/ui';
import { useI18n } from '../../i18n/I18nProvider';
import { describeUserAgent, formatDateTime } from '../../lib/format';
import { useQuery } from '../../lib/hooks';

type AuditLog = components['schemas']['AuditLog'];
type AuditAction = AuditLog['action'];

/** Id curto para caber na tabela (o completo aparece ao passar o mouse). */
const shortId = (id: string) => id.slice(0, 8);

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
  const userLink = (id: string) =>
    can(me, 'users:read') ? (
      <Link to={`/admin/users/${id}`} title={id}>
        {shortId(id)}
      </Link>
    ) : (
      <span title={id}>{shortId(id)}</span>
    );
  const meta = logs.data?.meta;
  const hasFilters = action || actorId || targetId;

  return (
    <>
      <h1>{m.audit.title}</h1>

      <form className="card filters" onSubmit={applyIds} noValidate>
        <SelectField
          label={m.audit.action}
          value={action}
          onChange={(e) => update({ action: e.target.value || null })}
          options={[
            { value: '', label: m.audit.allActions },
            ...actions.map((a) => ({ value: a, label: m.auditActions[a] })),
          ]}
        />
        <Field
          label={m.audit.filterActor}
          value={ids.actorId}
          onChange={(e) => setIds({ ...ids, actorId: e.target.value })}
          onBlur={applyIds}
        />
        <Field
          label={m.audit.filterTarget}
          value={ids.targetId}
          onChange={(e) => setIds({ ...ids, targetId: e.target.value })}
          onBlur={applyIds}
        />
        {hasFilters && (
          <button
            type="button"
            className="secondary"
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

      <section className="card table-card">
        {logs.loading && !logs.data ? (
          <p className="muted">{m.common.loading}</p>
        ) : logs.data?.data.length === 0 ? (
          <p className="muted">{m.audit.empty}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{m.audit.when}</th>
                <th>{m.audit.action}</th>
                <th>{m.audit.actor}</th>
                <th>{m.audit.target}</th>
                <th>{m.audit.details}</th>
              </tr>
            </thead>
            <tbody>
              {logs.data?.data.map((log) => (
                <tr key={log.id}>
                  <td className="nowrap">{formatDateTime(lang, log.createdAt)}</td>
                  <td>{m.auditActions[log.action] ?? log.action}</td>
                  <td>{log.actorId ? userLink(log.actorId) : m.audit.anonymous}</td>
                  <td>
                    {log.targetId &&
                      (log.targetType === 'user' ? (
                        userLink(log.targetId)
                      ) : (
                        <span title={log.targetId}>
                          {log.targetType} {shortId(log.targetId)}
                        </span>
                      ))}
                  </td>
                  <td className="small">
                    <AuditDetails log={log} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
      </section>
    </>
  );
}

function AuditDetails({ log }: { log: AuditLog }) {
  const parts = [
    log.ip,
    describeUserAgent(log.userAgent),
    ...Object.entries(log.metadata ?? {}).map(
      ([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`,
    ),
  ].filter(Boolean);
  return (
    <span className="muted" title={log.requestId ?? undefined}>
      {parts.join(' · ')}
    </span>
  );
}
