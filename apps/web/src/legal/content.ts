/**
 * Textos da Política de Privacidade e dos Termos de Uso (páginas públicas /privacy e /terms).
 *
 * Descrevem o que ESTA base faz com os dados (o que guarda, por quanto tempo, onde). Ao mudar o
 * sistema (novo dado, novo serviço de terceiros, outro prazo), atualize aqui e a data abaixo.
 * É um ponto de partida, não um parecer jurídico: revise com quem cuida da parte legal do produto.
 *
 * Marcadores trocados na tela: {appName}, {owner} (responsável), {email} (contato), {site}.
 */
import type { Language } from '../i18n/language';

/** Data da última mudança nos textos (aparece no topo das duas páginas). */
export const LEGAL_UPDATED_AT = '2026-10-21';

/** Um parágrafo, ou uma lista (array de itens). */
export type Block = string | string[];
export interface LegalSection {
  title: string;
  body: Block[];
}
export interface LegalDocument {
  title: string;
  intro: string;
  sections: LegalSection[];
}

const privacyPt: LegalDocument = {
  title: 'Política de Privacidade',
  intro:
    'Esta política explica quais dados pessoais o {appName} trata, para quê, por quanto tempo e quais são os seus direitos, conforme a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018).',
  sections: [
    {
      title: '1. Quem é o responsável',
      body: [
        'O controlador dos dados é {owner}. Para qualquer assunto sobre privacidade, incluindo o exercício dos seus direitos, fale com {email}.',
      ],
    },
    {
      title: '2. Quais dados tratamos',
      body: [
        [
          'Dados da conta: nome, e-mail, idioma preferido e, se você enviar, a foto do perfil.',
          'Senha: guardamos só um resumo criptográfico (hash), nunca a senha em si.',
          'Verificação em duas etapas e passkeys: o segredo do app autenticador (cifrado) e a chave pública das passkeys. A digital, o rosto e o PIN nunca saem do seu aparelho.',
          'Login com Google ou Apple: o identificador da sua conta no provedor, o e-mail e o nome que ele informa. Não recebemos sua senha do Google ou da Apple nem acesso aos seus outros dados neles.',
          'Sessões e segurança: endereço IP, navegador e sistema (user agent), e as datas de login e de uso, para mostrar seus dispositivos conectados e avisar sobre acessos novos.',
          'Registro de atividades (auditoria): ações relevantes de segurança e administração, como login, troca de senha ou de e-mail, com data, IP e navegador.',
          'Compras e assinaturas: o plano, o valor, a data e a situação do pagamento. Os dados do cartão ou do Pix você informa na página da plataforma de pagamento; nós nunca os recebemos.',
        ],
      ],
    },
    {
      title: '3. Para que usamos',
      body: [
        [
          'Criar e manter a sua conta e permitir que você entre nela (execução do contrato).',
          'Proteger a conta e o serviço: detectar acessos suspeitos, limitar tentativas, avisar sobre mudanças importantes (legítimo interesse e segurança).',
          'Enviar e-mails do próprio serviço: confirmação de e-mail, redefinição de senha, link de acesso e alertas de segurança. Não enviamos propaganda.',
          'Cumprir obrigações legais e atender pedidos de autoridades, quando exigido por lei.',
        ],
        'Não vendemos seus dados, não os usamos para publicidade e não usamos ferramentas de rastreamento ou análise de terceiros.',
      ],
    },
    {
      title: '4. Com quem compartilhamos',
      body: [
        'Somente com fornecedores necessários para o serviço funcionar, que tratam os dados em nosso nome:',
        [
          'Amazon Web Services (AWS): hospedagem do sistema, do banco de dados, dos arquivos e envio dos e-mails. Os servidores ficam nos Estados Unidos.',
          'Google e Apple: apenas se você escolher entrar com eles.',
          'Plataformas de pagamento (Stripe, InfinitePay ou AbacatePay, conforme a que você escolher): apenas se você comprar algo. Elas recebem seu nome, e-mail e o valor da compra, e processam o pagamento segundo as próprias políticas.',
        ],
        'Por usar servidores nos Estados Unidos, há transferência internacional de dados, feita com fornecedores que adotam medidas de segurança adequadas (art. 33 da LGPD).',
      ],
    },
    {
      title: '5. Cookies e armazenamento no navegador',
      body: [
        'Usamos apenas o que é necessário para o site funcionar:',
        [
          'Um cookie de sessão protegido (httpOnly), que mantém você conectado.',
          'Preferências salvas no seu navegador: tema (claro/escuro), idioma e um indicador de que há uma sessão aberta.',
        ],
        'Não usamos cookies de publicidade nem de análise.',
      ],
    },
    {
      title: '6. Por quanto tempo guardamos',
      body: [
        [
          'Dados da conta: enquanto a conta existir.',
          'Sessões encerradas ou expiradas: até 30 dias.',
          'Registro de atividades: até 365 dias.',
          'Conta excluída: os dados pessoais são apagados definitivamente 30 dias após a exclusão. Nesse período a conta ainda pode ser restaurada por um administrador, se você pedir.',
          'Registros técnicos dos servidores: até 14 dias.',
        ],
      ],
    },
    {
      title: '7. Seus direitos',
      body: [
        'Pela LGPD, você pode, entre outros: confirmar se tratamos seus dados e acessá-los; corrigir dados incompletos ou desatualizados; pedir a portabilidade; pedir a exclusão; e saber com quem compartilhamos.',
        'Vários deles você exerce sozinho, na área "Minha conta": editar o perfil, baixar todos os seus dados (Privacidade → Baixar meus dados) e excluir a conta (Privacidade → Excluir conta). Para o restante, escreva para {email}.',
      ],
    },
    {
      title: '8. Segurança',
      body: [
        'Usamos conexão cifrada (HTTPS), senhas guardadas como hash, segredos cifrados no banco, verificação em duas etapas e passkeys opcionais, limite de tentativas de login e alertas por e-mail sobre acessos novos. Nenhum sistema é infalível: se suspeitar de acesso indevido, troque sua senha e fale conosco.',
      ],
    },
    {
      title: '9. Mudanças nesta política',
      body: [
        'Se mudarmos esta política, atualizamos a data no topo desta página. Mudanças importantes também serão avisadas por e-mail.',
      ],
    },
  ],
};

