import { ForbiddenException } from '@nestjs/common';
import { Permission } from '../common/enums/permission.enum';
import { Role } from '../common/enums/role.enum';
import { User } from './entities/user.entity';
import { UserInvitationService } from './user-invitation.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/** Ator com exatamente estas permissões (sem depender de qual role as tem hoje). */
function actorWith(...permissions: Permission[]): User {
  const actor = new User();
  Object.defineProperty(actor, 'permissions', { get: () => permissions });
  return actor;
}

describe('UsersController.create', () => {
  const invitations = { createByAdmin: jest.fn().mockResolvedValue({ id: 'new' }) };
  const controller = new UsersController(
    {} as UsersService,
    invitations as unknown as UserInvitationService,
  );
  const base = { name: 'Jane', email: 'jane@example.com' };

  beforeEach(() => invitations.createByAdmin.mockClear());

  it('quem só cria usuários não pode dar uma role acima de user (escalada de privilégio)', () => {
    const actor = actorWith(Permission.USERS_CREATE);

    expect(() => controller.create({ ...base, role: Role.ADMIN }, actor)).toThrow(
      ForbiddenException,
    );
    expect(() => controller.create({ ...base, role: Role.MANAGER }, actor)).toThrow(
      ForbiddenException,
    );
    expect(invitations.createByAdmin).not.toHaveBeenCalled();
  });

  it('sem role ou com role user basta users:create', async () => {
    const actor = actorWith(Permission.USERS_CREATE);

    await controller.create(base, actor);
    await controller.create({ ...base, role: Role.USER }, actor);

    expect(invitations.createByAdmin).toHaveBeenCalledTimes(2);
  });

  it('com users:manage-roles pode criar com qualquer role', async () => {
    const actor = actorWith(Permission.USERS_CREATE, Permission.USERS_MANAGE_ROLES);

    await controller.create({ ...base, role: Role.ADMIN }, actor);

    expect(invitations.createByAdmin).toHaveBeenCalledWith({ ...base, role: Role.ADMIN });
  });
});
