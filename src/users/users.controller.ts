import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrors } from '../common/decorators/api-error.decorator';
import { AllowUnverified } from '../common/decorators/allow-unverified.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { Authorize } from '../common/decorators/authorize.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../common/enums/permission.enum';
import { i18nKey } from '../i18n/translations';
import { AdminCreateUserDto } from './dto/create-user.dto';
import { ListUsersQueryDto, PaginatedUsersDto } from './dto/list-users-query.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateProfileDto, UpdateUserDto } from './dto/update-user.dto';
import { SetAvatarDto } from '../files/dto/files.dto';
import { User } from './entities/user.entity';
import { UserInvitationService } from './user-invitation.service';
import { UsersService } from './users.service';

/** :id deve ser UUID — com mensagem traduzível em vez da padrão do Nest. */
const UuidParam = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException(i18nKey('errors.invalidUuid')),
});

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly invitations: UserInvitationService,
  ) {}

  // Rotas "/me" vêm antes de "/:id" para não colidirem
  @Get('me')
  @Auth()
  @AllowUnverified()
  @ApiOperation({ summary: 'Get the signed-in user' })
  @ApiOkResponse({ type: User })
  me(@CurrentUser() user: User) {
    return user;
  }

  @Patch('me')
  @Auth()
  @AllowUnverified()
  @ApiOperation({
    summary: 'Update the signed-in user profile',
    description:
      'Name and language. To change the email use `POST /users/me/email` (requires the password and confirming the new address).',
  })
  @ApiOkResponse({ type: User })
  @ApiErrors([400, 'Validation failed'], [409, 'Email already registered'])
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.usersService.update(userId, dto);
  }

  @Put('me/avatar')
  @Auth()
  @ApiOperation({
    summary: 'Set my avatar',
    description:
      'Upload the image first (POST /files with purpose `avatar`, send it, POST /files/:id/complete), then send the file id here. The previous avatar is deleted.',
  })
  @ApiOkResponse({ type: User })
  @ApiErrors([400, 'File not found, not completed or not an avatar upload'])
  setAvatar(@CurrentUser('id') userId: string, @Body() dto: SetAvatarDto) {
    return this.usersService.setAvatar(userId, dto.fileId);
  }

  @Delete('me/avatar')
  @Auth()
  @ApiOperation({ summary: 'Remove my avatar' })
  @ApiOkResponse({ type: User })
  removeAvatar(@CurrentUser('id') userId: string) {
    return this.usersService.removeAvatar(userId);
  }

  @Get()
  @Authorize(Permission.USERS_READ)
  @ApiOperation({
    summary: 'List users (paginated, searchable, sortable)',
    description:
      'Search by name/email, filter by role, sort, or list only deleted users. Permission: `users:read`.',
  })
  @ApiOkResponse({ type: PaginatedUsersDto })
  @ApiErrors([400, 'Invalid query parameters'])
  findAll(@Query() query: ListUsersQueryDto) {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  @Authorize(Permission.USERS_READ)
  @ApiOperation({ summary: 'Get a user', description: 'Permission: `users:read`.' })
  @ApiOkResponse({ type: User })
  @ApiErrors([400, 'Invalid id'], [404, 'User not found'])
  findOne(@Param('id', UuidParam) id: string) {
    return this.usersService.getById(id);
  }

  @Post()
  @Authorize(Permission.USERS_CREATE)
  @ApiOperation({
    summary: 'Create a user with any role',
    description:
      'The email is considered verified (the admin vouches for it). **Without `password` (recommended)** the user receives an email with a single-use link to create their own password (valid for INVITE_EXPIRES_IN, default 7 days). With `password`, the email only says the account exists — the password is never emailed. Permission: `users:create`.',
  })
  @ApiCreatedResponse({ type: User })
  @ApiErrors([400, 'Validation failed'], [409, 'Email already registered'])
  create(@Body() dto: AdminCreateUserDto) {
    return this.invitations.createByAdmin(dto);
  }

  @Post(':id/invite')
  @Authorize(Permission.USERS_CREATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Resend the invite to create a password',
    description:
      'For users created without a password whose link expired. Fails with 400 if the user already has a password. Permission: `users:create`.',
  })
  @ApiNoContentResponse()
  @ApiErrors([400, 'Invalid id or user already has a password'], [404, 'User not found'])
  async resendInvite(@Param('id', UuidParam) id: string): Promise<void> {
    await this.invitations.resend(id);
  }

  @Patch(':id')
  @Authorize(Permission.USERS_UPDATE)
  @ApiOperation({
    summary: 'Update a user',
    description: 'Updates name, email or active status. Permission: `users:update`.',
  })
  @ApiOkResponse({ type: User })
  @ApiErrors(
    [400, 'Validation failed or invalid id'],
    [404, 'User not found'],
    [409, 'Email already registered'],
  )
  update(@Param('id', UuidParam) id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Patch(':id/role')
  @Authorize(Permission.USERS_MANAGE_ROLES)
  @ApiOperation({
    summary: 'Change a user role',
    description:
      'Changes the role and notifies the user by email. Takes effect immediately, even for tokens already issued. You cannot change your own role. Permission: `users:manage-roles`.',
  })
  @ApiOkResponse({ type: User })
  @ApiErrors([400, 'Validation failed, invalid id or own role'], [404, 'User not found'])
  updateRole(
    @Param('id', UuidParam) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser('id') actorId: string,
  ) {
    return this.usersService.updateRole(id, dto.role, actorId);
  }

  @Patch(':id/restore')
  @Authorize(Permission.USERS_DELETE)
  @ApiOperation({
    summary: 'Restore a deleted user',
    description:
      'Undoes a soft delete. Fails with 409 if another account took the email in the meantime. Find deleted users with `GET /users?deleted=true`. Permission: `users:delete`.',
  })
  @ApiOkResponse({ type: User })
  @ApiErrors([400, 'Invalid id'], [404, 'Deleted user not found'], [409, 'Email already in use'])
  restore(@Param('id', UuidParam) id: string) {
    return this.usersService.restore(id);
  }

  @Delete(':id')
  @Authorize(Permission.USERS_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a user',
    description:
      'Soft delete: the user disappears from listings and can no longer sign in (all sessions end immediately), the email becomes available again, and the record can be restored with `PATCH /users/:id/restore`. You cannot delete yourself. Permission: `users:delete`.',
  })
  @ApiNoContentResponse()
  @ApiErrors([400, 'Invalid id or own account'], [404, 'User not found'])
  remove(@Param('id', UuidParam) id: string, @CurrentUser('id') actorId: string) {
    return this.usersService.remove(id, actorId);
  }
}
