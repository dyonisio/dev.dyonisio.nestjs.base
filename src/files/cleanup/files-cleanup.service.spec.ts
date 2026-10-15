import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { StoredFile } from '../file.entity';
import { StorageDriver } from '../storage/storage-driver';
import { FilesCleanupService } from './files-cleanup.service';

/** O caminho normal está no e2e (test/files-cleanup.e2e-spec.ts); aqui, as corridas e falhas. */
describe('FilesCleanupService', () => {
  const files = { find: jest.fn(), delete: jest.fn() };
  const storage = { delete: jest.fn() };
  const service = new FilesCleanupService(
    files as unknown as Repository<StoredFile>,
    storage as unknown as StorageDriver,
    { get: (_k: string, d: unknown) => d } as unknown as ConfigService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(service['logger'], 'error').mockImplementation();
    jest.spyOn(service['logger'], 'log').mockImplementation();
    files.find.mockResolvedValue([
      { id: 'a', key: 'public/avatar/u/a.png' },
      { id: 'b', key: 'public/avatar/u/b.png' },
    ]);
  });

  it('arquivo concluído/usado enquanto o job rodava (delete condicional não acha) fica intacto', async () => {
    files.delete.mockResolvedValueOnce({ affected: 0 }).mockResolvedValueOnce({ affected: 1 });

    await expect(service.run()).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith('public/avatar/u/b.png');
  });

  it('falha num arquivo não interrompe os outros e é registrada no log', async () => {
    files.delete.mockResolvedValue({ affected: 1 });
    storage.delete.mockRejectedValueOnce(new Error('S3 fora do ar'));

    await expect(service.run()).resolves.toEqual({ deleted: 1, failed: 1 });
    expect(service['logger'].error).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: 'a', key: 'public/avatar/u/a.png' }),
    );
  });

  it('sem nada para apagar, não escreve log', async () => {
    files.find.mockResolvedValue([]);
    await expect(service.run()).resolves.toEqual({ deleted: 0, failed: 0 });
    expect(service['logger'].log).not.toHaveBeenCalled();
  });
});
