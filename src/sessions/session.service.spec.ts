import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import { Role } from '../common/enums/role.enum';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { Session, SessionRevokeReason } from './entities/session.entity';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AuditAction } from '../audit/audit-action.enum';
import { AuditService } from '../audit/audit.service';
import { SessionService } from './session.service';

/** Usa um banco sql.js em memória: testa as queries/relações reais, não mocks. */
describe('SessionService', () => {
  let service: SessionService;
  let jwt: JwtService;
  let dataSource: DataSource;
  let sessions: Repository<Session>;
  let user: User;

  const config: Record<string, unknown> = { 'jwt.expiresIn': 900, 'jwt.refreshExpiresIn': 3600 };
  const audit = { record: jest.fn() };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqljs',
          entities: [User, Session, RefreshToken],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([User, Session, RefreshToken]),
        JwtModule.register({ secret: 'segredo-de-teste-com-tamanho-suficiente' }),
      ],
      providers: [
        SessionService,
        { provide: AuditService, useValue: audit },
        { provide: ConfigService, useValue: { get: (k: string, d?: unknown) => config[k] ?? d } },
      ],
    }).compile();

    service = moduleRef.get(SessionService);
    jwt = moduleRef.get(JwtService);
    dataSource = moduleRef.get(DataSource);
    sessions = moduleRef.get(getRepositoryToken(Session));

    const users = moduleRef.get<Repository<User>>(getRepositoryToken(User));
    user = await users.save(
      users.create({ name: 'Maria', email: 'maria@test.com', password: 'hash', role: Role.USER }),
    );
  });

  afterEach(() => dataSource.destroy());

  const sidOf = (accessToken: string) => jwt.decode<JwtPayload>(accessToken).sid;

  it('create abre uma sessão e o access token carrega o id dela (sid)', async () => {
    const tokens = await service.create(user);

    const payload = jwt.verify<JwtPayload>(tokens.accessToken);
    expect(payload).toMatchObject({ sub: user.id, role: Role.USER });
    expect(await sessions.findOneBy({ id: payload.sid })).toMatchObject({ userId: user.id });
    expect(tokens.refreshToken).toMatch(/^[0-9a-f-]{36}\.[\w-]+$/);
    await expect(service.findActiveUser(payload.sid)).resolves.toMatchObject({ id: user.id });
  });

  it('refresh rotaciona: novo par na MESMA sessão e o token antigo deixa de valer', async () => {
    const first = await service.create(user);

    const { tokens: second } = await service.refresh(first.refreshToken);

    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(sidOf(second.accessToken)).toBe(sidOf(first.accessToken));
    await expect(service.findActiveUser(sidOf(second.accessToken))).resolves.not.toBeNull();
  });

  it('reuso de refresh token já usado revoga a sessão (inclusive os access tokens dela)', async () => {
    const first = await service.create(user);
    const { tokens: second } = await service.refresh(first.refreshToken);

    await expect(service.refresh(first.refreshToken)).rejects.toThrow(UnauthorizedException);

    // o token "legítimo" mais novo também morreu, e o access token da sessão junto
    await expect(service.refresh(second.refreshToken)).rejects.toThrow(UnauthorizedException);
    await expect(service.findActiveUser(sidOf(second.accessToken))).resolves.toBeNull();
    expect(await sessions.findOneBy({ id: sidOf(first.accessToken) })).toMatchObject({
      revokedReason: SessionRevokeReason.REUSE_DETECTED,
    });
    expect(audit.record).toHaveBeenCalledWith(AuditAction.AUTH_REFRESH_TOKEN_REUSE, {
      actorId: user.id,
      target: { type: 'session', id: sidOf(first.accessToken) },
    });
  });

  it('reuso em uma sessão NÃO afeta as outras sessões do usuário', async () => {
    const compromised = await service.create(user);
    const otherDevice = await service.create(user);
    await service.refresh(compromised.refreshToken);

    await expect(service.refresh(compromised.refreshToken)).rejects.toThrow();

    await expect(service.findActiveUser(sidOf(otherDevice.accessToken))).resolves.not.toBeNull();
    await expect(service.refresh(otherDevice.refreshToken)).resolves.toBeDefined();
  });

  it('logout (revoke) derruba o refresh e o access token da sessão', async () => {
    const tokens = await service.create(user);

    await expect(service.revoke(tokens.refreshToken)).resolves.toBe(user.id);
    await expect(service.revoke('lixo')).resolves.toBeNull();

    await expect(service.findActiveUser(sidOf(tokens.accessToken))).resolves.toBeNull();
    await expect(service.refresh(tokens.refreshToken)).rejects.toThrow(UnauthorizedException);
  });

  it('revokeAllForUser derruba todas as sessões; uma sessão nova depois continua válida', async () => {
    const a = await service.create(user);
    const b = await service.create(user);

    await service.revokeAllForUser(user.id);
    const fresh = await service.create(user);

    await expect(service.findActiveUser(sidOf(a.accessToken))).resolves.toBeNull();
    await expect(service.findActiveUser(sidOf(b.accessToken))).resolves.toBeNull();
    // usar o refresh antigo é só inválido — não derruba a sessão nova
    await expect(service.refresh(a.refreshToken)).rejects.toThrow(UnauthorizedException);
    await expect(service.findActiveUser(sidOf(fresh.accessToken))).resolves.not.toBeNull();
  });

  it('rejeita sessão expirada', async () => {
    const tokens = await service.create(user);
    await sessions.update(sidOf(tokens.accessToken), { expiresAt: new Date(Date.now() - 1000) });

    await expect(service.refresh(tokens.refreshToken)).rejects.toThrow(UnauthorizedException);
  });

  it('não reconhece sessão de usuário inativo', async () => {
    const tokens = await service.create(user);
    await dataSource.getRepository(User).update(user.id, { isActive: false });

    await expect(service.findActiveUser(sidOf(tokens.accessToken))).resolves.toBeNull();
    await expect(service.refresh(tokens.refreshToken)).rejects.toThrow(UnauthorizedException);
  });

  it.each(['lixo', 'abc.def', `${randomUUID()}.segredo-que-nao-existe`])(
    'rejeita refresh token inválido: %s',
    async (token) => {
      await expect(service.refresh(token)).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it('rejeita segredo adulterado mesmo com id válido', async () => {
    const { refreshToken } = await service.create(user);
    const [id] = refreshToken.split('.');

    await expect(service.refresh(`${id}.adulterado`)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([undefined, 'nao-e-uuid', randomUUID()])(
    'findActiveUser retorna null para sid inválido/inexistente: %s',
    async (sid) => {
      await expect(service.findActiveUser(sid)).resolves.toBeNull();
    },
  );

  it('dois refreshes simultâneos com o mesmo token: o que perde a corrida derruba a sessão', async () => {
    const first = await service.create(user);
    const tokens = dataSource.getRepository(RefreshToken);
    // Simula a outra requisição marcando o token como usado entre a leitura e o update
    jest.spyOn(tokens, 'update').mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] });

    await expect(service.refresh(first.refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.findActiveUser(sidOf(first.accessToken))).resolves.toBeNull();
    expect(audit.record).toHaveBeenCalledWith(
      AuditAction.AUTH_REFRESH_TOKEN_REUSE,
      expect.anything(),
    );
  });

  describe('ciclo de vida (dispositivos, idade máxima, faxina)', () => {
    const DAY = 86_400_000;

    it('dispositivo novo = conta com histórico e nenhuma sessão com este user agent', async () => {
      await expect(service.isNewDevice(user.id, 'Chrome')).resolves.toBe(false); // sem histórico
      await sessions.save(
        sessions.create({
          userId: user.id,
          userAgent: 'Chrome',
          expiresAt: new Date(Date.now() + DAY),
        }),
      );
      await expect(service.isNewDevice(user.id, 'Chrome')).resolves.toBe(false);
      await expect(service.isNewDevice(user.id, 'Safari')).resolves.toBe(true);
      await expect(service.isNewDevice(user.id, undefined)).resolves.toBe(true);
    });

    it('sessão expirada não autentica, mesmo sem ter sido revogada', async () => {
      const { accessToken } = await service.create(user);
      await sessions.update(sidOf(accessToken), { expiresAt: new Date(Date.now() - 1000) });
      await expect(service.findActiveUser(sidOf(accessToken))).resolves.toBeNull();
    });

    it('a renovação não passa da idade máxima da sessão (SESSION_MAX_AGE_DAYS)', () => {
      config['session.maxAgeDays'] = 90;
      const created = new Date(Date.now() - 90 * DAY + 60_000); // falta 1 minuto para 90 dias
      const next = (service as unknown as { nextExpiry(d: Date): Date }).nextExpiry(created);
      expect(next.getTime()).toBe(created.getTime() + 90 * DAY);
      delete config['session.maxAgeDays'];
    });

    it('findById ignora ids inválidos', async () => {
      await expect(service.findById(undefined)).resolves.toBeNull();
      await expect(service.findById('nao-e-uuid')).resolves.toBeNull();
    });

    it('purge apaga sessões encerradas/expiradas antigas e tokens já usados velhos', async () => {
      // (o create() já faz a faxina das expiradas do próprio usuário: crie antes)
      const { refreshToken } = await service.create(user);
      await service.refresh(refreshToken); // o token anterior fica "usado"
      const old = new Date(Date.now() - 40 * DAY);
      await sessions.save([
        sessions.create({ userId: user.id, expiresAt: old }),
        sessions.create({ userId: user.id, expiresAt: new Date(Date.now() + DAY), revokedAt: old }),
      ]);

      // agora: nada usado há mais de 1 h (validade do refresh nos testes)
      const removedNow = await service.purge(30);
      expect(removedNow).toBe(2);
      // daqui a 2 h: o token usado também sai
      await expect(service.purge(30, new Date(Date.now() + 2 * 3600_000))).resolves.toBe(1);
    });

    it('deleteAllForUser apaga tudo do usuário', async () => {
      await service.create(user);
      await service.deleteAllForUser(user.id);
      await expect(service.listAllForUser(user.id)).resolves.toEqual([]);
    });
  });
});
