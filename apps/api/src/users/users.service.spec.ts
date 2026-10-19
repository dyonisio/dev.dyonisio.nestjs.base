import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { Role } from '../common/enums/role.enum';
import { MailService } from '../mail/mail.service';
import { SessionRevokeReason } from '../sessions/entities/session.entity';
import { SessionService } from '../sessions/session.service';
import { FilesService } from '../files/files.service';
import { EmailVerificationService } from './email-verification.service';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

const makeUser = (overrides: Partial<User> = {}): User =>
  Object.assign(new User(), {
    id: 'user-1',
    name: 'Maria',
    email: 'maria@test.com',
    role: Role.USER,
    isActive: true,
    deletedAt: null,
    ...overrides,
  });

/**
 * Busca, ordenação e paginação (findAll) são testadas nos e2e, contra banco real
 * (SQLite e Postgres) — é onde o SQL realmente importa.
 */
describe('UsersService', () => {
  let service: UsersService;
  const repo = {
    findOne: jest.fn(),
    exists: jest.fn(),
    create: jest.fn((data: Partial<User>) => Object.assign(new User(), data)),
    // simula o banco gerando o id (campos de classe já nascem como undefined com target ES2022)
    save: jest.fn((user: User) =>
      Promise.resolve(Object.assign(user, { id: user.id ?? 'user-1' })),
    ),
    update: jest.fn(),
    softRemove: jest.fn(),
    restore: jest.fn(),
  };
  const mailService = { sendRoleChanged: jest.fn(), sendEmailChanged: jest.fn() };
  const emailVerification = { send: jest.fn(), requestChange: jest.fn() };
  const sessions = { revokeAllForUser: jest.fn() };
  const audit = { record: jest.fn() };
  const files = {
    consume: jest.fn(),
    publicUrl: jest.fn().mockReturnValue('https://cdn/public/avatar/u/novo.png'),
    removeById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
        { provide: MailService, useValue: mailService },
        { provide: EmailVerificationService, useValue: emailVerification },
        { provide: SessionService, useValue: sessions },
        { provide: AuditService, useValue: audit },
        { provide: FilesService, useValue: files },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  describe('create', () => {
    it('normaliza o e-mail, aplica role padrão, faz hash da senha e audita', async () => {
      repo.exists.mockResolvedValue(false);

      const user = await service.create({
        name: 'Maria',
        email: '  Maria@Test.com ',
        password: 'Senha123',
      });

      expect(user.email).toBe('maria@test.com');
      expect(user.role).toBe(Role.USER);
      expect(await bcrypt.compare('Senha123', user.password!)).toBe(true);
      expect(audit.record).toHaveBeenCalledWith(AuditAction.USER_CREATED, {
        target: { type: 'user', id: 'user-1' },
        metadata: { email: 'maria@test.com', role: Role.USER },
      });
    });

    it('lança 409 se o e-mail já existir', async () => {
      repo.exists.mockResolvedValue(true);
      await expect(
        service.create({ name: 'Maria', email: 'maria@test.com', password: 'Senha123' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('cria não verificado por padrão e verificado quando informado (admin)', async () => {
      repo.exists.mockResolvedValue(false);
      const dto = { name: 'Maria', email: 'maria@test.com', password: 'Senha123' };

      expect((await service.create(dto)).emailVerifiedAt).toBeNull();
      expect((await service.create(dto, { emailVerified: true })).emailVerifiedAt).toBeInstanceOf(
        Date,
      );
    });

    it('audit: false deixa a auditoria para quem chamou (ex.: auto-cadastro)', async () => {
      repo.exists.mockResolvedValue(false);
      await service.create(
        { name: 'Maria', email: 'maria@test.com', password: 'Senha123' },
        { audit: false },
      );
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('admin troca o e-mail: vira pedido pendente; a conta segue com o atual até confirmar', async () => {
      const verifiedAt = new Date();
      repo.findOne.mockResolvedValue(makeUser({ emailVerifiedAt: verifiedAt }));
      repo.exists.mockResolvedValue(false);

      const user = await service.update('user-1', { email: 'nova@test.com' });

      // nada muda até o dono do endereço novo abrir o link
      expect(user.email).toBe('maria@test.com');
      expect(user.emailVerifiedAt).toBe(verifiedAt);
      expect(emailVerification.requestChange).toHaveBeenCalledWith(user, 'nova@test.com', 'admin');
      expect(mailService.sendEmailChanged).not.toHaveBeenCalled(); // o antigo é avisado ao confirmar
    });

    it('audita só os campos que mudaram, com valor anterior e novo', async () => {
      repo.findOne.mockResolvedValue(makeUser());

      await service.update('user-1', { name: 'Maria Souza', isActive: true });

      expect(audit.record).toHaveBeenCalledWith(AuditAction.USER_UPDATED, {
        target: { type: 'user', id: 'user-1' },
        metadata: { changes: { name: { from: 'Maria', to: 'Maria Souza' } } },
      });
    });

    it('sem mudança real não audita nem envia nada', async () => {
      repo.findOne.mockResolvedValue(makeUser());

      await service.update('user-1', { name: 'Maria' });

      expect(audit.record).not.toHaveBeenCalled();
      expect(emailVerification.send).not.toHaveBeenCalled();
    });

    it('desativar o usuário encerra todas as sessões na hora', async () => {
      repo.findOne.mockResolvedValue(makeUser());

      await service.update('user-1', { isActive: false });

      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
        SessionRevokeReason.USER_DISABLED,
      );
    });
  });

  describe('getById', () => {
    it('lança 404 quando o usuário não existe (ou foi excluído)', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getById('x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateRole', () => {
    it('altera a role, envia e-mail e audita de/para', async () => {
      repo.findOne.mockResolvedValue(makeUser());

      const user = await service.updateRole('user-1', Role.MANAGER, 'admin-1');

      expect(user.role).toBe(Role.MANAGER);
      expect(mailService.sendRoleChanged).toHaveBeenCalledWith(user, Role.USER, Role.MANAGER);
      expect(audit.record).toHaveBeenCalledWith(AuditAction.USER_ROLE_CHANGED, {
        target: { type: 'user', id: 'user-1' },
        metadata: { from: Role.USER, to: Role.MANAGER },
      });
    });

    it('não faz nada se a role não mudou', async () => {
      repo.findOne.mockResolvedValue(makeUser({ role: Role.MANAGER }));

      await service.updateRole('user-1', Role.MANAGER, 'admin-1');

      expect(repo.save).not.toHaveBeenCalled();
      expect(mailService.sendRoleChanged).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('impede o usuário de alterar a própria role', async () => {
      await expect(service.updateRole('admin-1', Role.USER, 'admin-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('remove (soft delete)', () => {
    it('marca como excluído, encerra as sessões e audita', async () => {
      const user = makeUser();
      repo.findOne.mockResolvedValue(user);

      await service.remove('user-1', 'admin-1');

      expect(repo.softRemove).toHaveBeenCalledWith(user);
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
        SessionRevokeReason.USER_DELETED,
      );
      expect(audit.record).toHaveBeenCalledWith(AuditAction.USER_DELETED, {
        target: { type: 'user', id: 'user-1' },
        metadata: { email: 'maria@test.com' },
      });
    });

    it('impede o usuário de remover a si mesmo', async () => {
      await expect(service.remove('admin-1', 'admin-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(repo.softRemove).not.toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    it('restaura um usuário excluído e audita', async () => {
      repo.findOne
        .mockResolvedValueOnce(makeUser({ deletedAt: new Date() })) // busca com withDeleted
        .mockResolvedValueOnce(makeUser()); // getById depois de restaurar
      repo.exists.mockResolvedValue(false);

      const user = await service.restore('user-1');

      expect(repo.restore).toHaveBeenCalledWith('user-1');
      expect(user.deletedAt).toBeNull();
      expect(audit.record).toHaveBeenCalledWith(AuditAction.USER_RESTORED, {
        target: { type: 'user', id: 'user-1' },
      });
    });

    it.each([
      ['não existe', null],
      ['não está excluído', makeUser()],
    ])('404 quando o usuário %s', async (_, found) => {
      repo.findOne.mockResolvedValueOnce(found);
      await expect(service.restore('user-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409 se outra conta passou a usar o e-mail enquanto estava excluído', async () => {
      repo.findOne.mockResolvedValueOnce(makeUser({ deletedAt: new Date() }));
      repo.exists.mockResolvedValue(true);

      await expect(service.restore('user-1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.restore).not.toHaveBeenCalled();
    });
  });

  describe('avatar', () => {
    it('define a partir de um upload concluído e apaga o arquivo anterior', async () => {
      repo.findOne.mockResolvedValue(makeUser({ avatarFileId: 'antigo' }));
      files.consume.mockResolvedValue({ id: 'novo', key: 'public/avatar/u/novo.png' });

      const user = await service.setAvatar('user-1', 'novo');

      expect(files.consume).toHaveBeenCalledWith('user-1', 'novo', 'avatar');
      expect(user).toMatchObject({
        avatarFileId: 'novo',
        avatarUrl: 'https://cdn/public/avatar/u/novo.png',
      });
      expect(files.removeById).toHaveBeenCalledWith('antigo');
      expect(audit.record).toHaveBeenCalledWith(AuditAction.USER_AVATAR_CHANGED, {
        target: { type: 'user', id: 'user-1' },
      });
    });

    it('definir o mesmo arquivo de novo não o apaga', async () => {
      repo.findOne.mockResolvedValue(makeUser({ avatarFileId: 'mesmo' }));
      files.consume.mockResolvedValue({ id: 'mesmo', key: 'k' });

      await service.setAvatar('user-1', 'mesmo');

      expect(files.removeById).not.toHaveBeenCalled();
    });

    it('remover limpa o perfil e apaga o arquivo', async () => {
      repo.findOne.mockResolvedValue(makeUser({ avatarFileId: 'a', avatarUrl: 'https://x' }));

      const user = await service.removeAvatar('user-1');

      expect(user).toMatchObject({ avatarFileId: null, avatarUrl: null });
      expect(files.removeById).toHaveBeenCalledWith('a');
    });

    it('remover sem avatar não chama o storage', async () => {
      repo.findOne.mockResolvedValue(makeUser({ avatarFileId: null }));
      await service.removeAvatar('user-1');
      expect(files.removeById).not.toHaveBeenCalled();
    });
  });
});
