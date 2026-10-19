import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'path';
import { deriveSecret } from '../../common/crypto/derive-secret';
import configuration from '../../config/configuration';
import { LocalStorageDriver } from './local-storage.driver';
import { S3StorageDriver } from './s3-storage.driver';
import { StorageDriver } from './storage-driver';

type StorageConfig = ReturnType<typeof configuration>['storage'];

/** STORAGE_DRIVER=s3 (produção) | local (desenvolvimento e testes, padrão). */
export function createStorageDriver(config: ConfigService): StorageDriver {
  const storage = config.getOrThrow<StorageConfig>('storage');

  if (storage.driver === 's3') {
    if (!storage.s3.bucket) throw new Error('STORAGE_DRIVER=s3 exige STORAGE_S3_BUCKET');
    const publicBaseUrl =
      storage.publicUrl ?? `https://${storage.s3.bucket}.s3.${storage.s3.region}.amazonaws.com`;
    return new S3StorageDriver(
      new S3Client({ region: storage.s3.region }),
      storage.s3.bucket,
      publicBaseUrl.replace(/\/$/, ''),
    );
  }

  return new LocalStorageDriver(
    resolve(storage.local.dir),
    config.get<string>('app.url', 'http://localhost:3000').replace(/\/$/, ''),
    deriveSecret(config.getOrThrow<string>('jwt.secret'), 'local-storage'),
  );
}
