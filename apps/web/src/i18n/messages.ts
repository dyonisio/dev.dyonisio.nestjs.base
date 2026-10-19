/**
 * Textos das telas. Os ERROS vêm traduzidos da própria API (header Accept-Language) —
 * aqui ficam só os textos da interface. Para um idioma novo: copie o bloco `en`, traduza
 * e adicione em LANGUAGES (language.ts). O TypeScript acusa qualquer chave faltando.
 */
const en = {
  appName: 'NestJS Base',
  language: 'Language',
  common: {
    email: 'Email',
    password: 'Password',
    name: 'Name',
    submit: 'Continue',
    loading: 'Loading…',
    backToLogin: 'Back to sign in',
    networkError: 'Could not reach the server. Check your connection and try again.',
    passwordHint: 'At least 8 characters, with a letter and a number.',
  },
  login: {
    title: 'Sign in',
    forgot: 'Forgot your password?',
    noAccount: "Don't have an account?",
    register: 'Create account',
    twoFactorTitle: 'Two-step verification',
    twoFactorHelp: 'Enter the 6-digit code from your authenticator app, or a recovery code.',
    code: 'Code',
    verify: 'Verify',
  },
  register: {
    title: 'Create your account',
    haveAccount: 'Already have an account?',
    signIn: 'Sign in',
  },
  forgot: {
    title: 'Forgot your password?',
    help: "Enter your email and we'll send you a link to create a new password.",
    sent: 'If this email has an account, a link is on its way. Check your inbox (and the spam folder).',
  },
  reset: {
    title: 'Create a new password',
    newPassword: 'New password',
    confirm: 'Confirm the new password',
    mismatch: 'The passwords do not match.',
    missingToken: 'This link is incomplete. Open it again from the email.',
    done: 'Password saved! You can sign in now.',
  },
  verify: {
    title: 'Email confirmation',
    verifying: 'Confirming your email…',
    done: 'Email confirmed! Your account is ready.',
    goHome: 'Go to my account',
  },
  home: {
    hello: 'Hi, {name}!',
    signedInAs: 'Signed in as {email}',
    unverified: 'Confirm your email to unlock all features. Check your inbox.',
    resend: 'Resend email',
    resent: 'Sent! Check your inbox.',
    security: 'Account security',
    signOut: 'Sign out',
  },
  security: {
    title: 'Account security',
    soon: 'Sessions, two-step verification and sign-in methods will be managed here.',
    back: 'Back',
  },
  notFound: { title: 'Page not found', back: 'Go to the home page' },
};

type Dict = {
  [K in keyof typeof en]: (typeof en)[K] extends string
    ? string
    : Record<keyof (typeof en)[K], string>;
};

const ptBR: Dict = {
  appName: 'NestJS Base',
  language: 'Idioma',
  common: {
    email: 'E-mail',
    password: 'Senha',
    name: 'Nome',
    submit: 'Continuar',
    loading: 'Carregando…',
    backToLogin: 'Voltar para o login',
    networkError: 'Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.',
    passwordHint: 'No mínimo 8 caracteres, com uma letra e um número.',
  },
  login: {
    title: 'Entrar',
    forgot: 'Esqueceu a senha?',
    noAccount: 'Não tem conta?',
    register: 'Criar conta',
    twoFactorTitle: 'Verificação em duas etapas',
    twoFactorHelp:
      'Digite o código de 6 dígitos do seu app autenticador, ou um código de recuperação.',
    code: 'Código',
    verify: 'Verificar',
  },
  register: {
    title: 'Crie sua conta',
    haveAccount: 'Já tem conta?',
    signIn: 'Entrar',
  },
  forgot: {
    title: 'Esqueceu a senha?',
    help: 'Informe seu e-mail e enviaremos um link para criar uma nova senha.',
    sent: 'Se este e-mail tiver conta, o link já está a caminho. Confira a caixa de entrada (e o spam).',
  },
  reset: {
    title: 'Crie uma nova senha',
    newPassword: 'Nova senha',
    confirm: 'Confirme a nova senha',
    mismatch: 'As senhas não conferem.',
    missingToken: 'Este link está incompleto. Abra-o de novo pelo e-mail.',
    done: 'Senha salva! Você já pode entrar.',
  },
  verify: {
    title: 'Confirmação de e-mail',
    verifying: 'Confirmando seu e-mail…',
    done: 'E-mail confirmado! Sua conta está pronta.',
    goHome: 'Ir para minha conta',
  },
  home: {
    hello: 'Olá, {name}!',
    signedInAs: 'Conectado como {email}',
    unverified: 'Confirme seu e-mail para liberar todos os recursos. Veja sua caixa de entrada.',
    resend: 'Reenviar e-mail',
    resent: 'Enviado! Confira sua caixa de entrada.',
    security: 'Segurança da conta',
    signOut: 'Sair',
  },
  security: {
    title: 'Segurança da conta',
    soon: 'Aqui você vai gerenciar sessões, verificação em duas etapas e formas de login.',
    back: 'Voltar',
  },
  notFound: { title: 'Página não encontrada', back: 'Ir para o início' },
};

export const MESSAGES = { en, 'pt-BR': ptBR } as const;
export type Messages = Dict;