const privacyEn: LegalDocument = {
  title: 'Privacy Policy',
  intro:
    'This policy explains which personal data {appName} processes, why, for how long, and what your rights are, in line with the Brazilian General Data Protection Law (LGPD, Law 13,709/2018).',
  sections: [
    {
      title: '1. Who is responsible',
      body: [
        'The data controller is {owner}. For any privacy matter, including exercising your rights, contact {email}.',
      ],
    },
    {
      title: '2. What data we process',
      body: [
        [
          'Account data: name, email, preferred language and, if you upload one, your profile photo.',
          'Password: we only store a cryptographic digest (hash), never the password itself.',
          'Two-step verification and passkeys: the authenticator app secret (encrypted) and the public key of your passkeys. Your fingerprint, face and PIN never leave your device.',
          'Sign in with Google or Apple: your account identifier at the provider, and the email and name it shares. We never receive your Google or Apple password, nor access to your other data there.',
          'Sessions and security: IP address, browser and operating system (user agent), and sign-in and activity dates, to show your signed-in devices and alert you about new sign-ins.',
          'Activity log (audit): relevant security and administration actions, such as sign-ins and password or email changes, with date, IP and browser.',
          'Purchases and subscriptions: the plan, amount, date and payment status. You enter your card or Pix details on the payment platform’s own page; we never receive them.',
        ],
      ],
    },
    {
      title: '3. Why we use it',
      body: [
        [
          'To create and maintain your account and let you sign in (performance of contract).',
          'To protect your account and the service: detect suspicious access, limit attempts, alert you about important changes (legitimate interest and security).',
          'To send service emails: email confirmation, password reset, sign-in links and security alerts. We do not send marketing.',
          'To comply with legal obligations and requests from authorities, when required by law.',
        ],
        'We do not sell your data, do not use it for advertising and do not use third-party tracking or analytics tools.',
      ],
    },
    {
      title: '4. Who we share it with',
      body: [
        'Only with providers needed to run the service, which process data on our behalf:',
        [
          'Amazon Web Services (AWS): hosting of the system, database and files, and email delivery. Servers are located in the United States.',
          'Google and Apple: only if you choose to sign in with them.',
          'Payment platforms (Stripe, InfinitePay or AbacatePay, whichever you choose): only if you buy something. They receive your name, email and the purchase amount, and process the payment under their own policies.',
        ],
        'Because servers are in the United States, data is transferred internationally, to providers that adopt adequate security measures.',
      ],
    },
    {
      title: '5. Cookies and browser storage',
      body: [
        'We only use what is needed for the site to work:',
        [
          'One protected session cookie (httpOnly) that keeps you signed in.',
          'Preferences saved in your browser: theme (light/dark), language and a marker that a session is open.',
        ],
        'We do not use advertising or analytics cookies.',
      ],
    },
    {
      title: '6. How long we keep it',
      body: [
        [
          'Account data: while the account exists.',
          'Ended or expired sessions: up to 30 days.',
          'Activity log: up to 365 days.',
          'Deleted account: personal data is permanently erased 30 days after deletion. During that period an administrator can still restore the account if you ask.',
          'Server technical logs: up to 14 days.',
        ],
      ],
    },
    {
      title: '7. Your rights',
      body: [
        'You may, among others: confirm whether we process your data and access it; correct incomplete or outdated data; request portability; request deletion; and know who we share it with.',
        'Many of these you can do yourself under "My account": edit your profile, download all your data (Privacy → Download my data) and delete your account (Privacy → Delete account). For anything else, write to {email}.',
      ],
    },
    {
      title: '8. Security',
      body: [
        'We use encrypted connections (HTTPS), hashed passwords, encrypted secrets in the database, optional two-step verification and passkeys, sign-in attempt limits and email alerts about new sign-ins. No system is infallible: if you suspect unauthorized access, change your password and contact us.',
      ],
    },
    {
      title: '9. Changes to this policy',
      body: [
        'If we change this policy, we update the date at the top of this page. Important changes will also be announced by email.',
      ],
    },
  ],
};

