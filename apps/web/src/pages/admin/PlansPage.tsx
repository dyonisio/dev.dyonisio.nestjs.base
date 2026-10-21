import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { components } from '../../api/schema';
import {
  Badge,
  Checkbox,
  ErrorAlert,
  Field,
  fieldError,
  FormError,
  Modal,
  PageHeader,
  Section,
  SelectField,
} from '../../components/ui';
import { useI18n } from '../../i18n/I18nProvider';
import type { Language } from '../../i18n/language';
import { formatMoney } from '../../lib/format';
import { useAction, useQuery } from '../../lib/hooks';

type Plan = components['schemas']['AdminPlanDto'];

/** "29,90", "29.90" ou "1.299,90" → centavos. Inválido: NaN. */
export function parseCents(text: string): number {
  const clean = text.replace(/[^\d.,]/g, '');
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return NaN;
  return Math.round(Number(normalized) * 100);
}

const centsText = (lang: Language, cents: number) => {
  const text = (cents / 100).toFixed(2);
  return lang === 'pt-BR' ? text.replace('.', ',') : text;
};

/**
 * /admin/plans — o que está à venda em /billing: preço, nomes, ordem, à venda ou não
 * (permissão `plans:manage`). Preço novo vale para as próximas compras.
 */
export function PlansPage() {
  const { m, f, lang } = useI18n();
  const plans = useQuery(() => api.GET('/api/v1/admin/plans'), []);
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);

  const price = (p: Plan) =>
    p.kind === 'subscription'
      ? f(p.interval === 'year' ? m.adminPlans.perYear : m.billing.perMonth, {
          price: formatMoney(lang, p.amount, p.currency),
        })
      : f(m.billing.once, { price: formatMoney(lang, p.amount, p.currency) });

  return (
    <>
      <PageHeader
        title={m.adminPlans.title}
        subtitle={m.adminPlans.subtitle}
        actions={
          <button type="button" className="primary" onClick={() => setEditing('new')}>
            {m.adminPlans.new}
          </button>
        }
      />
      <Section title={m.adminPlans.list} help={m.adminPlans.listHelp}>
        {plans.loading && !plans.data && <p className="muted">{m.common.loading}</p>}
        <ErrorAlert error={plans.error} />
        <ul className="rows">
          {(plans.data ?? []).map((p) => (
            <li key={p.id}>
              <div className="row-main">
                <span className="row-title">
                  {lang === 'pt-BR' ? p.namePt : p.nameEn}
                  {!p.active && <Badge>{m.adminPlans.offSale}</Badge>}
                </span>
                <span className="row-meta">
                  {price(p)} · <span className="mono">{p.id}</span>
                </span>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  aria-label={f(m.adminPlans.editPlan, { plan: p.id })}
                  onClick={() => setEditing(p)}
                >
                  {m.adminPlans.edit}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </Section>
      {editing && (
        <PlanForm
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            plans.reload();
          }}
        />
      )}
    </>
  );
}

