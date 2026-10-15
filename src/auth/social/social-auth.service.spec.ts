import { Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { UsersService } from '../../users/users.service';
import { AuthService } from '../services/auth.service';
import { UserIdentity } from './entities/user-identity.entity';
import { JwksResolver, OidcVerifier, SocialProfile } from './oidc-verifier.service';
import { SocialAuthService } from './social-auth.service';

/** Fluxos felizes e de segurança estão no e2e; aqui, ramos difíceis de provocar por HTTP. */
describe('SocialAuthService', () => {
  const profile: SocialProfile = {
    provider: 'google',
    subject: 'g-1',
    email: 'ana@x.com',
    emailVerified: true,
  };
  const identities = {
    findOne: jest.fn(),
    delete: jest.fn(),
    save: jest.fn(),
    create: jest.fn((x) => x),
  };
  const verifier = { verify: jest.fn() };
  const users = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    createFromProvider: jest.fn(),
    markEmailVerified: jest.fn(),
    claimUnverifiedAccount: jest.fn(),
  };
  const auth = { completeLogin: jest.fn().mockResolvedValue({ accessToken: 't' }) };
  const mail = { sendWelcome: jest.fn(), sendSocialLinked: jest.fn() };
  const audit = { record: jest.fn() };
  const service = new SocialAuthService(
    identities as unknown as Repository<UserIdentity>,
    verifier as unknown as OidcVerifier,
    users as unknown as UsersService,
    auth as unknown as AuthService,
    mail as unknown as MailService,
    audit as unknown as AuditService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    verifier.verify.mockResolvedValue(profile);
  });

  it('vínculo de uma conta excluída (soft delete) é descartado e o login segue como novo', async () => {
    identities.findOne.mockResolvedValue({ id: 'velho', user: null });
    users.findByEmail.mockResolvedValue(null);
    users.createFromProvider.mockResolvedValue({ id: 'novo', isActive: true });

    await service.login('google', { idToken: 't' });

    expect(identities.delete).toHaveBeenCalledWith('velho');
    expect(users.createFromProvider).toHaveBeenCalled();
  });

  it('conta vinculada mas desativada -> 401', async () => {
    identities.findOne.mockResolvedValue({ id: 'i', user: { id: 'u', isActive: false } });
    await expect(service.login('google', { idToken: 't' })).rejects.toThrow('auth.userInactive');
    expect(auth.completeLogin).not.toHaveBeenCalled();
  });

  it('provedor sem e-mail -> 400', async () => {
    identities.findOne.mockResolvedValue(null);
    verifier.verify.mockResolvedValue({ ...profile, email: undefined });
    await expect(service.login('google', { idToken: 't' })).rejects.toThrow('social.emailRequired');
  });

  it('conta existente NUNCA confirmada: o dono do e-mail a assume (senha, 2FA e sessões de quem a criou caem)', async () => {
    identities.findOne.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue({ id: 'u', emailVerifiedAt: null });
    users.findById.mockResolvedValue({ id: 'u', isActive: true });

    await service.login('google', { idToken: 't' });

    expect(users.claimUnverifiedAccount).toHaveBeenCalledWith('u');
    expect(mail.sendSocialLinked).not.toHaveBeenCalled();
  });

  it('conta existente confirmada: vincula sem mexer na senha e avisa o dono por e-mail', async () => {
    identities.findOne.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue({ id: 'u', emailVerifiedAt: new Date() });
    users.findById.mockResolvedValue({ id: 'u', isActive: true });

    await service.login('google', { idToken: 't' });

    expect(users.claimUnverifiedAccount).not.toHaveBeenCalled();
    expect(mail.sendSocialLinked).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u' }),
      'google',
    );
  });

  it('nome vindo do provedor é limpo (sem links ou símbolos)', async () => {
    identities.findOne.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue(null);
    users.createFromProvider.mockResolvedValue({ id: 'n', isActive: true });
    verifier.verify.mockResolvedValue({ ...profile, name: 'Ana <b>http://evil.com</b> 123' });

    await service.login('google', { idToken: 't' });

    expect(users.createFromProvider).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ana b http evil com b' }),
    );
  });

  it('conta nova sem nome no token nem no corpo: usa o começo do e-mail', async () => {
    identities.findOne.mockResolvedValue(null);
    users.findByEmail.mockResolvedValue(null);
    users.createFromProvider.mockResolvedValue({ id: 'n', isActive: true });

    await service.login('google', { idToken: 't' });

    expect(users.createFromProvider).toHaveBeenCalledWith({
      name: 'ana',
      email: 'ana@x.com',
      locale: undefined,
    });
  });
});

describe('JwksResolver', () => {
  it('reaproveita o mesmo conjunto de chaves por URL (cache)', () => {
    const resolver = new JwksResolver();
    const a = resolver.resolve('https://www.googleapis.com/oauth2/v3/certs');
    expect(resolver.resolve('https://www.googleapis.com/oauth2/v3/certs')).toBe(a);
    expect(resolver.resolve('https://appleid.apple.com/auth/keys')).not.toBe(a);
  });
});
