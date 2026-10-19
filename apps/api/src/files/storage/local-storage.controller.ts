import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { existsSync } from 'fs';
import { extname, posix } from 'path';
import { Public } from '../../common/decorators/public.decorator';
import { i18nKey } from '../../i18n/translations';
import { EXTENSIONS } from '../file-purposes';
import { LocalStorageDriver } from './local-storage.driver';
import { StorageDriver } from './storage-driver';

const MIME_BY_EXTENSION = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([mime, ext]) => [`.${ext}`, mime]),
);

/**
 * Guards rodam ANTES dos interceptors: com o driver S3 a requisição é recusada (404) antes
 * de o multer ler o corpo — senão qualquer um poderia mandar uploads de 50 MB para a memória.
 */
@Injectable()
class LocalStorageOnlyGuard implements CanActivate {
  constructor(private readonly storage: StorageDriver) {}

  canActivate(): boolean {
    if (!(this.storage instanceof LocalStorageDriver)) throw new NotFoundException();
    return true;
  }
}

/**
 * Faz o papel do S3 quando STORAGE_DRIVER=local (desenvolvimento e testes):
 * recebe o upload direto do navegador e serve os arquivos. Com o driver S3,
 * todas as rotas respondem 404.
 */
@ApiExcludeController()
@Controller('files')
@Public()
@UseGuards(LocalStorageOnlyGuard)
export class LocalStorageController {
  constructor(private readonly storage: StorageDriver) {}

  @Post('local-upload')
  @HttpCode(HttpStatus.NO_CONTENT) // como o S3
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  async upload(
    @Body() body: { policy?: string; 'Content-Type'?: string },
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<void> {
    const driver = this.localDriver();
    const policy = body.policy ? driver.verifyPolicy(body.policy) : null;
    if (!policy) throw new ForbiddenException(i18nKey('files.invalidUploadPolicy'));

    // As mesmas regras que o S3 aplica a partir da política assinada
    if (!file || body['Content-Type'] !== policy.contentType || file.size > policy.maxSize) {
      throw new BadRequestException(i18nKey('files.invalidUploadPolicy'));
    }
    await driver.write(policy.key, file.buffer);
  }

  @Get('local/:encodedKey')
  serve(
    @Param('encodedKey') encodedKey: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ): void {
    const driver = this.localDriver();
    // Normaliza ANTES de decidir se é público: "public/../private/x" é um arquivo privado
    const key = posix.normalize(Buffer.from(encodedKey, 'base64url').toString('utf8'));
    if (key.startsWith('..') || key.startsWith('/')) {
      throw new NotFoundException(i18nKey('files.notFound'));
    }

    const isPublic = key.startsWith('public/');
    if (!isPublic && !(sig && exp && driver.verifyDownload(key, Number(exp), sig))) {
      throw new ForbiddenException(i18nKey('files.invalidDownloadLink'));
    }

    let path: string;
    try {
      path = driver.pathOf(key);
    } catch {
      throw new NotFoundException(i18nKey('files.notFound'));
    }
    if (!existsSync(path)) throw new NotFoundException(i18nKey('files.notFound'));

    res.type(MIME_BY_EXTENSION[extname(path)] ?? 'application/octet-stream');
    res.sendFile(path);
  }

  private localDriver(): LocalStorageDriver {
    if (!(this.storage instanceof LocalStorageDriver)) throw new NotFoundException();
    return this.storage;
  }
}
