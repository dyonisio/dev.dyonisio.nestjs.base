import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, type ApiError } from '../../api/client';
import type { components } from '../../api/schema';
import {
  Badge,
  ConfirmDialog,
  ErrorAlert,
  PageHeader,
  Section,
  SuccessAlert,
} from '../../components/ui';
import { useI18n } from '../../i18n/I18nProvider';
import { goToExternal } from '../../lib/external';
import { formatDate, formatMoney as money } from '../../lib/format';
import { useAction, useQuery } from '../../lib/hooks';

type Plan = components['schemas']['PlanDto'];
type Billing = components['schemas']['BillingDto'];
type ProviderInfo = components['schemas']['ProviderInfoDto'];

/**
 * /billing — o plano da pessoa, os planos à venda, a assinatura e o histórico.
 * O pagamento acontece na página da plataforma (Stripe, InfinitePay ou AbacatePay); na volta,
 * /billing/return confirma com ela.
 */
export function BillingPage() {
  const { m } = useI18n();
  const [params] = useSearchParams();
  const plans = useQuery(() => api.GET('/api/v1/payments/plans'), []);
  const billing = useQuery(() => api.GET('/api/v1/users/me/billing'), []);

  return (
    <>
      <PageHeader
        title={m.billing.title}
        subtitle={
          billing.data
            ? billing.data.plan === 'pro'
              ? m.billing.onPro
              : m.billing.onFree
            : undefined
        }
      />
      {params.get('canceled') && (
        <p className="alert alert-warning panel-alert">{m.billing.checkoutCanceled}</p>
      )}
      <PlansSection
        plans={plans.data?.plans ?? []}
        providers={plans.data?.providers ?? []}
        billing={billing.data}
        loading={plans.loading && !plans.data}
        error={plans.error}
      />
      {billing.data?.subscription && (
        <SubscriptionSection
          billing={billing.data}
          plans={plans.data?.plans ?? []}
          onChanged={billing.reload}
        />
      )}
      {billing.data && billing.data.payments.length > 0 && (
        <HistorySection billing={billing.data} plans={plans.data?.plans ?? []} />
      )}
    </>
  );
}

