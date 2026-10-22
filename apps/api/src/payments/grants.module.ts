import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module';
import { UsersModule } from '../users/users.module';
import { Grant } from './entities/grant.entity';
import { GrantsService } from './grants.service';

/** Pro de cortesia. Separado dos pagamentos para o job de manutenção usar sem as plataformas. */
@Module({
  imports: [TypeOrmModule.forFeature([Grant]), UsersModule, MailModule],
  providers: [GrantsService],
  exports: [GrantsService],
})
export class GrantsModule {}
