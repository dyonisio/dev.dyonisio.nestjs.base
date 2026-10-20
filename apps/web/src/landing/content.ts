/**
 * Texto da página inicial pública (/ sem login). Fala DESTA base; num produto novo, troque o
 * texto aqui (e as telas em public/landing/) sem mexer no layout (pages/LandingPage.tsx).
 *
 * Os números da seção "Medido no código" são reais: atualize quando mudarem
 * (npm run test:cov na API, npm test no front, openapi.json, migrations, templates de e-mail).
 */
import type { Language } from '../i18n/language';

export interface Feature {
  title: string;
  text: string;
  /** Tela do painel (public/landing/<idioma>/<image>) ou o vídeo (console.mp4). */
  image: string;
  alt: string;
}

export interface Stage {
  /** Nome curto, embaixo do controle deslizante. */
  name: string;
  /** A frase do estágio: é o título da seção enquanto ele está escolhido. */
  clause: string;
  /** O que o terminal mostra nesse estágio ({site} e {api} viram os endereços reais). */
  log: string[];
}

export interface Figure {
  value: number;
  /** Casas decimais mostradas. */
  decimals?: number;
  caption: string;
}

export interface LandingCopy {
  nav: { features: string; name: string; deploy: string; numbers: string; signIn: string };
  hero: {
    lead: string;
    create: string;
    signIn: string;
    /** As formas de entrar que passam na janela do título. */
    ways: { label: string; value: string }[];
    waysLabel: string;
  };
  features: { heading: string; items: Feature[] };
  name: {
    heading: string;
    inputLabel: string;
    placeholder: string;
    examples: string[];
    examplesLabel: string;
    colorLabel: string;
    colors: { name: string; value: string }[];
    console: string;
    signInTo: string;
    commandLabel: string;
    resources: string;
    menu: string[];
  };
  deploy: { sliderLabel: string; stages: Stage[] };
  numbers: { headingSoft: string; headingStrong: string; figures: Figure[] };
  cta: { before: string; placeholder: string; submit: string; after: string };
  footer: { about: string; madeBy: string; top: string; contact: string; place: string };
}

