import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { RateLimitStorageModule } from '../rate-limit/rate-limit.module';
import { SessionsModule } from '../sessions/sessions.module';
import { UsersModule } from '../users/users.module';
import { MaintenanceService } from './maintenance.service';

/** Tarefas de manutenção (sem rotas). Importado pelo AppModule e pela aplicação do job. */
@Module({
  imports: [FilesModule, SessionsModule, UsersModule, RateLimitStorageModule],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
