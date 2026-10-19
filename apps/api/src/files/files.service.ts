import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { MoreThan, Repository } from 'typeorm';
import { i18nKey } from '../i18n/translations';
import { CreateUploadDto, CreateUploadResponseDto, FileDto } from './dto/files.dto';
import { StoredFile } from './file.entity';
import {
  EXTENSIONS,
  FILE_PURPOSES,
  FilePurpose,
  matchesSignature,
  SIGNATURE_BYTES,
} from './file-purposes';
import { StorageDriver } from './storage/storage-driver';

/**
 * Upload genérico em 3 passos (o arquivo nunca passa pela API — vai direto ao storage):
 *   1. create()   -> valida finalidade/tipo/tamanho e devolve uma URL de upload assinada
 *   2. o cliente envia o arquivo direto para o S3 (ou o storage local em dev)
 *   3. complete() -> confere que chegou, o tamanho real e o conteúdo (magic bytes)
 * Quem usa o arquivo (ex.: avatar) chama consume() para pegar um upload concluído do usuário.
 */
@Injectable()
export class FilesService {
  constructor(
    @InjectRepository(StoredFile) private readonly files: Repository<StoredFile>,
    private readonly storage: StorageDriver,
    private readonly config: ConfigService,
  ) {}

  /**
   * Limites por pessoa, para ninguém usar o bucket como depósito (custo):
   *  - FILES_MAX_UPLOADS_PER_DAY envios em 24 h (contando os já apagados não: só os que existem);
   *  - FILES_MAX_BYTES_PER_USER de espaço, somando os arquivos dela (pendentes contam pelo
   *    tamanho declarado: é o espaço que o envio reservou).
   * Trocar o avatar apaga o anterior, então só conta o que está em uso.
   */
  private async checkQuota(ownerId: string, size: number): Promise<void> {
    const perDay = this.config.get<number>('storage.maxUploadsPerDay', 50);
    if (perDay > 0) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const today = await this.files.count({ where: { ownerId, createdAt: MoreThan(since) } });
      if (today >= perDay) {
        throw new HttpException(
          { key: 'files.dailyLimit', args: { limit: perDay } },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const maxBytes = this.config.get<number>('storage.maxBytesPerUser', 100 * 1024 * 1024);
    if (maxBytes > 0) {
      const { used } = (await this.files
        .createQueryBuilder('file')
        .select('COALESCE(SUM(file.size), 0)', 'used')
        .where('file.ownerId = :ownerId', { ownerId })
        .getRawOne<{ used: string | number }>()) ?? { used: 0 };
      if (Number(used) + size > maxBytes) {
        throw new BadRequestException({
          key: 'files.storageLimit',
          args: { limitMb: Math.round(maxBytes / 1024 / 1024) },
        });
      }
    }
  }

  async create(ownerId: string, dto: CreateUploadDto): Promise<CreateUploadResponseDto> {
    // Cada pedido reserva espaço no storage até ser concluído ou limpo: sem limite, um
    // usuário poderia pedir milhares de URLs e encher o bucket (custo)
    const pending = await this.files.count({ where: { ownerId, status: 'pending' } });
    if (pending >= this.config.get<number>('storage.maxPendingPerUser', 20)) {
      throw new HttpException(i18nKey('files.tooManyPending'), HttpStatus.TOO_MANY_REQUESTS);
    }

    const purpose = FILE_PURPOSES[dto.purpose];
    const allowed: readonly string[] = purpose.contentTypes;
    if (!allowed.includes(dto.contentType)) {
      throw new BadRequestException({
        key: 'files.invalidType',
        args: { allowed: purpose.contentTypes.join(', ') },
      });
    }
    if (dto.size > purpose.maxSize) {
      throw new BadRequestException({
        key: 'files.tooLarge',
        args: { maxMb: purpose.maxSize / 1024 / 1024 },
      });
    }

    await this.checkQuota(ownerId, dto.size);

    const key = `${purpose.visibility}/${dto.purpose}/${ownerId}/${randomUUID()}.${EXTENSIONS[dto.contentType]}`;
    const file = await this.files.save(
      this.files.create({
        ownerId,
        purpose: dto.purpose,
        key,
        contentType: dto.contentType,
        size: dto.size,
        status: 'pending',
        completedAt: null,
        attachedAt: null,
      }),
    );
    const upload = await this.storage.createUpload(key, {
      contentType: dto.contentType,
      maxSize: purpose.maxSize,
      expiresIn: this.config.get<number>('storage.uploadExpiresIn', 600),
    });
    return { file: await this.toDto(file), upload };
  }

  /** Confere o arquivo enviado. Idempotente: chamar de novo num arquivo pronto só o devolve. */
  async complete(ownerId: string, fileId: string): Promise<FileDto> {
    const file = await this.findOwned(ownerId, fileId);
    if (file.status === 'ready') return this.toDto(file);

    const stored = await this.storage.head(file.key);
    if (!stored) throw new BadRequestException(i18nKey('files.notUploaded'));

    const purpose = FILE_PURPOSES[file.purpose as FilePurpose];
    const head = await this.storage.readStart(file.key, SIGNATURE_BYTES);
    if (stored.size > purpose.maxSize || !matchesSignature(file.contentType, head)) {
      // Conteúdo não confere com o tipo declarado (ou burlou o tamanho): descarta
      await this.storage.delete(file.key);
      await this.files.delete(file.id);
      throw new BadRequestException(i18nKey('files.invalidContent'));
    }

    file.status = 'ready';
    file.size = stored.size;
    file.completedAt = new Date();
    return this.toDto(await this.files.save(file));
  }

  async get(ownerId: string, fileId: string): Promise<FileDto> {
    return this.toDto(await this.findOwned(ownerId, fileId));
  }

  async remove(ownerId: string, fileId: string): Promise<void> {
    const file = await this.findOwned(ownerId, fileId);
    await this.storage.delete(file.key);
    await this.files.delete(file.id);
  }

  /**
   * Para quem vai USAR o arquivo: upload concluído, do usuário, da finalidade esperada.
   * Marca o arquivo como em uso — assim a limpeza automática não o apaga.
   */
  async consume(ownerId: string, fileId: string, purpose: FilePurpose): Promise<StoredFile> {
    const file = await this.files.findOne({ where: { id: fileId, ownerId } });
    if (!file || file.status !== 'ready' || file.purpose !== purpose) {
      throw new BadRequestException(i18nKey('files.invalidFile'));
    }
    if (!file.attachedAt) {
      file.attachedAt = new Date();
      await this.files.update(file.id, { attachedAt: file.attachedAt });
    }
    return file;
  }

  /** URL de um arquivo público (fixa) — ex.: o avatar gravado no perfil. */
  publicUrl(file: StoredFile): string {
    return this.storage.publicUrl(file.key);
  }

  async removeById(fileId: string): Promise<void> {
    const file = await this.files.findOne({ where: { id: fileId } });
    if (!file) return;
    await this.storage.delete(file.key);
    await this.files.delete(file.id);
  }

  /** Metadados dos arquivos do usuário (exportação de dados). */
  listForOwner(ownerId: string): Promise<StoredFile[]> {
    return this.files.find({ where: { ownerId }, order: { createdAt: 'DESC' } });
  }

  /** Apaga todos os arquivos do usuário — registro e conteúdo (anonimização da conta). */
  async removeAllForOwner(ownerId: string): Promise<number> {
    const files = await this.listForOwner(ownerId);
    for (const file of files) {
      await this.storage.delete(file.key);
      await this.files.delete(file.id);
    }
    return files.length;
  }

  private async findOwned(ownerId: string, fileId: string): Promise<StoredFile> {
    const file = await this.files.findOne({ where: { id: fileId, ownerId } });
    if (!file) throw new NotFoundException(i18nKey('files.notFound'));
    return file;
  }

  private async toDto(file: StoredFile): Promise<FileDto> {
    let url: string | null = null;
    if (file.status === 'ready') {
      url = file.key.startsWith('public/')
        ? this.storage.publicUrl(file.key)
        : await this.storage.downloadUrl(
            file.key,
            this.config.get<number>('storage.downloadExpiresIn', 300),
          );
    }
    return {
      id: file.id,
      purpose: file.purpose,
      contentType: file.contentType,
      size: file.size,
      status: file.status,
      url,
      createdAt: file.createdAt,
    };
  }
}
