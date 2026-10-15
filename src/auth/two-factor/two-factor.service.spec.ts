import {
  BadRequestException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { MailService } from '../../mail/mail.service';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { DatabaseThrottlerStorage } from '../../rate-limit/database-throttler.storage';
import { User } from '../../users/entities/user.entity';
import { base32Decode, currentStep, generateTotpSecret, hotp } from './totp';
import { TwoFactorService } from './two-factor.service';

/**
 * Os fluxos completos estão no e2e (test/two-factor.e2e-spec.ts). Aqui, os ramos de erro
 * e de segurança que são difíceis de provocar por HTTP.
 */
describe('TwoFactorService', () => {
  const SECRET = 'segredo-de-teste-com-tamanho-suficiente';
  const config = {
    get: (_k: string, d?: unknown) => d,
    getOrThrow: () => SECRET,
  } as unknown as ConfigService;
  const encryption = new EncryptionService({
    get: () => 'chave',
    getOrThrow: () => SECRET,
  } as unknown as ConfigService);
  const jwt = new JwtService({ secret: SECRET });

  let stored: Partial<User>;
  let service: TwoFactorService;
  /** Simula os updates condicionais (atômicos) do serviço sobre o usuário em memória. */
  const conditionalUpdate = (data: Partial<User>) => ({
    where: () => ({
      andWhere: (condition: string, params: { step?: number; current?: string }) => ({
        execute: () => {
          const ok = condition.includes('twoFactorLastStep')
            ? stored.twoFactorLastStep == null || stored.twoFactorLastStep < params.step!
            : JSON.stringify(stored.twoFactorRecoveryCodes) === params.current;
          if (ok) Object.assign(stored, data);
          return Promise.resolve({ affected: ok ? 1 : 0 });
        },
      }),
    }),
  });
  const repo = {
    createQueryBuilder: () => ({
      addSelect: () => ({
        where: () => ({ getOneOrFail: () => Promise.resolve({ ...stored }) }),
      }),
      update: () => ({ set: conditionalUpdate }),
    }),
    update: jest.fn((_id: string, data: Partial<User>) => {
      Object.assign(stored, data);
      return Promise.resolve();
    }),
    findOne: jest.fn(() => Promise.resolve(stored.id ? { ...stored } : null)),
  };
  const attempts = { increment: jest.fn() };
  const audit = { record: jest.fn() };
  const mail = { sendTwoFactorChanged: jest.fn() };

  const totpSecret = generateTotpSecret();
  const codeAt = (offset = 0) => hotp(base32Decode(totpSecret), currentStep() + offset);
  const enabledUser = (extra: Partial<User> = {}): Partial<User> => ({
    id: 'u1',
    email: 'ana@test.com',
    isActive: true,
    twoFactorEnabledAt: new Date(),
    twoFactorSecret: encryption.encrypt(totpSecret),
    twoFactorLastStep: null,
    twoFactorRecoveryCodes: [],
    ...extra,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    attempts.increment.mockResolvedValue({ isBlocked: false, timeToExpire: 900 });
    stored = enabledUser();
    service = new TwoFactorService(
      repo as unknown as Repository<User>,
      encryption,
      jwt,
      config,
      attempts as unknown as DatabaseThrottlerStorage,
      audit as unknown as AuditService,
      mail as unknown as MailService,
    );
  });

  describe('ativação', () => {
    it('setup com 2FA já ativo -> 400', async () => {
      await expect(service.setup('u1')).rejects.toThrow('twoFactor.alreadyEnabled');
    });

    it('enable sem ter feito o setup -> 400', async () => {
      stored = { id: 'u1', twoFactorEnabledAt: null, twoFactorSecret: null };
      await expect(service.enable('u1', '123456')).rejects.toThrow('twoFactor.notSetUp');
    });

    it('enable com 2FA já ativo -> 400', async () => {
      await expect(service.enable('u1', codeAt())).rejects.toThrow('twoFactor.alreadyEnabled');
    });

    it('o segredo é guardado cifrado, nunca em texto puro', async () => {
      stored = { id: 'u1', email: 'ana@test.com', twoFactorEnabledAt: null };
      const { secret } = await service.setup('u1');

      expect(stored.twoFactorSecret).not.toContain(secret);
      expect(encryption.decrypt(stored.twoFactorSecret!)).toBe(secret);
    });
  });

  describe('verificação de código', () => {
    it('2FA não ativo -> 400', async () => {
      stored = enabledUser({ twoFactorEnabledAt: null });
      await expect(service.disable('u1', codeAt())).rejects.toThrow('twoFactor.notEnabled');
    });

    it('limite de tentativas por usuário estourado -> 429 (antes de conferir o código)', async () => {
      attempts.increment.mockResolvedValueOnce({ isBlocked: true, timeToExpire: 120 });

      const error = await service.disable('u1', codeAt()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
      expect(stored.twoFactorEnabledAt).not.toBeNull(); // nada mudou
    });

    it('anti-replay: código de uma janela já usada (ou anterior) é recusado', async () => {
      stored = enabledUser({ twoFactorLastStep: currentStep() });
      await expect(service.disable('u1', codeAt(0))).rejects.toThrow('twoFactor.invalidCode');
      await expect(service.disable('u1', codeAt(-1))).rejects.toThrow('twoFactor.invalidCode');
    });

    it('código errado é auditado como falha', async () => {
      await expect(service.disable('u1', '000000')).rejects.toBeInstanceOf(BadRequestException);
      expect(audit.record).toHaveBeenCalledWith('auth.2fa_failed', { actorId: 'u1' });
    });

    it('gerar novos códigos de recuperação exige o app (código de recuperação não serve)', async () => {
      const { recoveryCodes } = await service.regenerateRecoveryCodes('u1', codeAt());
      stored.twoFactorLastStep = null;

      await expect(service.regenerateRecoveryCodes('u1', recoveryCodes[0])).rejects.toThrow(
        'twoFactor.invalidCode',
      );
    });
  });

  describe('desafio do login', () => {
    it('token com outra finalidade (ex.: assinado para outro uso) -> 401', async () => {
      const wrong = await jwt.signAsync(
        { sub: 'u1', purpose: 'reset-password' },
        { secret: `${SECRET}.2fa-login` },
      );
      await expect(service.completeChallenge(wrong, codeAt())).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('usuário desativado entre a senha e o código -> 401', async () => {
      const { twoFactorToken } = await service.createChallenge(stored as User, 'password');
      repo.findOne.mockResolvedValueOnce({ ...stored, isActive: false });

      await expect(service.completeChallenge(twoFactorToken, codeAt())).rejects.toThrow(
        'auth.userInactive',
      );
    });

    it('devolve o método de login original (ex.: google) para a auditoria', async () => {
      const { twoFactorToken } = await service.createChallenge(stored as User, 'google');
      await expect(service.completeChallenge(twoFactorToken, codeAt())).resolves.toMatchObject({
        method: 'google',
        usedRecoveryCode: false,
      });
    });
  });

  it('dois usos simultâneos do mesmo código de recuperação: só um passa', async () => {
    const { recoveryCodes } = await service.regenerateRecoveryCodes('u1', codeAt());
    const results = await Promise.allSettled([
      service.disable('u1', recoveryCodes[0]),
      service.disable('u1', recoveryCodes[0]),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('reset pelo admin avisa o usuário por e-mail', async () => {
    await service.adminReset('u1');
    expect(mail.sendTwoFactorChanged).toHaveBeenCalledWith(expect.anything(), false, {
      byAdmin: true,
    });
  });

  it('reset pelo admin: usuário inexistente -> 404', async () => {
    stored = {};
    const error = await service.adminReset('nao-existe').catch((e: unknown) => e);
    expect((error as HttpException).getStatus()).toBe(new NotFoundException().getStatus());
  });
});
