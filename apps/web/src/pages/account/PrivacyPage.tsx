import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { session } from '../../auth/session';
import { emptyReauth, reauthBody, ReauthFields, useLoginMethods } from '../../components/Reauth';
import { Checkbox, ErrorAlert, FormError, PageHeader, Section } from '../../components/ui';
import { useI18n } from '../../i18n/I18nProvider';
import { flash } from '../../lib/flash';
import { downloadJson } from '../../lib/format';
import { useAction } from '../../lib/hooks';

/** /account/privacy — direitos da LGPD: baixar os dados e excluir a conta. */
export function PrivacyPage() {
  const { m } = useI18n();
  return (
    <>
      <PageHeader title={m.privacy.title} subtitle={m.privacy.subtitle} />
      <ExportSection />
      <DeleteSection />
    </>
  );
}

function ExportSection() {
  const { m } = useI18n();
  const { run, busy, error } = useAction();

  const exportData = () =>
    void run(async () => {
      const { data, error: apiError } = await api.GET('/api/v1/users/me/export');
      if (apiError || !data) throw apiError;
      downloadJson(`my-data-${new Date().toISOString().slice(0, 10)}.json`, data);
    });

  return (
    <Section title={m.privacy.exportTitle} help={m.privacy.exportHelp}>
      <p className="muted">{m.privacy.exportDetail}</p>
      <ErrorAlert error={error} />
      <div className="panel-actions">
        <button type="button" disabled={busy} onClick={exportData}>
          {m.privacy.export}
        </button>
      </div>
    </Section>
  );
}

function DeleteSection() {
  const { m } = useI18n();
  const methods = useLoginMethods();
  const [reauth, setReauth] = useState(emptyReauth);
  const [confirmed, setConfirmed] = useState(false);
  const { run, busy, error } = useAction();

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const { error: apiError } = await api.DELETE('/api/v1/users/me', {
        body: reauthBody(reauth),
      });
      if (apiError) throw apiError;
      // A API já encerrou todas as sessões; limpar a local leva ao login, que mostra o aviso
      flash.set('accountDeleted');
      session.clear();
    });
  }

  return (
    <Section title={m.privacy.deleteTitle} help={m.privacy.deleteHelp} danger>
      <form onSubmit={submit} noValidate>
        <ReauthFields
          value={reauth}
          onChange={setReauth}
          error={error}
          hasPassword={methods.data?.hasPassword ?? true}
        />
        <Checkbox
          label={m.privacy.deleteConfirm}
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <FormError error={error} />
        <div className="panel-actions">
          <button type="submit" className="danger" disabled={busy || !confirmed}>
            {m.privacy.delete}
          </button>
        </div>
      </form>
    </Section>
  );
}
