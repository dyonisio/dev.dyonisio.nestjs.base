import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { components } from '../../api/schema';
import type { User } from '../../auth/session';
import {
  Badge,
  ErrorAlert,
  Field,
  fieldError,
  FormError,
  Modal,
  Section,
  SelectField,
  SuccessAlert,
} from '../../components/ui';
import { useI18n } from '../../i18n/I18nProvider';
import { formatDate, formatMoney } from '../../lib/format';
import { useAction, useQuery } from '../../lib/hooks';

type Billing = components['schemas']['AdminBillingDto'];
type Payment = components['schemas']['AdminPaymentDto'];
type CancelMode = components['schemas']['AdminCancelSubscriptionDto']['mode'];
type Provider = 'stripe' | 'infinitepay' | 'abacatepay';

type Dialog =
  | { kind: 'cancel' }
  | { kind: 'refund'; payment: Payment }
  | { kind: 'grant' }
  | { kind: 'revoke' }
  | null;

const GRANT_MONTHS = ['1', '2', '3', '6', '12'];

/**
 * O plano do usuário, pelo admin (permissão billing:manage): cancelar a assinatura (com ou sem
 * reembolso, conforme a plataforma), reembolsar uma compra e dar Pro de cortesia.
 */
export function UserBillingSection({ user }: { user: User }) {
  const { m, f, lang } = useI18n();
  const id = user.id;
  const query = useQuery(
    () => api.GET('/api/v1/users/{id}/billing', { params: { path: { id } } }),
    [id],
  );
  const plans = useQuery(() => api.GET('/api/v1/payments/plans'), []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const data = query.data;

  const planName = (planId: string) =>
    plans.data?.plans.find((p) => p.id === planId)?.name ?? planId;
  const providerName = (p: string) => m.billing.providers[p as Provider] ?? p;
  const open = (next: Dialog) => {
    setNotice(null);
    setDialog(next);
  };
  const done = (next: Billing, message: string) => {
    query.setData(next);
    setDialog(null);
    setNotice(message);
  };

  const sub = data?.subscription;
  const subscribed = !!sub && sub.status !== 'canceled';
  const summary = !data
    ? null
    : data.lifetime
      ? m.adminBilling.lifetime
      : subscribed
        ? f(m.adminBilling.subscribed, { plan: planName(sub.planId) })
        : data.grant
          ? f(m.adminBilling.courtesyUntil, { date: formatDate(lang, data.grant.endsAt) })
          : m.adminBilling.free;

  return (
    <Section title={m.adminBilling.title} help={m.adminBilling.help}>
      {query.loading && !data && <p className="muted">{m.common.loading}</p>}
      {!dialog && <ErrorAlert error={query.error} />}
      {data && (
        <>
          <p className="status-line">
            <span className="row-title">
              {summary}
              <Badge tone={data.plan === 'pro' ? 'accent' : 'neutral'}>
                {data.plan === 'pro' ? 'Pro' : m.adminBilling.freeBadge}
              </Badge>
            </span>
          </p>
          <ul className="rows">
            {data.grant && (
              <li>
                <div className="row-main">
                  <span className="row-title">
                    {f(m.adminBilling.courtesyUntil, {
                      date: formatDate(lang, data.grant.endsAt),
                    })}
                  </span>
                  <span className="row-meta">{data.grant.reason}</span>
                </div>
                <div className="row-actions">
                  <button type="button" onClick={() => open({ kind: 'grant' })}>
                    {m.adminBilling.extend}
                  </button>
                  <button type="button" className="danger" onClick={() => open({ kind: 'revoke' })}>
                    {m.adminBilling.revoke}
                  </button>
                </div>
              </li>
            )}
            {sub && (
              <li>
                <div className="row-main">
                  <span className="row-title">
                    {planName(sub.planId)}
                    <Badge tone={sub.status === 'active' ? 'success' : 'neutral'}>
                      {m.billing.status[sub.status as 'active' | 'past_due' | 'canceled']}
                    </Badge>
                  </span>
                  <span className="row-meta">
                    {sub.status === 'canceled'
                      ? f(m.billing.canceledOn, { date: formatDate(lang, sub.canceledAt) })
                      : sub.cancelAtPeriodEnd
                        ? f(m.billing.endsOn, { date: formatDate(lang, sub.currentPeriodEnd) })
                        : sub.currentPeriodEnd
                          ? f(m.billing.renewsOn, { date: formatDate(lang, sub.currentPeriodEnd) })
                          : m.billing.active}
                    {' · '}
                    {providerName(sub.provider)}
                  </span>
                </div>
                {sub.cancelOptions.length > 0 && (
                  <button type="button" className="danger" onClick={() => open({ kind: 'cancel' })}>
                    {m.billing.cancel}
                  </button>
                )}
              </li>
            )}
            {data.payments.map((p) => (
              <li key={p.id}>
                <div className="row-main">
                  <span className="row-title">
                    {planName(p.planId)}
                    <Badge
                      tone={
                        p.status === 'paid'
                          ? 'success'
                          : p.status === 'pending'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {
                        m.billing.paymentStatus[
                          p.status as 'paid' | 'pending' | 'failed' | 'canceled' | 'refunded'
                        ]
                      }
                    </Badge>
                  </span>
                  <span className="row-meta">
                    {formatDate(lang, p.paidAt ?? p.createdAt)} · {providerName(p.provider)} ·{' '}
                    <span className="tabular">{formatMoney(lang, p.amount, p.currency)}</span>
                  </span>
                </div>
                {p.refund && (
                  <button type="button" onClick={() => open({ kind: 'refund', payment: p })}>
                    {p.refund === 'api' ? m.adminBilling.refund : m.adminBilling.recordRefund}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {data.payments.length === 0 && !sub && !data.grant && (
            <p className="muted">{m.adminBilling.nothing}</p>
          )}
          {notice && <SuccessAlert>{notice}</SuccessAlert>}
          {!data.grant && !data.lifetime && !subscribed && (
            <div className="panel-actions">
              <button type="button" onClick={() => open({ kind: 'grant' })}>
                {m.adminBilling.giveCourtesy}
              </button>
            </div>
          )}
        </>
      )}

      {data && dialog?.kind === 'cancel' && sub && (
        <CancelDialog
          billing={data}
          userId={id}
          planName={planName(sub.planId)}
          provider={providerName(sub.provider)}
          onClose={() => setDialog(null)}
          onDone={(next) => done(next, m.adminBilling.canceled)}
        />
      )}
      {dialog?.kind === 'refund' && (
        <RefundDialog
          payment={dialog.payment}
          userId={id}
          provider={providerName(dialog.payment.provider)}
          onClose={() => setDialog(null)}
          onDone={(next) => done(next, m.adminBilling.refunded)}
        />
      )}
      {dialog?.kind === 'grant' && (
        <GrantDialog
          userId={id}
          extending={!!data?.grant}
          onClose={() => setDialog(null)}
          onDone={(next) => done(next, m.adminBilling.courtesyGiven)}
        />
      )}
      {dialog?.kind === 'revoke' && (
        <RevokeDialog
          userId={id}
          name={user.name}
          onClose={() => setDialog(null)}
          onDone={(next) => done(next, m.adminBilling.courtesyRevoked)}
        />
      )}
    </Section>
  );
}

function CancelDialog({
  billing,
  userId,
  planName,
  provider,
  onClose,
  onDone,
}: {
  billing: Billing;
  userId: string;
  planName: string;
  provider: string;
  onClose: () => void;
  onDone: (next: Billing) => void;
}) {
  const { m, f, lang } = useI18n();
  const sub = billing.subscription!;
  const options = sub.cancelOptions;
  const [mode, setMode] = useState<CancelMode>(options[0]!);
  const { run, busy, error } = useAction();
  const labels: Record<CancelMode, string> = {
    period_end: f(m.adminBilling.atPeriodEnd, {
      date: formatDate(lang, sub.currentPeriodEnd),
    }),
    now: m.adminBilling.now,
    now_refund: m.adminBilling.nowRefund,
  };

  const confirm = () =>
    void run(async () => {
      const { data, error: apiError } = await api.POST(
        '/api/v1/users/{id}/subscriptions/{subscriptionId}/cancel',
        { params: { path: { id: userId, subscriptionId: sub.id } }, body: { mode } },
      );
      if (apiError || !data) throw apiError;
      onDone(data);
    });

  return (
    <Modal title={f(m.billing.cancelConfirm, { plan: planName })} onClose={onClose}>
      <fieldset className="choices">
        <legend className="muted">{m.adminBilling.how}</legend>
        {options.map((option) => (
          <label key={option} className="checkbox">
            <input
              type="radio"
              name="cancel-mode"
              value={option}
              checked={mode === option}
              onChange={() => setMode(option)}
            />
            <span>{labels[option]}</span>
          </label>
        ))}
      </fieldset>
      {!options.includes('now_refund') && (
        <p className="muted">{f(m.adminBilling.noSubscriptionRefund, { provider })}</p>
      )}
      <ErrorAlert error={error} />
      <div className="panel-actions">
        <button type="button" onClick={onClose}>
          {m.common.cancel}
        </button>
        <button type="button" className="danger" disabled={busy} onClick={confirm}>
          {m.billing.cancel}
        </button>
      </div>
    </Modal>
  );
}

function RefundDialog({
  payment,
  userId,
  provider,
  onClose,
  onDone,
}: {
  payment: Payment;
  userId: string;
  provider: string;
  onClose: () => void;
  onDone: (next: Billing) => void;
}) {
  const { m, f, lang } = useI18n();
  const [reason, setReason] = useState('');
  const { run, busy, error } = useAction();
  const amount = formatMoney(lang, payment.amount, payment.currency);
  const viaApi = payment.refund === 'api';

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const { data, error: apiError } = await api.POST(
        '/api/v1/users/{id}/payments/{paymentId}/refund',
        {
          params: { path: { id: userId, paymentId: payment.id } },
          body: reason.trim() ? { reason: reason.trim() } : {},
        },
      );
      if (apiError || !data) throw apiError;
      onDone(data);
    });
  }

  return (
    <Modal
      title={viaApi ? f(m.adminBilling.refundTitle, { amount }) : m.adminBilling.recordRefund}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <p className="muted">
          {viaApi
            ? f(m.adminBilling.refundText, { amount, provider })
            : f(m.adminBilling.recordRefundText, { amount, provider })}
        </p>
        {viaApi && (
          <Field
            label={m.adminBilling.reason}
            hint={m.adminBilling.reasonHint}
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            error={fieldError(error, 'reason')}
          />
        )}
        <FormError error={error} />
        <div className="panel-actions">
          <button type="button" onClick={onClose}>
            {m.common.cancel}
          </button>
          <button type="submit" className="danger" disabled={busy}>
            {viaApi ? m.adminBilling.refund : m.adminBilling.recordRefund}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function GrantDialog({
  userId,
  extending,
  onClose,
  onDone,
}: {
  userId: string;
  extending: boolean;
  onClose: () => void;
  onDone: (next: Billing) => void;
}) {
  const { m, f } = useI18n();
  const [months, setMonths] = useState('1');
  const [reason, setReason] = useState('');
  const { run, busy, error } = useAction();

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const { data, error: apiError } = await api.POST('/api/v1/users/{id}/grant', {
        params: { path: { id: userId } },
        body: { months: Number(months), reason: reason.trim() },
      });
      if (apiError || !data) throw apiError;
      onDone(data);
    });
  }

  return (
    <Modal
      title={extending ? m.adminBilling.extendTitle : m.adminBilling.giveCourtesy}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <p className="muted">
          {extending ? m.adminBilling.extendText : m.adminBilling.courtesyText}
        </p>
        <SelectField
          label={m.adminBilling.months}
          value={months}
          onChange={(e) => setMonths(e.target.value)}
          options={GRANT_MONTHS.map((n) => ({
            value: n,
            label: f(n === '1' ? m.adminBilling.oneMonth : m.adminBilling.nMonths, { n }),
          }))}
        />
        <Field
          label={m.adminBilling.reason}
          hint={m.adminBilling.courtesyReasonHint}
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
          error={fieldError(error, 'reason')}
          required
        />
        <FormError error={error} />
        <div className="panel-actions">
          <button type="button" onClick={onClose}>
            {m.common.cancel}
          </button>
          <button type="submit" className="primary" disabled={busy || !reason.trim()}>
            {extending ? m.adminBilling.extend : m.adminBilling.give}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RevokeDialog({
  userId,
  name,
  onClose,
  onDone,
}: {
  userId: string;
  name: string;
  onClose: () => void;
  onDone: (next: Billing) => void;
}) {
  const { m, f } = useI18n();
  const { run, busy, error } = useAction();
  const revoke = () =>
    void run(async () => {
      const { data, error: apiError } = await api.DELETE('/api/v1/users/{id}/grant', {
        params: { path: { id: userId } },
      });
      if (apiError || !data) throw apiError;
      onDone(data);
    });

  return (
    <Modal title={f(m.adminBilling.revokeTitle, { name })} onClose={onClose}>
      <p className="muted">{m.adminBilling.revokeText}</p>
      <ErrorAlert error={error} />
      <div className="panel-actions">
        <button type="button" onClick={onClose}>
          {m.common.cancel}
        </button>
        <button type="button" className="danger" disabled={busy} onClick={revoke}>
          {m.adminBilling.revoke}
        </button>
      </div>
    </Modal>
  );
}
