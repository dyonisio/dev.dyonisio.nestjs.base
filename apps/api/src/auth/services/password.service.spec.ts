import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Role } from '../../common/enums/role.enum';
import { MailService } from '../../mail/mail.service';
import { User } from '../../users/entities/user.entity';
import { UsersService } from '../../users/users.service';
import { AuditAction } from '../../audit/audit-action.enum';
import { AuditService } from '../../audit/audit.service';
import { PasswordService } from './password.service';
import { SessionService } from '../../sessions/session.service';
import { ReauthService } from '../../users/account/reauth.service';
import { UserIdentity } from '../social/entities/user-identity.entity';

const SECRET = 'segredo-de-teste-com-tamanho-suficiente';

describe('PasswordService', () => {
  let service: PasswordService;
  let storedUser: User;

  const usersService = {
    findByEmailWithPassword: jest.fn(),
    findByIdWithPassword: jest.fn(),
    updatePassword: jest.fn(),
  };
  const sessionService = { revokeAllForUser: jest.fn(), create: jest.fn() };
  const mailService = { sendForgotPassword: jest.fn(), sendPasswordChanged: jest.fn() };
  const audit = { record: jest.fn() };
  const config: Record<string, unknown> = {
    'jwt.secret': SECRET,
    'jwt.resetPasswordExpiresIn': 900,
    'app.frontendUrl': 'http://front.test',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    storedUser = Object.assign(new User(), {
      id: 'user-1',
      name: 'Maria',
      email: 'maria@test.com',
      role: Role.USER,
      isActive: true,
      password: await bcrypt.hash('Senha123', 4),
    });
    usersService.findByEmailWithPassword.mockImplementation(() =>
      Promise.resolve({ ...storedUser }),
    );
    usersService.findByIdWithPassword.mockImplementation(() => Promise.resolve({ ...storedUser }));
    usersService.updatePassword.mockImplementation(async (_id: string, pwd: string) => {
      storedUser.password = await bcrypt.hash(pwd, 4);
    });

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: SECRET })],
      providers: [
        PasswordService,
        { provide: UsersService, useValue: usersService },
        { provide: SessionService, useValue: sessionService },
        { provide: MailService, useValue: mailService },
        { provide: AuditService, useValue: audit },
        { provide: ReauthService, useValue: { confirm: jest.fn() } },
        // sem vínculo com Google/Apple: a primeira senha é de uma conta convidada
        {
          provide: getRepositoryToken(UserIdentity),
          useValue: { count: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, def?: unknown) => config[key] ?? def,
            getOrThrow: (key: string) => config[key],
          },
        },
      ],
    }).compile();

    service = moduleRef.get(PasswordService);
  });

  const requestResetToken = async () => {
    await service.forgot('maria@test.com');
    const resetUrl: string = mailService.sendForgotPassword.mock.calls[0][1];
    return new URL(resetUrl).searchParams.get('token')!;
  };

  describe('forgot', () => {
    it('não faz nada (nem revela) quando o e-mail não existe', async () => {
      usersService.findByEmailWithPassword.mockResolvedValueOnce(null);
      await expect(service.forgot('nao@existe.com')).resolves.toBeUndefined();
      expect(mailService.sendForgotPassword).not.toHaveBeenCalled();
    });

    it('envia o link de redefinição apontando para o frontend', async () => {
      await service.forgot('maria@test.com');
      expect(mailService.sendForgotPassword).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'maria@test.com' }),
        expect.stringMatching(/^http:\/\/front\.test\/reset-password\?token=/),
        15,
      );
    });
  });

  describe('reset', () => {
    it('redefine a senha, derruba as sessões e notifica por e-mail', async () => {
      const token = await requestResetToken();

      await service.reset(token, 'NovaSenha123');

      expect(usersService.updatePassword).toHaveBeenCalledWith('user-1', 'NovaSenha123');
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith('user-1');
      expect(mailService.sendPasswordChanged).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(AuditAction.AUTH_PASSWORD_RESET, {
        actorId: 'user-1',
      });
    });

    it('o token é de uso único (invalida após a troca de senha)', async () => {
      const token = await requestResetToken();
      await service.reset(token, 'NovaSenha123');

      await expect(service.reset(token, 'OutraSenha123')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejeita token malformado', async () => {
      await expect(service.reset('lixo', 'NovaSenha123')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('change', () => {
    it('troca a senha, derruba as outras sessões e devolve novos tokens', async () => {
      sessionService.create.mockResolvedValue({ accessToken: 'novo' });

      const result = await service.change('user-1', 'Senha123', 'NovaSenha123');

      expect(usersService.updatePassword).toHaveBeenCalledWith('user-1', 'NovaSenha123');
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith('user-1');
      expect(mailService.sendPasswordChanged).toHaveBeenCalled();
      expect(result).toEqual({ accessToken: 'novo' });
      expect(audit.record).toHaveBeenCalledWith(AuditAction.AUTH_PASSWORD_CHANGED, {
        actorId: 'user-1',
      });
    });

    it('lança 400 quando a senha atual está errada', async () => {
      await expect(service.change('user-1', 'errada', 'NovaSenha123')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(usersService.updatePassword).not.toHaveBeenCalled();
    });
  });
});