const pt: LandingCopy = {
  nav: {
    features: 'Recursos',
    name: 'Seu nome',
    deploy: 'Deploy',
    numbers: 'Números',
    signIn: 'Entrar',
  },
  hero: {
    lead: 'A base para o seu próximo produto: contas, login de cinco jeitos, painel de administração e deploy na AWS, prontos no primeiro dia.',
    create: 'Criar uma conta',
    signIn: 'Entrar no painel',
    waysLabel: 'Formas de entrar',
    ways: [
      { label: 'Senha', value: '••••••••••' },
      { label: 'Link por e-mail', value: 'Enviado para ana@…' },
      { label: 'Google', value: 'Continuar com Google' },
      { label: 'Passkey', value: 'Toque no sensor' },
      { label: 'Código 2FA', value: '482 913' },
    ],
  },
  features: {
    heading: 'O que vem antes do produto',
    items: [
      {
        title: 'Cinco jeitos de entrar',
        text: 'Senha, link por e-mail, Google, Apple e passkey. Com verificação em duas etapas e códigos de recuperação.',
        image: 'login.jpg',
        alt: 'Tela de login com senha, link por e-mail, passkey e Google',
      },
      {
        title: 'Cada aparelho à vista',
        text: 'A pessoa vê onde está conectada, recebe um e-mail quando entra de um aparelho novo e desconecta o que não reconhece.',
        image: 'sessions.jpg',
        alt: 'Lista de dispositivos conectados, com navegador, IP e último uso',
      },
      {
        title: 'Conta invadida tem saída',
        text: 'O admin vê as sessões e as formas de login de quem pediu ajuda, e remove a passkey ou o Google que a pessoa não reconhece.',
        image: 'console.mp4',
        alt: 'Página de um usuário no painel, rolando até as formas de login',
      },
      {
        title: 'Tudo fica registrado',
        text: 'Logins, trocas de senha, papéis e exclusões vão para a auditoria, com quem fez, quando e de onde.',
        image: 'audit.jpg',
        alt: 'Trilha de auditoria com ações, autores e datas',
      },
      {
        title: 'Privacidade sem letra miúda',
        text: 'Baixar os próprios dados, excluir a conta e apagar tudo depois de 30 dias, como a LGPD pede.',
        image: 'privacy.jpg',
        alt: 'Tela de privacidade com baixar meus dados e excluir conta',
      },
    ],
  },
  name: {
    heading: 'Dê o seu nome a ela',
    inputLabel: 'Nome do seu produto',
    placeholder: 'Nome do produto',
    examplesLabel: 'Outros nomes para testar',
    examples: ['Clínica Aurora', 'Portal do Aluno', 'Loja da Esquina'],
    colorLabel: 'Cor da marca',
    colors: [
      { name: 'Petróleo', value: '#1b6c80' },
      { name: 'Azul', value: '#2563eb' },
      { name: 'Verde', value: '#1e7b4f' },
      { name: 'Vermelho', value: '#b42318' },
    ],
    console: 'Console de contas',
    signInTo: 'Entrar no {name}',
    commandLabel: 'O comando que deixa a base com esse nome',
    resources: 'Na AWS: {slug}-api, {slug}-web e o stack {slug}-api-prod.',
    menu: ['Início', 'Minha conta', 'Segurança', 'Usuários'],
  },
  deploy: {
    sliderLabel: 'Etapa do deploy',
    stages: [
      {
        name: 'Testes',
        clause: 'Primeiro, os testes',
        log: [
          'lint ............ ok',
          'tipos ........... ok',
          '608 testes na API  ok',
          '43 testes no front ok',
          'build ........... ok',
        ],
      },
      {
        name: 'Banco',
        clause: 'Depois, o banco migra',
        log: [
          'invoke migrate',
          'AddPasskeys1761800000000  aplicada',
          'migrations pendentes: 0',
          'código antigo segue no ar',
        ],
      },
      {
        name: 'API',
        clause: 'Então, a API muda',
        log: [
          'serverless deploy --stage prod',
          'api ............. atualizada',
          'worker ........... atualizado',
          'maintenance ...... a cada 6 h',
          '{api}',
        ],
      },
      {
        name: 'Site',
        clause: 'Por fim, o site no ar',
        log: ['vite build', 's3 sync dist/', 'cloudfront: cache renovado', '{site}'],
      },
    ],
  },
  numbers: {
    headingSoft: 'Medido no código,',
    headingStrong: 'não prometido',
    figures: [
      { value: 651, caption: 'testes automatizados, na API e no front' },
      { value: 99.1, decimals: 1, caption: '% das linhas da API cobertas por testes' },
      { value: 59, caption: 'rotas na API, documentadas no Swagger' },
      { value: 13, caption: 'e-mails de sistema, em português e inglês' },
      { value: 15, caption: 'migrations, aplicadas antes de cada deploy' },
    ],
  },
  cta: {
    before: 'Teste o painel com',
    placeholder: 'seu e-mail',
    submit: 'começar',
    after: 'Você cria a conta, confirma o e-mail e entra no painel.',
  },
  footer: {
    about: 'Base para produtos com contas, feita em NestJS e React.',
    madeBy: 'Feito por {owner}.',
    top: 'Voltar ao topo',
    contact: 'Fale com a gente',
    place: 'Brasil',
  },
};

