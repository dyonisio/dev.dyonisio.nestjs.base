import {
  AnimatePresence,
  motion,
  MotionConfig,
  type Transition,
  type Variants,
} from 'motion/react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
} from 'react';
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
 *
 * Movimento: Motion (antigo Framer Motion) nas entradas, trocas e controles; GSAP +
 * ScrollTrigger no que depende da rolagem (landing/scroll-motion.ts). Com "reduzir movimento"
 * ligado no sistema, os deslocamentos somem e a página fica parada.
 */
export default function LandingPage() {
  const { m, lang } = useI18n();
  const copy = LANDING[lang];
  const shots = `/landing/${lang}/`;
  const root = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(0);
  const { goToStage, scrollToId } = useScrollMotion({
    root,
    stages: copy.deploy.stages.length,
    onStage: setStage,
  });
  const active = useActiveSection(root, SECTIONS);

  const go = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    scrollToId(id);
    history.replaceState(null, '', `#${id}`);
  };

  const links: [string, string][] = [
    ['recursos', copy.nav.features],
    ['seu-nome', copy.nav.name],
    ['deploy', copy.nav.deploy],
    ['numeros', copy.nav.numbers],
  ];

  return (
    <MotionConfig reducedMotion="user">
      <div className="lp" ref={root}>
        <header className="lp-nav">
          <Link to="/" className="lp-wordmark">
            <ProductMark size={22} />
            {m.appName}
          </Link>
          <nav aria-label={m.appName}>
            {links.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                onClick={(e) => go(e, id)}
                aria-current={active === id ? 'location' : undefined}
              >
                {label}
                {active === id && (
                  <motion.span className="lp-nav-mark" layoutId="lp-nav-mark" transition={spring} />
                )}
              </a>
            ))}
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
        <Footer copy={copy} onTop={(e) => go(e, 'lp-title')} />
      </div>
    </MotionConfig>
  );
}

const SECTIONS = ['recursos', 'seu-nome', 'deploy', 'numeros'];

// ---------------------------------------------------------------- movimento: o vocabulário

/** Mola sem quique: firme, assenta rápido. */
const spring: Transition = { type: 'spring', bounce: 0, visualDuration: 0.5 };

/** Um bloco que sobe e aparece; dentro de um `stagger`, um depois do outro. */
const rise: Variants = {
  hidden: { opacity: 0, y: 32 },
  shown: { opacity: 1, y: 0, transition: { type: 'spring', bounce: 0, visualDuration: 0.8 } },
};

const stagger = (gap = 0.09): Variants => ({
  hidden: {},
  shown: { transition: { staggerChildren: gap } },
});

/** Dispara a entrada quando o bloco aparece na tela (uma vez). */
const inView = {
  initial: 'hidden',
  whileInView: 'shown',
  viewport: { once: true, amount: 0.25 },
} as const;

// ---------------------------------------------------------------- primeira tela

function Hero({ copy }: { copy: LandingCopy }) {
  const [first, ...rest] = APP_NAME.split(' ');
  const reduced = usePrefersReducedMotion();
  const [active, setActive] = useState(0);
  const way = copy.hero.ways[active]!;

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
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={way.label}
                className="lp-way"
                initial={{ opacity: 0, y: '70%' }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: '-70%' }}
                transition={spring}
              >
                <span className="lp-way-label" data-text={way.label} />
                <span className="lp-way-value" data-text={way.value} />
              </motion.span>
            </AnimatePresence>
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
          <motion.span whileHover={{ y: -3 }} whileTap={{ scale: 0.96 }} transition={spring}>
            <Link to="/register" className="lp-button">
              {copy.hero.create}
            </Link>
          </motion.span>
          <Link to="/login" className="lp-link">
            {copy.hero.signIn}
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- recursos: texto e tela alternando

