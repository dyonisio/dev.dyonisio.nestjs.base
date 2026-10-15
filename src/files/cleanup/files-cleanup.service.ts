import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, LessThan, Repository } from 'typeorm';
import { StoredFile } from '../file.entity';
import { purposesRequiringAttachment } from '../file-purposes';
import { StorageDriver } from '../storage/storage-driver';

export interface CleanupResult {
  deleted: number;
  failed: number;
}

/**
 * Apaga uploads abandonados (registro + conteúdo no storage). Roda dentro do job de
 * manutenção (src/maintenance): Lambda `maintenance` ou `npm run maintenance`.
 *
 * É lixo, depois de FILES_CLEANUP_AFTER_HOURS (padrão 24 h):
 *  - upload `pending`: o usuário pediu a URL e nunca confirmou (desistiu, deu erro...)
 *  - upload `ready` que nada usou (consume): ex.: enviou a foto mas não salvou como avatar.
 *    Finalidades `standalone` ficam de fora.
 */
@Injectable()
export class FilesCleanupService {
  private readonly logger = new Logger(FilesCleanupService.name);

  constructor(
    @InjectRepository(StoredFile) private readonly files: Repository<StoredFile>,
    private readonly storage: StorageDriver,
    private readonly config: ConfigService,
  ) {}

  async run(now = new Date()): Promise<CleanupResult> {
    const afterHours = this.config.get<number>('storage.cleanup.afterHours', 24);
    const batchSize = this.config.get<number>('storage.cleanup.batchSize', 500);
    const criteria = this.abandoned(new Date(now.getTime() - afterHours * 3_600_000));

    const candidates = await this.files.find({
      where: criteria,
      order: { createdAt: 'ASC' },
      take: batchSize,
    });

    const result: CleanupResult = { deleted: 0, failed: 0 };
    for (const file of candidates) {
      try {
        // Apaga o registro só se AINDA for lixo: se o usuário concluiu/usou o arquivo
        // enquanto o job rodava, ele fica.
        const { affected } = await this.files.delete(criteria.map((c) => ({ ...c, id: file.id })));
        if (!affected) continue;
        await this.storage.delete(file.key);
        result.deleted++;
      } catch (err) {
        result.failed++;
        this.logger.error({
          message: 'Falha ao apagar upload abandonado',
          fileId: file.id,
          key: file.key,
          err,
        });
      }
    }

    if (candidates.length) {
      this.logger.log({ message: 'Limpeza de uploads abandonados', ...result, afterHours });
    }
    return result;
  }

  private abandoned(cutoff: Date): FindOptionsWhere<StoredFile>[] {
    return [
      { status: 'pending', createdAt: LessThan(cutoff) },
      {
        status: 'ready',
        attachedAt: IsNull(),
        completedAt: LessThan(cutoff),
        purpose: In(purposesRequiringAttachment()),
      },
    ];
  }
}
