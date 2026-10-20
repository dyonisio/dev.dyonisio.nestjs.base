import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { ProductMark } from '../components/Icon';
import { LegalLinks, Preferences } from '../components/ui';
import { APP_NAME, LEGAL_OWNER, SUPPORT_EMAIL } from '../config';
import { useI18n } from '../i18n/I18nProvider';
import { LEGAL, LEGAL_UPDATED_AT, type Block } from '../legal/content';
import { formatDate } from '../lib/format';

/** Troca {appName}, {owner}, {site} e {email} (este vira um link mailto). */
function fill(text: string): ReactNode {
  const parts = text
    .replaceAll('{appName}', APP_NAME)
    .replaceAll('{owner}', LEGAL_OWNER)
    .replaceAll('{site}', window.location.host)
    .split('{email}');
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>}
      {part}
    </Fragment>
  ));
}

function renderBlock(block: Block, key: number) {
  return Array.isArray(block) ? (
    <ul key={key}>
      {block.map((item, i) => (
        <li key={i}>{fill(item)}</li>
      ))}
    </ul>
  ) : (
    <p key={key}>{fill(block)}</p>
  );
}

/**
 * /privacy e /terms: páginas PÚBLICAS (abrem sem login). São os links pedidos pelo Google e pela
 * Apple na tela de consentimento do login social, e os que o cadastro menciona.
 */
export function LegalPage({ doc }: { doc: 'privacy' | 'terms' }) {
  const { m, f, lang } = useI18n();
  const { user } = useAuth();
  const content = LEGAL[doc][lang];

  return (
    <main className="auth legal">
      <Link to={user ? '/' : '/login'} className="auth-brand">
        <ProductMark size={28} />
        {m.appName}
      </Link>
      <article className="auth-card legal-card">
        <h1>{content.title}</h1>
        <p className="muted">
          {f(m.legal.updatedAt, { date: formatDate(lang, `${LEGAL_UPDATED_AT}T12:00:00Z`) })}
        </p>
        <p>{fill(content.intro)}</p>
        {content.sections.map((section) => (
          <section key={section.title}>
            <h2>{section.title}</h2>
            {section.body.map(renderBlock)}
          </section>
        ))}
      </article>
      <LegalLinks />
      <Preferences />
    </main>
  );
}
