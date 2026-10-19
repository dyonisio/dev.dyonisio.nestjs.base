#!/usr/bin/env node
/**
 * Começa um projeto novo a partir desta base: troca nome, identificador, domínios, repositório e cor.
 *
 *   node scripts/new-project.mjs                      # pergunta tudo
 *   node scripts/new-project.mjs --name "Acme Portal" --domain portal.acme.com \
 *     --repo acme/portal --color "#2563eb" --yes
 *   node scripts/new-project.mjs ... --dry-run        # só mostra o que mudaria
 *
 * A identidade atual fica em project.json (é dela que o script sabe o que trocar), então dá para
 * rodar de novo depois. Sem dependências: só Node 22+.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';

const ROOT = join(import.meta.dirname, '..');
const STATE = join(ROOT, 'project.json');

/** Pastas que não são código do projeto (dependências, builds, ferramentas locais). */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'tmp',
  '.serverless',
  '.idea',
  '.taste-skill',
]);
// Só arquivos do repositório: o .env local (segredos, fora do git) não é tocado
const TEXT_FILES =
  /\.(ts|tsx|mts|mjs|js|cjs|json|ya?ml|md|html|css|hbs|svg|txt)$|^(Dockerfile|\.env\.example|\.gitignore|\.nvmrc)$/;
/**
 * Arquivos que NÃO são renomeados: o "sal" do derive-secret entra no cálculo dos segredos; mudá-lo
 * num projeto que já está no ar derrubaria todas as sessões e links (e não traz nada de útil).
 */
const KEEP = new Set([join('apps', 'api', 'src', 'common', 'crypto', 'derive-secret.ts')]);

// ---------------------------------------------------------------- entrada

