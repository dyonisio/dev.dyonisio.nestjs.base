import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { Role } from '../../common/enums/role.enum';
import { User } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';
import { AuditAction } from '../../audit/audit-action.enum';
import { AuditService } from '../../audit/audit.service';
import { AuthService } from './auth.service';
import { SessionService } from '../../sessions/session.service';
import { AuthResponseDto } from '../dto/auth-response.dto';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { MailService } from '../../mail/mail.service';

describe('AuthService', () => {
  let service: AuthService;
  let storedUser: User;

  const tokens = {
    accessToken: 'access',
    refreshToken: 'refresh',
    tokenType: 'Bearer' as const,
    expiresIn: 900,
    refreshExpiresIn: 3600,
  };
  const usersService = { findByEmailWithPassword: jest.fn() };
  const sessionService = {
    create: jest.fn().mockResolvedValue(tokens),
    refresh: jest.fn(),
    revoke: jest.fn(),
    isNewDevice: jest.fn().mockResolvedValue(false),
  };
  const mail = { sendNewLogin: jest.fn() };
  const audit = { record: jest.fn() };
  const challenge = { twoFactorRequired: true as const, twoFactorToken: 'tfa', expiresIn: 300 };
  const twoFactor = {
    createChallenge: jest.fn().mockResolvedValue(challenge),
    completeChallenge: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    storedUser = Object.assign(new User(), {
      id: 'user-1',
      email: 'maria@test.com',
      role: Role.USER,
      isActive: true,
      password: await bcrypt.hash('Senha123', 4),
    });
    usersService.findByEmailWithPassword.mockImplementation(() =>
      Promise.resolve({ ...storedUser }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: SessionService, useValue: sessionService },
        { provide: AuditService, useValue: audit },
        { provide: TwoFactorService, useValue: twoFactor },
        { provide: MailService, useValue: mail },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('login', () => {
    it('login de um dispositivo novo: avisa o dono por e-mail e marca na auditoria', async () => {
      sessionService.isNewDevice.mockResolvedValueOnce(true);
      await service.login({ email: 'maria@test.com', password: 'Senha123' });

      expect(mail.sendNewLogin).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), {
        description: 'Unknown device',
        ip: null,
      });
      expect(audit.record).toHaveBeenCalledWith(AuditAction.AUTH_LOGIN, {
        actorId: 'user-1',
        metadata: { method: 'password', newDevice: true },
      });
    });

    it('dispositivo conhecido: sem e-mail', async () => {
      await service.login({ email: 'maria@test.com', password: 'Senha123' });
      expect(mail.sendNewLogin).not.toHaveBeenCalled();
    });

    it('abre uma sessão e retorna os tokens e o usuário sem o hash da senha', async () => {
      const result = (await service.login({
        email: 'maria@test.com',
        password: 'Senha123',
      })) as AuthResponseDto;

      expect(sessionService.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }));
      expect(result).toMatchObject(tokens);
      expect(result.user.password).toBeUndefined();
      expect(audit.record).toHaveBeenCalledWith(AuditAction.AUTH_LOGIN, {
        actorId: 'user-1',
        metadata: { method: 'password' },
      });
    });

    it('com 2FA ativo: senha certa NÃO abre sessão — devolve o desafio do segundo passo', async () => {
      storedUser.twoFactorEnabledAt = new Date();

      const result = await service.login({ email: 'maria@test.com', password: 'Senha123' });

      expect(result).toEqual(challenge);
      expect(twoFactor.createChallenge).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' }),
        'password',
      );
      expect(sessionService.create).not.toHaveBeenCalled();
    });

    it.each([
      ['e-mail inexistente', null, 'Senha123', 'unknown_email'],
      ['senha errada', 'user', 'errada', 'wrong_password'],
    ])('falha (%s) é auditada com o motivo', async (_, exists, password, reason) => {
      if (!exists) usersService.findByEmailWithPassword.mockResolvedValueOnce(null);

      await expect(service.login({ email: 'maria@test.com', password })).rejects.toThrow();

      expect(audit.record).toHaveBeenCalledWith(AuditAction.AUTH_LOGIN_FAILED, {
        actorId: exists ? 'user-1' : null,
        metadata: { email: 'maria@test.com', reason },
      });
    });

    it('lança 401 com senha errada (sem abrir sessão)', async () => {
      await expect(
        service.login({ email: 'maria@test.com', password: 'errada' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessionService.create).not.toHaveBeenCalled();
    });

    it('lança 401 se o usuário não existe', async () => {
      usersService.findByEmailWithPassword.mockResolvedValueOnce(null);
      await expect(
        service.login({ email: 'x@test.com', password: 'Senha123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('lança 401 se o usuário está inativo', async () => {
      storedUser.isActive = false;
      await expect(
        service.login({ email: 'maria@test.com', password: 'Senha123' }),
      ).rejects.toThrow('auth.userInactive');
    });
  });

  describe('verifyTwoFactor (segundo passo)', () => {
    it('código certo abre a sessão e audita o login com o método usado', async () => {
      twoFactor.completeChallenge.mockResolvedValue({
        user: storedUser,
        method: 'google',
        usedRecoveryCode: true,
      });

      const result = await service.verifyTwoFactor('tfa', 'ABCD-EFGH');

      expect(twoFactor.completeChallenge).toHaveBeenCalledWith('tfa', 'ABCD-EFGH');
      expect(result).toMatchObject(tokens);
      expect(audit.record).toHaveBeenCalledWith(AuditAction.AUTH_LOGIN, {
        actorId: 'user-1',
        metadata: { method: 'google', twoFactor: 'recovery' },
      });
    });

    it('código errado: o erro do serviço de 2FA sobe e nenhuma sessão é aberta', async () => {
      twoFactor.completeChallenge.mockRejectedValue(new UnauthorizedException());

      await expect(service.verifyTwoFactor('tfa', '000000')).rejects.toThrow(UnauthorizedException);
      expect(sessionService.create).not.toHaveBeenCalled();
    });
  });

  it('refresh delega a rotação ao SessionService e devolve tokens + usuário', async () => {
    sessionService.refresh.mockResolvedValue({ user: storedUser, tokens });

    const result = await service.refresh('refresh-antigo');

    expect(sessionService.refresh).toHaveBeenCalledWith('refresh-antigo');
    expect(result).toEqual({ ...tokens, user: storedUser });
  });

  it('logout revoga a sessão do refresh token e audita', async () => {
    sessionService.revoke.mockResolvedValueOnce('user-1');
    await service.logout('refresh');

    expect(sessionService.revoke).toHaveBeenCalledWith('refresh');
    expect(audit.record).toHaveBeenCalledWith(AuditAction.AUTH_LOGOUT, { actorId: 'user-1' });
  });

  it('logout com token desconhecido não audita', async () => {
    sessionService.revoke.mockResolvedValueOnce(null);
    await service.logout('lixo');
    expect(audit.record).not.toHaveBeenCalled();
  });
});