function PlanForm({
  plan,
  onClose,
  onSaved,
}: {
  plan: Plan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { m, lang } = useI18n();
  const { run, busy, error } = useAction();
  const [form, setForm] = useState({
    id: plan?.id ?? '',
    kind: (plan?.kind ?? 'one_time') as 'one_time' | 'subscription',
    interval: (plan?.interval ?? 'month') as 'month' | 'year',
    price: plan ? centsText(lang, plan.amount) : '',
    namePt: plan?.namePt ?? '',
    nameEn: plan?.nameEn ?? '',
    descriptionPt: plan?.descriptionPt ?? '',
    descriptionEn: plan?.descriptionEn ?? '',
    sortOrder: String(plan?.sortOrder ?? 0),
    active: plan?.active ?? true,
  });
  const set = (changes: Partial<typeof form>) => setForm({ ...form, ...changes });
  const amount = parseCents(form.price);
  const priceChanged = !!plan && amount !== plan.amount;

  function submit(e: FormEvent) {
    e.preventDefault();
    const common = {
      amount,
      namePt: form.namePt,
      nameEn: form.nameEn,
      descriptionPt: form.descriptionPt,
      descriptionEn: form.descriptionEn,
      sortOrder: Number(form.sortOrder) || 0,
      active: form.active,
    };
    void run(async () => {
      const { error: apiError } = plan
        ? await api.PATCH('/api/v1/admin/plans/{id}', {
            params: { path: { id: plan.id } },
            body: common,
          })
        : await api.POST('/api/v1/admin/plans', {
            body: {
              ...common,
              id: form.id.trim(),
              kind: form.kind,
              ...(form.kind === 'subscription' ? { interval: form.interval } : {}),
            },
          });
      if (apiError) throw apiError;
      onSaved();
    });
  }

  return (
    <Modal title={plan ? m.adminPlans.editTitle : m.adminPlans.newTitle} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        {!plan && (
          <>
            <Field
              label={m.adminPlans.id}
              hint={m.adminPlans.idHint}
              value={form.id}
              onChange={(e) => set({ id: e.target.value })}
              error={fieldError(error, 'id')}
              required
            />
            <SelectField
              label={m.adminPlans.kind}
              value={form.kind}
              onChange={(e) => set({ kind: e.target.value as typeof form.kind })}
              options={[
                { value: 'one_time', label: m.adminPlans.oneTime },
                { value: 'subscription', label: m.adminPlans.subscription },
              ]}
            />
            {form.kind === 'subscription' && (
              <SelectField
                label={m.adminPlans.interval}
                value={form.interval}
                onChange={(e) => set({ interval: e.target.value as typeof form.interval })}
                options={[
                  { value: 'month', label: m.adminPlans.monthly },
                  { value: 'year', label: m.adminPlans.yearly },
                ]}
              />
            )}
          </>
        )}
        <Field
          label={m.adminPlans.price}
          inputMode="decimal"
          placeholder={lang === 'pt-BR' ? '29,90' : '29.90'}
          value={form.price}
          onChange={(e) => set({ price: e.target.value })}
          hint={priceChanged ? m.adminPlans.priceHint : undefined}
          error={
            form.price && Number.isNaN(amount)
              ? m.adminPlans.priceInvalid
              : fieldError(error, 'amount')
          }
          required
        />
        <Field
          label={m.adminPlans.namePt}
          value={form.namePt}
          onChange={(e) => set({ namePt: e.target.value })}
          error={fieldError(error, 'namePt')}
          required
        />
        <Field
          label={m.adminPlans.nameEn}
          value={form.nameEn}
          onChange={(e) => set({ nameEn: e.target.value })}
          error={fieldError(error, 'nameEn')}
          required
        />
        <Field
          label={m.adminPlans.descriptionPt}
          value={form.descriptionPt}
          onChange={(e) => set({ descriptionPt: e.target.value })}
          error={fieldError(error, 'descriptionPt')}
        />
        <Field
          label={m.adminPlans.descriptionEn}
          value={form.descriptionEn}
          onChange={(e) => set({ descriptionEn: e.target.value })}
          error={fieldError(error, 'descriptionEn')}
        />
        <Field
          label={m.adminPlans.order}
          type="number"
          min={0}
          value={form.sortOrder}
          onChange={(e) => set({ sortOrder: e.target.value })}
          error={fieldError(error, 'sortOrder')}
        />
        <Checkbox
          label={m.adminPlans.onSale}
          checked={form.active}
          onChange={(e) => set({ active: e.target.checked })}
        />
        <FormError error={error} />
        <div className="panel-actions">
          <button type="button" onClick={onClose}>
            {m.common.cancel}
          </button>
          <button
            type="submit"
            className="primary"
            disabled={
              busy ||
              Number.isNaN(amount) ||
              !form.namePt.trim() ||
              !form.nameEn.trim() ||
              (!plan && !form.id.trim())
            }
          >
            {m.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
