import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ProductMark } from '../components/Icon';
import { Preferences } from '../components/ui';
import { API_URL, APP_NAME, LEGAL_OWNER, SUPPORT_EMAIL } from '../config';
import { useI18n } from '../i18n/I18nProvider';
import { LANDING, type LandingCopy } from '../landing/content';
import { useScrollMotion } from '../landing/scroll-motion';
import './LandingPage.css';

/**
 * Página inicial pública (/ para quem não está logado). Quem está logado vê o Início do painel.
 *
 * A ideia: as formas reais de entrar numa conta passam dentro do nome do produto, no lugar
 * do espaço entre as palavras. As imagens são telas do próprio painel (public/landing/), com
 * dados de exemplo. O texto fica em landing/content.ts.
 */
export function LandingPage() {
  const { m, lang } = useI18n();
  const copy = LANDING[lang];
  const shots = `/landing/${lang}/`;
  const root = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(0);
  useReveal(root);
  const goToStage = useScrollMotion({
    root,
    stages: copy.deploy.stages.length,
    onStage: setStage,
  });

  return (
    <div className="lp" ref={root}>
      <header className="lp-nav">
        <Link to="/" className="lp-wordmark">
          <ProductMark size={22} />
          {m.appName}
        </Link>
        <nav aria-label={m.appName}>
          <a href="#recursos">{copy.nav.features}</a>
          <a href="#seu-nome">{copy.nav.name}</a>
          <a href="#deploy">{copy.nav.deploy}</a>
          <a href="#numeros">{copy.nav.numbers}</a>
          <Link to="/login" className="lp-nav-signin">
            {copy.nav.signIn}
          </Link>
        </nav>
      </header>

      <main>
        <Hero copy={copy} />
        <Features copy={copy} shots={shots} />
        <NameIt copy={copy} />
        <Deploy
          copy={copy}
          stage={stage}
          onSelect={(i) => {
            // Com a seção presa na tela, escolher a etapa rola até ela; senão, só troca
            if (!goToStage.current?.(i)) setStage(i);
          }}
        />
        <Numbers copy={copy} />
        <StartForm copy={copy} />
      </main>
      <Footer copy={copy} />
    </div>
  );
}

// ---------------------------------------------------------------- primeira tela