const { values: args } = parseArgs({
  options: {
    name: { type: 'string' },
    slug: { type: 'string' },
    domain: { type: 'string' },
    'api-domain': { type: 'string' },
    repo: { type: 'string' },
    color: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    yes: { type: 'boolean', short: 'y', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}

const current = JSON.parse(readFileSync(STATE, 'utf8'));

const slugify = (text) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '');

const RULES = {
  name: [
    (v) => v.trim().length >= 2 && v.length <= 60 && !/["<>`$\\]/.test(v),
    '2 a 60 caracteres, sem " < > ` $ \\',
  ],
  // Vira nome de stack, bucket, funções e roles na AWS: minúsculas e curto (limites de 63/64 caracteres)
  slug: [
    (v) => /^[a-z][a-z0-9-]{1,28}[a-z0-9]$/.test(v),
    'minúsculas, números e "-", de 3 a 30 caracteres (ex.: acme-portal)',
  ],
  domain: [
    (v) => /^(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/.test(v),
    'um domínio, sem https:// (ex.: portal.acme.com)',
  ],
  apiDomain: [
    (v) => /^(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/.test(v),
    'um domínio, sem https:// (ex.: api.portal.acme.com)',
  ],
  repo: [(v) => /^[\w.-]+\/[\w.-]+$/.test(v), 'dono/repositório do GitHub (ex.: acme/portal)'],
  color: [(v) => /^#[0-9a-f]{6}$/i.test(v), 'cor em hexadecimal com 6 dígitos (ex.: #2563eb)'],
};

async function collect() {
  const rl =
    process.stdin.isTTY && !args.yes
      ? createInterface({ input: process.stdin, output: process.stdout })
      : null;
  const ask = async (key, label, fallback) => {
    let value = args[key === 'apiDomain' ? 'api-domain' : key];
    for (;;) {
      if (value === undefined && rl) {
        const answer = (await rl.question(`${label} [${fallback}]: `)).trim();
        value = answer || fallback;
      }
      value ??= fallback;
      const [valid, hint] = RULES[key];
      if (valid(value)) return value;
      if (!rl) throw new Error(`${label}: "${value}" inválido — ${hint}`);
      console.log(`  ✗ ${hint}`);
      value = undefined;
    }
  };

  const name = await ask('name', 'Nome do produto', current.name);
  const slug = await ask(
    'slug',
    'Identificador (AWS, pacotes)',
    name === current.name ? current.slug : slugify(name),
  );
  const domain = (await ask('domain', 'Domínio do site', current.domain)).toLowerCase();
  const apiDomain = (
    await ask(
      'apiDomain',
      'Domínio da API',
      domain === current.domain ? current.apiDomain : `api.${domain}`,
    )
  ).toLowerCase();
  const repo = await ask('repo', 'Repositório no GitHub', current.repo);
  const color = (await ask('color', 'Cor da marca', current.color)).toLowerCase();
  rl?.close();
  return { name, slug, domain, apiDomain, repo, color };
}

// ---------------------------------------------------------------- cores

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (rgb) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
/** Mistura `hex` com `other`: weight = quanto de `hex` fica (0..1). */
const mix = (hex, other, weight) => {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  return rgbToHex(a.map((c, i) => c * weight + b[i] * (1 - weight)));
};

/** As variações da cor da marca nos dois temas (destaque, fundo e texto das etiquetas). */
function palette(color) {
  return {
    light: {
      accent: color,
      'pill-accent-bg': mix(color, '#ffffff', 0.13),
      'pill-accent-ink': mix(color, '#000000', 0.55),
    },
    dark: {
      accent: mix(color, '#ffffff', 0.6),
      'pill-accent-bg': mix(color, '#000000', 0.3),
      'pill-accent-ink': mix(color, '#ffffff', 0.4),
    },
  };
}

/** Troca --accent e as etiquetas: o 1º bloco do styles.css é o tema claro; os seguintes, o escuro. */
function recolorCss(css, color) {
  const tones = palette(color);
  let block = 0;
  return css.replace(
    /(\n\s*)--accent: #[0-9a-f]{6};([\s\S]*?)--pill-accent-bg: #[0-9a-f]{6};(\s*)--pill-accent-ink: #[0-9a-f]{6};/gi,
    (_m, lead, middle, gap) => {
      const t = block++ === 0 ? tones.light : tones.dark;
      return `${lead}--accent: ${t.accent};${middle}--pill-accent-bg: ${t['pill-accent-bg']};${gap}--pill-accent-ink: ${t['pill-accent-ink']};`;
    },
  );
}

// ---------------------------------------------------------------- troca

function files(dir = ROOT, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) files(path, out);
    } else if (TEXT_FILES.test(entry) && !KEEP.has(relative(ROOT, path))) {
      out.push(path);
    }
  }
  return out;
}

/** Pares (de → para), do mais específico para o mais geral (o domínio da API contém o do site). */
function replacements(from, to) {
  const pairs = [
    [from.apiDomain, to.apiDomain],
    [from.domain, to.domain],
    [from.repo, to.repo],
    [from.slug, to.slug],
    [from.name, to.name],
  ];
  return pairs.filter(([a, b]) => a !== b);
}

function rewrite(path, text, from, to) {
  let next = text;
  for (const [a, b] of replacements(from, to)) next = next.split(a).join(b);

  const rel = relative(ROOT, path).split(sep).join('/');
  if (from.color !== to.color) {
    if (rel === 'apps/web/src/styles.css') next = recolorCss(next, to.color);
    if (rel === 'apps/web/public/favicon.svg') next = next.split(from.color).join(to.color);
  }
  // Trust policy: o repositório novo ainda não tem os ids numéricos da linha "imutável" (dono@id/repo@id)
  if (rel === 'docs/aws/github-trust-policy.json' && from.repo !== to.repo) {
    const policy = JSON.parse(next);
    for (const statement of policy.Statement ?? []) {
      const like = statement.Condition?.StringLike;
      if (like?.['token.actions.githubusercontent.com:sub']) {
        like['token.actions.githubusercontent.com:sub'] = `repo:${to.repo}:environment:*`;
      }
    }
    next = `${JSON.stringify(policy, null, 2)}\n`;
  }
  return next;
}

// ---------------------------------------------------------------- execução

let target;
try {
  target = await collect();
} catch (error) {
  console.error(`✗ ${error.message}`);
  process.exit(1);
}
const changed = [];
for (const path of files()) {
  const before = readFileSync(path, 'utf8');
  const after = rewrite(path, before, current, target);
  if (after !== before) {
    changed.push(relative(ROOT, path));
    if (!args['dry-run']) writeFileSync(path, after);
  }
}
if (!args['dry-run']) writeFileSync(STATE, `${JSON.stringify(target, null, 2)}\n`);

const title = args['dry-run'] ? 'Mudaria' : 'Alterados';
console.log(`\n${title} ${changed.length} arquivos:`);
for (const file of changed) console.log(`  ${file.split(sep).join('/')}`);
if (args['dry-run']) process.exit(0);

console.log(`
Pronto: "${target.name}" (${target.slug}). Falta o que o script não consegue fazer:

  1. Logo: troque apps/web/public/icon.png (512×512, aparece nos apps de 2FA) e o desenho do
     apps/web/public/favicon.svg (a cor já foi trocada).
  2. Git: aponte para o repositório novo
       git remote set-url origin git@github.com:${target.repo}.git
  3. GitHub (Settings → Environments → prod), variáveis: APP_NAME=${target.name},
     FRONTEND_URL=https://${target.domain}, WEB_DOMAIN=${target.domain}, API_DOMAIN=${target.apiDomain}
     (+ os certificados; passo a passo em docs/FIRST_DEPLOY.md e docs/DEPLOY_WEB.md).
  4. AWS: crie a role do deploy com docs/aws/github-*-policy.json (já com "${target.slug}" e "${target.repo}").
  5. Confira e faça o commit:  git diff --stat
`);
if (existsSync(join(ROOT, 'apps', 'api', 'node_modules'))) {
  console.log('  Dica: rode os testes (cd apps/api && npm test) para conferir que nada quebrou.\n');
}
