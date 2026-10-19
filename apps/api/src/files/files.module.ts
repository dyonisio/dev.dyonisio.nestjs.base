import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StoredFile } from './file.entity';
import { FilesCleanupService } from './cleanup/files-cleanup.service';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { LocalStorageController } from './storage/local-storage.controller';
import { StorageDriver } from './storage/storage-driver';
import { createStorageDriver } from './storage/storage.factory';

@Module({
  imports: [TypeOrmModule.forFeature([StoredFile])],
  controllers: [FilesController, LocalStorageController],
  providers: [
    FilesService,
    FilesCleanupService,
    { provide: StorageDriver, inject: [ConfigService], useFactory: createStorageDriver },
  ],
  exports: [FilesService, FilesCleanupService],
})
export class FilesModule {}