function Hero({ copy }: { copy: LandingCopy }) {
  const [first, ...rest] = APP_NAME.split(' ');
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(0);

  // As formas de entrar se revezam na janela; com movimento reduzido, fica a primeira
  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setActive((i) => (i + 1) % copy.hero.ways.length), 2200);
    return () => window.clearInterval(id);
  }, [reduced, copy.hero.ways.length]);

  return (
    <section className="lp-hero" aria-labelledby="lp-title">
      <h1 id="lp-title" className="lp-hero-title">
        <span className="lp-word">
          <span className="lp-word-move is-first">{first}</span>
        </span>{' '}
        {/* O texto da janela vem do CSS (attr): o título continua sendo só o nome do produto */}
        <span className="lp-frame" data-ui aria-hidden="true">
          <span className="lp-frame-inner">
            {copy.hero.ways.map((w, i) => (
              <span key={w.label} className={i === active ? 'lp-way is-on' : 'lp-way'}>
                <span className="lp-way-label" data-text={w.label} />
                <span className="lp-way-value" data-text={w.value} />
              </span>
            ))}
          </span>
        </span>{' '}
        {rest.length > 0 && (
          <span className="lp-word">
            <span className="lp-word-move is-last">{rest.join(' ')}</span>
          </span>
        )}
      </h1>
      <div className="lp-hero-foot">
        <p className="lp-lead">{copy.hero.lead}</p>
        <div className="lp-hero-actions">
          <Link to="/register" className="lp-button">
            {copy.hero.create}
          </Link>
          <Link to="/login" className="lp-link">
            {copy.hero.signIn}
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- recursos

function Features({ copy, shots }: { copy: LandingCopy; shots: string }) {
  return (
    <section id="recursos" className="lp-features" aria-labelledby="lp-features-title">
      <div className="lp-features-intro">
        <h2 id="lp-features-title" className="lp-display" data-reveal>
          {copy.features.heading}
        </h2>
      </div>
      {copy.features.items.map((item, i) => (
        <article key={item.title} className={`lp-row lp-row-${i % 5}`} data-reveal-group>
          <div className="lp-row-text">
            <h3 className="lp-statement" data-reveal>
              {item.title}
            </h3>
            <p data-reveal>{item.text}</p>
          </div>
          <figure className="lp-row-picture" data-reveal>
            <div className="lp-parallax">
              {item.image.endsWith('.mp4') ? (
                <video
                  src={shots + item.image}
                  poster={shots + 'console-poster.jpg'}
                  autoPlay
                  muted
                  loop
                  playsInline
                  aria-label={item.alt}
                  width={1280}
                  height={800}
                />
              ) : (
                <img src={shots + item.image} alt={item.alt} loading="lazy" />
              )}
            </div>
          </figure>
        </article>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- "dê o seu nome": a coisa viva

/** O mesmo identificador que scripts/new-project.mjs deriva do nome. */
function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30)
      .replace(/-+$/, '') || 'meu-produto'
  );
}

function NameIt({ copy }: { copy: LandingCopy }) {
  const c = copy.name;
  const [name, setName] = useState(c.examples[0]!);
  const [color, setColor] = useState(c.colors[0]!.value);
  const shown = name.trim() || c.placeholder;
  const slug = slugify(shown);
  const command = `node scripts/new-project.mjs --name "${shown.replace(/"/g, '')}" --color "${color}"`;

  return (
    <section id="seu-nome" className="lp-name" aria-labelledby="lp-name-title">
      <h2 id="lp-name-title" className="lp-statement" data-reveal>
        {c.heading}
      </h2>
      <label className="lp-name-field" data-ui data-reveal>
        <span className="lp-sr">{c.inputLabel}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          placeholder={c.placeholder}
          spellCheck={false}
          autoComplete="off"
        />
      </label>

      <div className="lp-name-answer" data-reveal>
        <div className="lp-console" data-ui style={{ '--brand': color } as CSSProperties}>
          <div className="lp-console-side">
            <span className="lp-console-mark">{shown.charAt(0).toUpperCase()}</span>
            <span className="lp-console-name">
              <strong>{shown}</strong>
              <small>{c.console}</small>
            </span>
            <ul>
              {c.menu.map((item, i) => (
                <li key={item} className={i === 2 ? 'is-on' : undefined}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="lp-console-main">
            <strong>{c.signInTo.replace('{name}', shown)}</strong>
            <span className="lp-console-input" />
            <span className="lp-console-input" />
            <span className="lp-console-button">{c.signInTo.split(' ')[0]}</span>
          </div>
        </div>
        <div className="lp-command">
          <p>{c.commandLabel}</p>
          <pre>
            <code>{command}</code>
          </pre>
          <p className="lp-small">{c.resources.replaceAll('{slug}', slug)}</p>
        </div>
      </div>

      <div className="lp-name-controls" data-reveal>
        <div role="group" aria-label={c.examplesLabel} className="lp-examples">
          {c.examples.map((example) => (
            <button
              key={example}
              type="button"
              className={example === name ? 'is-on' : undefined}
              onClick={() => setName(example)}
            >
              {example}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label={c.colorLabel} className="lp-swatches">
          {c.colors.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={option.value === color}
              aria-label={option.name}
              title={option.name}
              style={{ background: option.value }}
              onClick={() => setColor(option.value)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- deploy

function Deploy({
  copy,
  stage,
  onSelect,
}: {
  copy: LandingCopy;
  stage: number;
  onSelect: (index: number) => void;
}) {
  const stages = copy.deploy.stages;
  const current = stages[stage]!;
  const site = window.location.host;
  const api = API_URL.replace(/^https?:\/\//, '');
  const log = current.log.map((line) => line.replace('{site}', site).replace('{api}', api));

  return (
    <section
      id="deploy"
      className="lp-deploy"
      aria-labelledby="lp-deploy-title"
      style={{ '--progress': stage / (stages.length - 1) } as CSSProperties}
    >
      <div className="lp-deploy-clause">
        <h2 id="lp-deploy-title" className="lp-display" key={stage} aria-live="polite">
          {current.clause}
        </h2>
      </div>
      <div className="lp-deploy-screen">
        <pre data-ui key={stage}>
          <code>{log.join('\n')}</code>
        </pre>
      </div>
      <div className="lp-deploy-control">
        <div className="lp-slider">
          <input
            type="range"
            min={0}
            max={stages.length - 1}
            step={1}
            value={stage}
            aria-label={copy.deploy.sliderLabel}
            aria-valuetext={current.name}
            onChange={(e) => onSelect(Number(e.target.value))}
          />
        </div>
        <ol>
          {stages.map((s, i) => (
            <li key={s.name}>
              <button
                type="button"
                className={i === stage ? 'is-on' : undefined}
                onClick={() => onSelect(i)}
              >
                {s.name}
              </button>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- números

function Numbers({ copy }: { copy: LandingCopy }) {
  const { lang } = useI18n();
  return (
    <section id="numeros" className="lp-numbers" aria-labelledby="lp-numbers-title">
      <h2 id="lp-numbers-title" className="lp-statement" data-reveal>
        <span className="lp-soft">{copy.numbers.headingSoft}</span>{' '}
        <span>{copy.numbers.headingStrong}</span>
      </h2>
      <dl className="lp-ledger">
        {copy.numbers.figures.map((figure) => {
          const text = new Intl.NumberFormat(lang, {
            minimumFractionDigits: figure.decimals ?? 0,
            maximumFractionDigits: figure.decimals ?? 0,
          }).format(figure.value);
          const [whole, decimals] = text.split(/[.,](?=\d+$)/);
          const separator = decimals ? text.charAt(whole!.length) : '';
          return (
            <div key={figure.caption} className="lp-figure" data-reveal>
              <dt
                className="lp-figure-value"
                data-value={figure.value}
                data-decimals={figure.decimals ?? 0}
              >
                <span className="lp-whole">{whole}</span>
                <span className="lp-decimals">{decimals ? separator + decimals : ''}</span>
              </dt>
              <dd>{figure.caption}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------- chamada final

function StartForm({ copy }: { copy: LandingCopy }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate('/register', { state: { email: email.trim() } });
  };

  return (
    <section className="lp-start" aria-labelledby="lp-start-title">
      <form onSubmit={submit} data-reveal>
        <h2 id="lp-start-title" className="lp-display lp-start-sentence">
          <span>{copy.cta.before}</span>{' '}
          <span className="lp-start-line">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={copy.cta.placeholder}
              aria-label={copy.cta.placeholder}
              autoComplete="email"
            />{' '}
            <button type="submit">{copy.cta.submit}</button>
          </span>
        </h2>
        <p className="lp-small">{copy.cta.after}</p>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- rodapé

function Footer({ copy }: { copy: LandingCopy }) {
  const { m } = useI18n();
  const [local, domain] = SUPPORT_EMAIL.split('@');
  return (
    <footer className="lp-footer">
      <div className="lp-footer-top">
        <div>
          {/* só o nome: o ícone é da cor do fundo */}
          <p className="lp-footer-mark">{m.appName}</p>
          <p>{copy.footer.about}</p>
          {/* Sem LEGAL_OWNER, o responsável é o próprio produto: não repete o nome */}
          {LEGAL_OWNER !== APP_NAME && <p>{copy.footer.madeBy.replace('{owner}', LEGAL_OWNER)}</p>}
        </div>
        <a href="#lp-title" className="lp-link">
          {copy.footer.top}
        </a>
      </div>
      <div className="lp-footer-contact">
        <h2 className="lp-sr">{copy.footer.contact}</h2>
        <a href={`mailto:${SUPPORT_EMAIL}`}>
          {local}
          <wbr />@{domain}
        </a>
      </div>
      <div className="lp-footer-meta">
        <nav aria-label={m.legal.nav}>
          <Link to="/login">{copy.nav.signIn}</Link>
          <Link to="/privacy">{m.legal.privacy}</Link>
          <Link to="/terms">{m.legal.terms}</Link>
        </nav>
        <Preferences />
        <p>
          {copy.footer.place} · {new Date().getFullYear()}
        </p>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------- movimento

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/**
 * Entrada das partes de cada seção quando ela aparece (título, texto, imagem, um depois do
 * outro). Só esconde o que vai animar DEPOIS de saber que o script rodou: sem JS, tudo aparece.
 */
function useReveal(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const items = [...el.querySelectorAll<HTMLElement>('[data-reveal]')];
    // escalonamento: a ordem dentro do bloco pai
    items.forEach((item) => {
      const siblings = item.parentElement
        ? [
            ...item.parentElement.querySelectorAll(
              ':scope > [data-reveal], :scope > * > [data-reveal]',
            ),
          ]
        : [];
      item.style.setProperty('--i', String(Math.max(0, siblings.indexOf(item))));
    });
    el.classList.add('lp-animate');
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    items.forEach((item) => io.observe(item));
    return () => io.disconnect();
  }, [root]);
}
