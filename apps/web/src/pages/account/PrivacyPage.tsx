import { useState } from 'react';
import { api } from '../../api/client';
import { session } from '../../auth/session';
import { ReauthDialog, type ReauthProof } from '../../components/Reauth';
import { ErrorAlert, PageHeader, Section } from '../../components/ui';
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
      <div className="status-line">
        <span>{m.privacy.exportDetail}</span>
        <button type="button" disabled={busy} onClick={exportData}>
          {m.privacy.export}
        </button>
      </div>
      <ErrorAlert error={error} />
    </Section>
  );
}

function DeleteSection() {
  const { m } = useI18n();
  const [confirming, setConfirming] = useState(false);

  const remove = async (proof: ReauthProof) => {
    const { error: apiError } = await api.DELETE('/api/v1/users/me', { body: proof });
    if (apiError) throw apiError;
    // A API já encerrou todas as sessões; limpar a local leva ao login, que mostra o aviso
    flash.set('accountDeleted');
    session.clear();
  };

  return (
    <Section title={m.privacy.deleteTitle} help={m.privacy.deleteHelp} danger>
      <div className="status-line">
        <span>{m.privacy.deleteShort}</span>
        <button type="button" className="danger" onClick={() => setConfirming(true)}>
          {m.privacy.delete}
        </button>
      </div>
      {confirming && (
        <ReauthDialog
          title={m.privacy.deleteDialogTitle}
          text={m.privacy.deleteHelp}
          confirmLabel={m.privacy.delete}
          danger
          onConfirm={remove}
          onClose={() => setConfirming(false)}
        />
      )}
    </Section>
  );
}