const en: LandingCopy = {
  nav: {
    features: 'Features',
    name: 'Your name',
    deploy: 'Deploy',
    numbers: 'Numbers',
    signIn: 'Sign in',
  },
  hero: {
    lead: 'The base for your next product: accounts, five ways to sign in, an admin console and AWS deploys, ready on day one.',
    create: 'Create an account',
    signIn: 'Open the console',
    waysLabel: 'Ways to sign in',
    ways: [
      { label: 'Password', value: '••••••••••' },
      { label: 'Email link', value: 'Sent to ana@…' },
      { label: 'Google', value: 'Continue with Google' },
      { label: 'Passkey', value: 'Touch the sensor' },
      { label: '2FA code', value: '482 913' },
    ],
  },
  features: {
    heading: 'What comes before the product',
    items: [
      {
        title: 'Five ways to sign in',
        text: 'Password, email link, Google, Apple and passkeys. With two-step verification and recovery codes.',
        image: 'login.jpg',
        alt: 'Sign-in screen with password, email link, passkey and Google',
      },
      {
        title: 'Every device in sight',
        text: 'People see where they are signed in, get an email when a new device signs in, and sign out what they do not recognize.',
        image: 'sessions.jpg',
        alt: 'List of signed-in devices with browser, IP and last use',
      },
      {
        title: 'A way back from a takeover',
        text: 'Admins see the sessions and sign-in methods of whoever asked for help, and remove the passkey or Google account the person does not recognize.',
        image: 'console.mp4',
        alt: 'A user page in the console, scrolling to the sign-in methods',
      },
      {
        title: 'Everything on the record',
        text: 'Sign-ins, password changes, roles and deletions go to the audit log, with who, when and from where.',
        image: 'audit.jpg',
        alt: 'Audit log with actions, actors and dates',
      },
      {
        title: 'Privacy without fine print',
        text: 'Download your own data, delete the account and erase it all after 30 days, as privacy law expects.',
        image: 'privacy.jpg',
        alt: 'Privacy screen with download my data and delete account',
      },
    ],
  },
  name: {
    heading: 'Give it your name',
    inputLabel: 'Your product name',
    placeholder: 'Product name',
    examplesLabel: 'More names to try',
    examples: ['Aurora Clinic', 'Student Portal', 'Corner Shop'],
    colorLabel: 'Brand colour',
    colors: [
      { name: 'Petrol', value: '#1b6c80' },
      { name: 'Blue', value: '#2563eb' },
      { name: 'Green', value: '#1e7b4f' },
      { name: 'Red', value: '#b42318' },
    ],
    console: 'Accounts console',
    signInTo: 'Sign in to {name}',
    commandLabel: 'The command that gives the base this name',
    resources: 'On AWS: {slug}-api, {slug}-web and the {slug}-api-prod stack.',
    menu: ['Home', 'My account', 'Security', 'Users'],
  },
  deploy: {
    sliderLabel: 'Deploy stage',
    stages: [
      {
        name: 'Tests',
        clause: 'First, every test',
        log: [
          'lint ............ ok',
          'types ........... ok',
          '608 API tests     ok',
          '43 front tests    ok',
          'build ........... ok',
        ],
      },
      {
        name: 'Database',
        clause: 'Then the database',
        log: [
          'invoke migrate',
          'AddPasskeys1761800000000  applied',
          'pending migrations: 0',
          'old code still live',
        ],
      },
      {
        name: 'API',
        clause: 'Next, the new API',
        log: [
          'serverless deploy --stage prod',
          'api ............. updated',
          'worker .......... updated',
          'maintenance ..... every 6 h',
          '{api}',
        ],
      },
      {
        name: 'Site',
        clause: 'Last, the website',
        log: ['vite build', 's3 sync dist/', 'cloudfront: cache refreshed', '{site}'],
      },
    ],
  },
  numbers: {
    headingSoft: 'Measured in the code,',
    headingStrong: 'not promised',
    figures: [
      { value: 651, caption: 'automated tests, across the API and the front' },
      { value: 99.1, decimals: 1, caption: '% of API lines covered by tests' },
      { value: 59, caption: 'API routes, documented in Swagger' },
      { value: 13, caption: 'system emails, in Portuguese and English' },
      { value: 15, caption: 'migrations, applied before every deploy' },
    ],
  },
  cta: {
    before: 'Try the console with',
    placeholder: 'your email',
    submit: 'start',
    after: 'You create the account, confirm the email and you are in.',
  },
  footer: {
    about: 'A base for products with accounts, built with NestJS and React.',
    madeBy: 'Made by {owner}.',
    top: 'Back to top',
    contact: 'Get in touch',
    place: 'Brazil',
  },
};

export const LANDING: Record<Language, LandingCopy> = { 'pt-BR': pt, en };
