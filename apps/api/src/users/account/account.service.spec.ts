import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { Passkey } from '../../auth/passkeys/entities/passkey.entity';
import { UserIdentity } from '../../auth/social/entities/user-identity.entity';
import { Role } from '../../common/enums/role.enum';
import { FilesService } from '../../files/files.service';
import { MailService } from '../../mail/mail.service';
import { SessionService } from '../../sessions/session.service';
import { EmailVerificationService } from '../email-verification.service';
import { User } from '../entities/user.entity';
import { UsersService } from '../users.service';
import { AccountService } from './account.service';
import { ReauthService } from './reauth.service';

/** Os fluxos completos (HTTP + banco) estão em test/account.e2e-spec.ts. */
describe('AccountService', () => {
  const repo = { exists: jest.fn(), count: jest.fn(), softDelete: jest.fn() };
  const identities = { find: jest.fn() };
  const passkeys = { find: jest.fn() };
  const users = { getById: jest.fn(), findByIdWithPassword: jest.fn() };
  const reauth = { confirm: jest.fn() };
  const emailVerification = { requestChange: jest.fn() };
  const sessions = { listAllForUser: jest.fn(), revokeAllForUser: jest.fn() };
  const files = { listForOwner: jest.fn() };
  const audit = { listForUser: jest.fn(), record: jest.fn() };
  const mail = { sendAccountDeleted: jest.fn() };
  const service = new AccountService(
    repo as unknown as Repository<User>,
    identities as unknown as Repository<UserIdentity>,
    passkeys as unknown as Repository<Passkey>,
    users as unknown as UsersService,
    reauth as unknown as ReauthService,
    emailVerification as unknown as EmailVerificationService,
    sessions as unknown as SessionService,
    files as unknown as FilesService,
    audit as unknown as AuditService,
    mail as unknown as MailService,
    { get: (_k: string, d: unknown) => d } as unknown as ConfigService,
  );
  const user = { id: 'u', email: 'ana@x.com', role: Role.USER } as User;

  beforeEach(() => {
    jest.clearAllMocks();
    reauth.confirm.mockResolvedValue(user);
  });

  describe('changeEmail', () => {
    it('mesmo e-mail -> 400; e-mail de outra conta -> 409 (só depois de confirmar a identidade)', async () => {
      await expect(service.changeEmail('u', { newEmail: 'ana@x.com' })).rejects.toThrow(
        'users.sameEmail',
      );
      repo.exists.mockResolvedValue(true);
      await expect(service.changeEmail('u', { newEmail: 'bia@x.com' })).rejects.toThrow(
        'users.emailTaken',
      );
      expect(reauth.confirm).toHaveBeenCalledTimes(2);
      expect(emailVerification.requestChange).not.toHaveBeenCalled();
    });

    it('e-mail livre: pede a confirmação do endereço novo', async () => {
      repo.exists.mockResolvedValue(false);
      await expect(service.changeEmail('u', { newEmail: 'nova@x.com' })).resolves.toBe(
        'nova@x.com',
      );
      expect(emailVerification.requestChange).toHaveBeenCalledWith(user, 'nova@x.com');
    });
  });

  describe('deleteAccount', () => {
    it('admin pode se excluir se houver outro admin ativo', async () => {
      reauth.confirm.mockResolvedValue({ ...user, role: Role.ADMIN });
      repo.count.mockResolvedValue(1);
      await service.deleteAccount('u', {});
      expect(repo.softDelete).toHaveBeenCalledWith('u');
      expect(mail.sendAccountDeleted).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u' }),
        expect.any(Date),
      );
    });

    it('identidade não confirmada: nada é excluído', async () => {
      reauth.confirm.mockRejectedValue(new Error('password.wrongCurrentPassword'));
      await expect(service.deleteAccount('u', {})).rejects.toThrow();
      expect(repo.softDelete).not.toHaveBeenCalled();
    });
  });

  it('exportData: junta tudo, só com campos seguros, e audita', async () => {
    const at = new Date();
    users.getById.mockResolvedValue(Object.assign(new User(), user, { twoFactorEnabledAt: at }));
    users.findByIdWithPassword.mockResolvedValue({ password: 'hash' });
    identities.find.mockResolvedValue([
      { provider: 'google', email: 'ana@gmail.com', createdAt: at, providerUserId: 'segredo' },
    ]);
    passkeys.find.mockResolvedValue([
      { name: 'iPhone', createdAt: at, lastUsedAt: null, publicKey: 'chave', credentialId: 'cred' },
    ]);
    sessions.listAllForUser.mockResolvedValue([
      { userAgent: 'Chrome', ip: '1.1.1.1', createdAt: at, tokens: ['x'] },
    ]);
    files.listForOwner.mockResolvedValue([
      { id: 'f', purpose: 'avatar', contentType: 'image/png', size: 1, status: 'ready', key: 'k' },
    ]);
    audit.listForUser.mockResolvedValue([{ action: 'auth.login', createdAt: at, requestId: 'r' }]);

    const data = await service.exportData('u');

    expect(data.security).toEqual({
      hasPassword: true,
      twoFactorEnabled: true,
      identities: [{ provider: 'google', email: 'ana@gmail.com', createdAt: at }],
      passkeys: [{ name: 'iPhone', createdAt: at, lastUsedAt: null }],
    });
    expect(data.sessions[0]).toMatchObject({ userAgent: 'Chrome', ip: '1.1.1.1' });
    expect(data.sessions[0]).not.toHaveProperty('tokens');
    expect(data.files[0]).not.toHaveProperty('key');
    expect(data.activity[0]).toMatchObject({ action: 'auth.login' });
    expect(JSON.stringify(data)).not.toContain('hash');
    expect(JSON.stringify(data)).not.toContain('chave');
    expect(audit.record).toHaveBeenCalledWith('user.data_exported', { actorId: 'u' });
  });
});