function PlansSection({
  plans,
  providers,
  billing,
  loading,
  error,
}: {
  plans: Plan[];
  providers: ProviderInfo[];
  billing: Billing | undefined;
  loading: boolean;
  error: ApiError | null;
}) {
  const { m, f, lang } = useI18n();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const { run, busy, error: actionError } = useAction();

  const owned = (plan: Plan) =>
    plan.kind === 'subscription'
      ? billing?.subscription?.planId === plan.id && billing.subscription.status !== 'canceled'
      : !!billing?.payments.some((p) => p.planId === plan.id && p.status === 'paid');

  const providerLabel = (id: string) => {
    const info = providers.find((p) => p.id === id);
    const methods = (info?.methods ?? []).map(
      (x) => m.billing.methods[x as 'card' | 'pix' | 'boleto'],
    );
    return `${methods.join(m.billing.or)} · ${m.billing.providers[id as 'stripe' | 'infinitepay' | 'abacatepay']}`;
  };

  const buy = (plan: Plan) =>
    void run(async () => {
      const provider = (choice[plan.id] ?? plan.providers[0]) as
        components['schemas']['CheckoutDto']['provider'] | undefined;
      const { data, error: apiError } = await api.POST('/api/v1/payments/checkout', {
        body: { planId: plan.id, ...(plan.providers.length > 1 ? { provider } : {}) },
      });
      if (apiError || !data) throw apiError;
      // a página de pagamento é da plataforma: sai do site e volta em /billing/return
      goToExternal(data.url);
    });

  const anyProvider = plans.some((p) => p.providers.length > 0);

  return (
    <Section title={m.billing.plans} help={m.billing.plansHelp}>
      {loading && <p className="muted">{m.common.loading}</p>}
      <ErrorAlert error={error ?? actionError} />
      {!loading && !anyProvider && <p className="muted">{m.billing.off}</p>}
      <ul className="rows">
        {plans.map((plan) => (
          <li key={plan.id}>
            <div className="row-main">
              <span className="row-title">
                {plan.name}
                {owned(plan) && <Badge tone="accent">{m.billing.yourPlan}</Badge>}
              </span>
              <span className="row-meta">
                {plan.kind === 'subscription'
                  ? f(plan.interval === 'year' ? m.billing.perYear : m.billing.perMonth, {
                      price: money(lang, plan.amount, plan.currency),
                    })
                  : f(m.billing.once, { price: money(lang, plan.amount, plan.currency) })}
                {' · '}
                {plan.description}
              </span>
            </div>
            {!owned(plan) && plan.providers.length > 0 && (
              <div className="row-actions">
                {plan.providers.length > 1 && (
                  <select
                    aria-label={f(m.billing.payWith, { plan: plan.name })}
                    value={choice[plan.id] ?? plan.providers[0]}
                    onChange={(e) => setChoice({ ...choice, [plan.id]: e.target.value })}
                  >
                    {plan.providers.map((id) => (
                      <option key={id} value={id}>
                        {providerLabel(id)}
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" className="primary" disabled={busy} onClick={() => buy(plan)}>
                  {plan.kind === 'subscription' ? m.billing.subscribe : m.billing.buy}
                </button>
              </div>
            )}
            {!owned(plan) && plan.providers.length === 0 && anyProvider && (
              <span className="muted">{m.billing.planOff}</span>
            )}
          </li>
        ))}
      </ul>
      {plans.length > 0 && plans.some((p) => p.providers.length === 1) && (
        <p className="muted step-gap">
          {f(m.billing.singleProvider, {
            provider: providerLabel(plans.find((p) => p.providers.length === 1)!.providers[0]!),
          })}
        </p>
      )}
    </Section>
  );
}

function SubscriptionSection({
  billing,
  plans,
  onChanged,
}: {
  billing: Billing;
  plans: Plan[];
  onChanged: () => void;
}) {
  const { m, f, lang } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const { run, busy, error } = useAction();
  const sub = billing.subscription!;
  const name = plans.find((p) => p.id === sub.planId)?.name ?? sub.planId;

  const cancel = () =>
    void run(async () => {
      const { error: apiError } = await api.POST('/api/v1/users/me/subscriptions/{id}/cancel', {
        params: { path: { id: sub.id } },
      });
      if (apiError) throw apiError;
      setConfirming(false);
      onChanged();
    });

  const status =
    sub.status === 'canceled'
      ? f(m.billing.canceledOn, { date: formatDate(lang, sub.canceledAt) })
      : sub.cancelAtPeriodEnd
        ? f(m.billing.endsOn, { date: formatDate(lang, sub.currentPeriodEnd) })
        : sub.currentPeriodEnd
          ? f(m.billing.renewsOn, { date: formatDate(lang, sub.currentPeriodEnd) })
          : m.billing.active;

  return (
    <Section title={m.billing.subscription} help={m.billing.subscriptionHelp}>
      <div className="status-line">
        <span className="row-main">
          <span className="row-title">
            {name}
            <Badge
              tone={
                sub.status === 'active'
                  ? 'success'
                  : sub.status === 'past_due'
                    ? 'warning'
                    : 'neutral'
              }
            >
              {m.billing.status[sub.status as 'active' | 'past_due' | 'canceled']}
            </Badge>
          </span>
          <span className="row-meta">
            {status} ·{' '}
            {m.billing.providers[sub.provider as 'stripe' | 'abacatepay' | 'infinitepay']}
          </span>
        </span>
        {sub.status !== 'canceled' && !sub.cancelAtPeriodEnd && (
          <button type="button" className="danger" onClick={() => setConfirming(true)}>
            {m.billing.cancel}
          </button>
        )}
      </div>
      {!confirming && <ErrorAlert error={error} />}
      {confirming && (
        <ConfirmDialog
          title={f(m.billing.cancelConfirm, { plan: name })}
          text={sub.provider === 'stripe' ? m.billing.cancelKeeps : m.billing.cancelNow}
          confirmLabel={m.billing.cancel}
          busy={busy}
          error={error}
          onConfirm={cancel}
          onClose={() => setConfirming(false)}
        />
      )}
    </Section>
  );
}

function HistorySection({ billing, plans }: { billing: Billing; plans: Plan[] }) {
  const { m, lang } = useI18n();
  return (
    <Section title={m.billing.history} help={m.billing.historyHelp}>
      <ul className="rows">
        {billing.payments.map((p) => (
          <li key={p.id}>
            <div className="row-main">
              <span className="row-title">
                {plans.find((x) => x.id === p.planId)?.name ?? p.planId}
                <Badge
                  tone={
                    p.status === 'paid' ? 'success' : p.status === 'pending' ? 'warning' : 'neutral'
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
                {formatDate(lang, p.paidAt ?? p.createdAt)} ·{' '}
                {m.billing.providers[p.provider as 'stripe' | 'infinitepay' | 'abacatepay']}
              </span>
            </div>
            <span className="tabular">{money(lang, p.amount, p.currency)}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------- volta do checkout

const POLL_EVERY_MS = 3000;
const POLL_TRIES = 20;

/**
 * /billing/return?payment=… — a plataforma devolve a pessoa aqui. A tela pede à API para
 * conferir com a plataforma (o webhook pode atrasar) e, se ainda estiver pendente (Pix), tenta
 * de novo por cerca de um minuto.
 */
export function BillingReturnPage() {
  const { m } = useI18n();
  const [params] = useSearchParams();
  const paymentId = params.get('payment') ?? '';
  const [status, setStatus] = useState<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const { run, error } = useAction();
  const tries = useRef(0);

  useEffect(() => {
    if (!paymentId) return;
    // tudo o que a plataforma pôs na URL vai junto (a InfinitePay precisa do transaction_nsu)
    const extra = Object.fromEntries([...params.entries()].filter(([k]) => k !== 'payment'));
    let timer: number | undefined;
    const check = () =>
      void run(async () => {
        const { data, error: apiError } = await api.POST('/api/v1/payments/{id}/confirm', {
          params: { path: { id: paymentId } },
          body: { params: extra },
        });
        if (apiError || !data) throw apiError;
        setStatus(data.status);
        if (data.status === 'pending' && ++tries.current < POLL_TRIES) {
          timer = window.setTimeout(check, POLL_EVERY_MS);
        } else if (data.status === 'pending') setGaveUp(true);
      });
    check();
    return () => window.clearTimeout(timer);
  }, [paymentId, params, run]);

  return (
    <>
      <PageHeader title={m.billing.returnTitle} />
      <Section title={m.billing.returnStatus} help={m.billing.returnHelp}>
        {!paymentId && <p className="muted">{m.billing.returnMissing}</p>}
        <ErrorAlert error={error} />
        {status === 'paid' && <SuccessAlert>{m.billing.paid}</SuccessAlert>}
        {status === 'pending' && !gaveUp && <p className="muted">{m.billing.waiting}</p>}
        {gaveUp && <p className="muted">{m.billing.stillPending}</p>}
        {status && status !== 'paid' && status !== 'pending' && (
          <p className="alert alert-warning">{m.billing.notPaid}</p>
        )}
        <div className="panel-actions">
          <Link className="button" to="/billing">
            {m.billing.back}
          </Link>
        </div>
      </Section>
    </>
  );
}
