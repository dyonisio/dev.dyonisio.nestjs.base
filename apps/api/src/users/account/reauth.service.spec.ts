import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PasskeyVerifier } from '../../auth/passkeys/passkey-verifier.service';
import { TwoFactorService } from '../../auth/two-factor/two-factor.service';
import { RequestContext } from '../../common/request-context/request-context';
import { DatabaseThrottlerStorage } from '../../rate-limit/database-throttler.storage';
import { SessionService } from '../../sessions/session.service';
import { UsersService } from '../users.service';
import { ReauthService } from './reauth.service';

/** Os casos com senha estão no e2e (account, email-verification, two-factor). */
describe('ReauthService', () => {
  const users = { findByIdWithPassword: jest.fn() };
  const sessions = { findById: jest.fn() };
  const twoFactor = { verifyCode: jest.fn() };
  const attempts = { increment: jest.fn() };
  const passkeys = { confirmReauth: jest.fn() };
  const service = new ReauthService(
    users as unknown as UsersService,
    sessions as unknown as SessionService,
    twoFactor as unknown as TwoFactorService,
    attempts as unknown as DatabaseThrottlerStorage,
    { get: (_k: string, d: unknown) => d } as unknown as ConfigService,
    passkeys as unknown as PasskeyVerifier,
  );
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(RequestContext, 'get').mockReturnValue({ sessionId: 's1' } as never);
    attempts.increment.mockResolvedValue({ isBlocked: false, timeToExpire: 900 });
  });
  afterAll(() => jest.restoreAllMocks());

  it('usuário não encontrado -> 401', async () => {
    users.findByIdWithPassword.mockResolvedValue(null);
    await expect(service.confirm('u', {})).rejects.toThrow('auth.sessionExpired');
  });

  describe('conta sem senha (só login social)', () => {
    beforeEach(() => users.findByIdWithPassword.mockResolvedValue({ id: 'u', password: null }));

    it('login recente (dentro de REAUTH_WINDOW_SECONDS): confirmado', async () => {
      sessions.findById.mockResolvedValue({ createdAt: minutesAgo(2) });
      await expect(service.confirm('u', {})).resolves.toMatchObject({ id: 'u' });
    });

    it('login antigo ou sessão desconhecida: pede para entrar de novo (401)', async () => {
      sessions.findById.mockResolvedValue({ createdAt: minutesAgo(30) });
      await expect(service.confirm('u', {})).rejects.toThrow('account.reauthRequired');
      sessions.findById.mockResolvedValue(null);
      await expect(service.confirm('u', {})).rejects.toThrow('account.reauthRequired');
    });
  });

  describe('com 2FA', () => {
    beforeEach(() => {
      users.findByIdWithPassword.mockResolvedValue({
        id: 'u',
        password: null,
        twoFactorEnabledAt: new Date(),
      });
      sessions.findById.mockResolvedValue({ createdAt: minutesAgo(1) });
    });

    it('exige o código', async () => {
      await expect(service.confirm('u', {})).rejects.toThrow('twoFactor.codeRequired');
      await service.confirm('u', { code: '123456' });
      expect(twoFactor.verifyCode).toHaveBeenCalledWith('u', '123456');
    });

    it('skipTwoFactor (ex.: ativar o 2FA) não pede código', async () => {
      await service.confirm('u', {}, { skipTwoFactor: true });
      expect(twoFactor.verifyCode).not.toHaveBeenCalled();
    });
  });

  it('muitas tentativas de senha por usuário -> 429 (antes de conferir a senha)', async () => {
    users.findByIdWithPassword.mockResolvedValue({ id: 'u', password: 'hash' });
    attempts.increment.mockResolvedValue({ isBlocked: true, timeToExpire: 60 });
    const error = await service.confirm('u', { currentPassword: 'x' }).catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(429);
  });
});
