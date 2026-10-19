const dataSource = {
  isInitialized: false,
  initialize: jest.fn(),
  runMigrations: jest.fn(),
  destroy: jest.fn(),
};
jest.mock('./data-source', () => ({ __esModule: true, default: dataSource }));

import { handler } from './migrate-handler';

describe('Lambda migrate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('aplica as pendentes numa transação só e devolve os nomes', async () => {
    dataSource.runMigrations.mockResolvedValue([{ name: 'AddMagicLink1761700000000' }]);

    await expect(handler()).resolves.toEqual({ applied: ['AddMagicLink1761700000000'] });
    expect(dataSource.runMigrations).toHaveBeenCalledWith({ transaction: 'all' });
    expect(dataSource.destroy).toHaveBeenCalled();
  });

  it('nada pendente: lista vazia', async () => {
    dataSource.runMigrations.mockResolvedValue([]);
    await expect(handler()).resolves.toEqual({ applied: [] });
  });

  it('falha: o erro sobe (o deploy para) e a conexão é fechada mesmo assim', async () => {
    dataSource.runMigrations.mockRejectedValue(new Error('coluna já existe'));

    await expect(handler()).rejects.toThrow('coluna já existe');
    expect(dataSource.destroy).toHaveBeenCalled();
  });
});