const termsPt: LegalDocument = {
  title: 'Termos de Uso',
  intro:
    'Estes termos regem o uso do {appName}, disponível em {site}. Ao criar uma conta ou usar o serviço, você concorda com eles e com a Política de Privacidade.',
  sections: [
    {
      title: '1. O serviço',
      body: [
        'O {appName} é oferecido por {owner}. Podemos melhorar, mudar ou encerrar funcionalidades com o tempo; mudanças relevantes serão avisadas com antecedência razoável.',
      ],
    },
    {
      title: '2. Sua conta',
      body: [
        [
          'Informe dados verdadeiros e mantenha seu e-mail atualizado: é por ele que enviamos os avisos de segurança e a recuperação de acesso.',
          'Você é responsável por manter suas credenciais em sigilo (senha, códigos de recuperação, aparelhos com passkey) e pelo que for feito na sua conta.',
          'Se suspeitar de uso indevido, troque a senha, encerre as sessões em Segurança e fale com {email}.',
        ],
      ],
    },
    {
      title: '3. Uso aceitável',
      body: [
        'Você concorda em não:',
        [
          'violar leis ou direitos de terceiros;',
          'tentar acessar contas, dados ou partes do sistema sem autorização;',
          'sobrecarregar, atacar ou tentar burlar os mecanismos de segurança do serviço;',
          'enviar conteúdo ilegal, ofensivo ou que viole direitos de terceiros, inclusive na foto do perfil.',
        ],
      ],
    },
    {
      title: '4. Suspensão e encerramento',
      body: [
        'Podemos suspender ou encerrar contas que violem estes termos ou coloquem em risco o serviço ou outras pessoas. Você pode excluir sua conta quando quiser, em Minha conta → Privacidade; os dados são tratados como descrito na Política de Privacidade.',
      ],
    },
    {
      title: '5. Disponibilidade e responsabilidade',
      body: [
        'Trabalhamos para manter o serviço disponível e seguro, mas ele é oferecido "como está", podendo ter interrupções para manutenção ou por falhas. Na medida permitida pela lei, não nos responsabilizamos por danos indiretos decorrentes do uso ou da indisponibilidade do serviço.',
      ],
    },
    {
      title: '6. Mudanças nestes termos',
      body: [
        'Podemos atualizar estes termos. A data no topo desta página indica a versão em vigor; mudanças importantes serão avisadas por e-mail. Continuar usando o serviço depois disso significa concordar com a nova versão.',
      ],
    },
    {
      title: '7. Lei aplicável e contato',
      body: ['Estes termos seguem as leis do Brasil. Dúvidas: {email}.'],
    },
  ],
};

const termsEn: LegalDocument = {
  title: 'Terms of Service',
  intro:
    'These terms govern the use of {appName}, available at {site}. By creating an account or using the service, you agree to them and to the Privacy Policy.',
  sections: [
    {
      title: '1. The service',
      body: [
        '{appName} is provided by {owner}. We may improve, change or discontinue features over time; relevant changes will be announced with reasonable notice.',
      ],
    },
    {
      title: '2. Your account',
      body: [
        [
          'Provide accurate information and keep your email up to date: it is where we send security alerts and access recovery.',
          'You are responsible for keeping your credentials secret (password, recovery codes, devices with passkeys) and for what is done in your account.',
          'If you suspect misuse, change your password, sign out your devices under Security and contact {email}.',
        ],
      ],
    },
    {
      title: '3. Acceptable use',
      body: [
        'You agree not to:',
        [
          'break the law or infringe the rights of others;',
          'try to access accounts, data or parts of the system without authorization;',
          'overload or attack the service, or try to bypass its security mechanisms;',
          'upload illegal or offensive content, or content that infringes the rights of others, including in your profile photo.',
        ],
      ],
    },
    {
      title: '4. Suspension and termination',
      body: [
        'We may suspend or close accounts that break these terms or put the service or other people at risk. You can delete your account at any time under My account → Privacy; your data is handled as described in the Privacy Policy.',
      ],
    },
    {
      title: '5. Availability and liability',
      body: [
        'We work to keep the service available and secure, but it is provided "as is" and may be interrupted for maintenance or because of failures. To the extent permitted by law, we are not liable for indirect damages arising from the use or unavailability of the service.',
      ],
    },
    {
      title: '6. Changes to these terms',
      body: [
        'We may update these terms. The date at the top of this page shows the version in force; important changes will be announced by email. Continuing to use the service afterwards means you accept the new version.',
      ],
    },
    {
      title: '7. Governing law and contact',
      body: ['These terms are governed by the laws of Brazil. Questions: {email}.'],
    },
  ],
};

export const LEGAL: Record<'privacy' | 'terms', Record<Language, LegalDocument>> = {
  privacy: { 'pt-BR': privacyPt, en: privacyEn },
  terms: { 'pt-BR': termsPt, en: termsEn },
};
