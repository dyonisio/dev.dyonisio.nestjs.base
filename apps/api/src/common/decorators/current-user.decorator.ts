import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { User } from '../../users/entities/user.entity';

/** Injeta o usuário autenticado (definido pelo JwtStrategy) no handler. */
export const CurrentUser = createParamDecorator(
  (field: keyof User | undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest<{ user?: User }>().user;
    return field ? user?.[field] : user;
  },
);