function Features({ copy, shots }: { copy: LandingCopy; shots: string }) {
  return (
    <section id="recursos" className="lp-features" aria-labelledby="lp-features-title">
      <motion.h2
        id="lp-features-title"
        className="lp-display lp-features-title"
        variants={rise}
        {...inView}
      >
        {copy.features.heading}
      </motion.h2>
      {copy.features.items.map((item, i) => (
        <motion.article
          key={item.title}
          className={`lp-row lp-row-${i % 5} ${i % 2 ? 'is-flipped' : ''}`}
          variants={stagger(0.12)}
          {...inView}
        >
          <div className="lp-row-text">
            <motion.h3 className="lp-statement" variants={rise}>
              {item.title}
            </motion.h3>
            <motion.p variants={rise}>{item.text}</motion.p>
          </div>
          <motion.figure
            className="lp-row-picture"
            // a tela se abre como um obturador (sempre visível: só o recorte muda)
            variants={{
              hidden: { clipPath: 'inset(14% 8% 14% 8%)', y: 40 },
              shown: {
                clipPath: 'inset(0% 0% 0% 0%)',
                y: 0,
                transition: { type: 'spring', bounce: 0, visualDuration: 1 },
              },
            }}
          >
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
          </motion.figure>
        </motion.article>
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
  const initial = shown.charAt(0).toUpperCase();
  const slug = slugify(shown);
  const command = `node scripts/new-project.mjs --name "${shown.replace(/"/g, '')}" --color "${color}"`;

  return (
    <motion.section
      id="seu-nome"
      className="lp-name"
      aria-labelledby="lp-name-title"
      variants={stagger(0.1)}
      {...inView}
    >
      <motion.h2 id="lp-name-title" className="lp-statement" variants={rise}>
        {c.heading}
      </motion.h2>
      <motion.label className="lp-name-field" data-ui variants={rise}>
        <span className="lp-sr">{c.inputLabel}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          placeholder={c.placeholder}
          spellCheck={false}
          autoComplete="off"
        />
      </motion.label>

      <motion.div className="lp-name-answer" variants={rise}>
        <div className="lp-console" data-ui style={{ '--brand': color } as CSSProperties}>
          <div className="lp-console-side">
            <motion.span
              className="lp-console-mark"
              animate={{ backgroundColor: color }}
              transition={{ duration: 0.4 }}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={initial}
                  initial={{ y: 14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -14, opacity: 0 }}
                  transition={spring}
                >
                  {initial}
                </motion.span>
              </AnimatePresence>
            </motion.span>
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
            <motion.span
              className="lp-console-button"
              animate={{ backgroundColor: color }}
              transition={{ duration: 0.4 }}
            >
              {c.signInTo.split(' ')[0]}
            </motion.span>
          </div>
        </div>
        <div className="lp-command">
          <p>{c.commandLabel}</p>
          <pre>
            <code>{command}</code>
          </pre>
          <p className="lp-small">{c.resources.replaceAll('{slug}', slug)}</p>
        </div>
      </motion.div>

      <motion.div className="lp-name-controls" variants={rise}>
        <div role="group" aria-label={c.examplesLabel} className="lp-examples">
          {c.examples.map((example) => (
            <button
              key={example}
              type="button"
              className={example === name ? 'is-on' : undefined}
              onClick={() => setName(example)}
            >
              {example}
              {example === name && (
                <motion.span className="lp-underline" layoutId="lp-example" transition={spring} />
              )}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label={c.colorLabel} className="lp-swatches">
          {c.colors.map((option) => (
            <motion.button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={option.value === color}
              aria-label={option.name}
              title={option.name}
              style={{ background: option.value }}
              onClick={() => setColor(option.value)}
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.9 }}
              transition={spring}
            >
              {option.value === color && (
                <motion.span className="lp-swatch-ring" layoutId="lp-swatch" transition={spring} />
              )}
            </motion.button>
          ))}
        </div>
      </motion.div>
    </motion.section>
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
        <h2 id="lp-deploy-title" className="lp-display" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={stage}
              className="lp-clause"
              initial={{ opacity: 0, y: 36 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -36 }}
              transition={{ type: 'spring', bounce: 0, visualDuration: 0.35 }}
            >
              {current.clause}
            </motion.span>
          </AnimatePresence>
        </h2>
      </div>
      <div className="lp-deploy-screen">
        {/* o terminal "digita" a etapa: uma linha depois da outra */}
        <motion.pre data-ui key={stage} initial="hidden" animate="shown" variants={stagger(0.11)}>
          {log.map((line, i) => (
            <motion.code
              key={i}
              variants={{
                hidden: { opacity: 0, x: -10 },
                shown: { opacity: 1, x: 0, transition: { duration: 0.22 } },
              }}
            >
              {line}
            </motion.code>
          ))}
        </motion.pre>
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
                {i === stage && (
                  <motion.span className="lp-underline" layoutId="lp-stage" transition={spring} />
                )}
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
  return (
    <section id="numeros" className="lp-numbers" aria-labelledby="lp-numbers-title">
      <motion.div className="lp-numbers-intro" variants={stagger()} {...inView}>
        <motion.h2 id="lp-numbers-title" className="lp-display" variants={rise}>
          {copy.numbers.heading}
        </motion.h2>
        <motion.p variants={rise}>{copy.numbers.lead}</motion.p>
      </motion.div>
      <motion.dl className="lp-ledger" variants={stagger(0.1)} {...inView}>
        {copy.numbers.figures.map((figure) => (
          <motion.div key={figure.caption} className="lp-figure" variants={rise}>
            <dt className="lp-figure-value" data-value={figure.value}>
              <span className="lp-whole">{figure.value}</span>
              {figure.suffix && <span className="lp-suffix">{figure.suffix}</span>}
            </dt>
            <dd>{figure.caption}</dd>
          </motion.div>
        ))}
      </motion.dl>
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
      <motion.form onSubmit={submit} variants={stagger()} {...inView}>
        <motion.h2 id="lp-start-title" className="lp-display lp-start-sentence" variants={rise}>
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
            <motion.button
              type="submit"
              whileHover={{ y: -4 }}
              whileTap={{ scale: 0.95 }}
              transition={spring}
            >
              {copy.cta.submit}
            </motion.button>
          </span>
        </motion.h2>
        <motion.p className="lp-small" variants={rise}>
          {copy.cta.after}
        </motion.p>
      </motion.form>
    </section>
  );
}

// ---------------------------------------------------------------- rodapé

function Footer({
  copy,
  onTop,
}: {
  copy: LandingCopy;
  onTop: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
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
        <a href="#lp-title" className="lp-link" onClick={onTop}>
          {copy.footer.top}
        </a>
      </div>
      <motion.div
        className="lp-footer-contact"
        initial={{ opacity: 0, y: 60 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ type: 'spring', bounce: 0, visualDuration: 0.9 }}
      >
        <h2 className="lp-sr">{copy.footer.contact}</h2>
        <a href={`mailto:${SUPPORT_EMAIL}`}>
          {local}
          <wbr />@{domain}
        </a>
      </motion.div>
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

// ---------------------------------------------------------------- utilidades

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

/** A seção que está no meio da tela agora (para marcar o link do menu). */
function useActiveSection(root: React.RefObject<HTMLDivElement | null>, ids: string[]) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const el = root.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
      },
      // uma faixa no meio da tela: a seção que passa por ela é a atual
      { rootMargin: '-45% 0px -50% 0px' },
    );
    ids.forEach((id) => {
      const section = el.querySelector(`#${id}`);
      if (section) io.observe(section);
    });
    const hero = el.querySelector('.lp-hero');
    const top = new IntersectionObserver(([entry]) => entry?.isIntersecting && setActive(null), {
      rootMargin: '-45% 0px -50% 0px',
    });
    if (hero) top.observe(hero);
    return () => {
      io.disconnect();
      top.disconnect();
    };
  }, [root, ids]);
  return active;
}
