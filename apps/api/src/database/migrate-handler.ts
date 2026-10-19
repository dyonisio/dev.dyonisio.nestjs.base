/**
 * Entrypoint da Lambda `migrate`: aplica as migrations pendentes e devolve os nomes.
 *
 * Chamada pelo deploy (.github/workflows/deploy.yml) ANTES do código novo entrar no ar: o
 * runner do GitHub não alcança um banco privado, mas uma Lambda dentro da AWS alcança, com os
 * mesmos segredos (SSM) e o mesmo TLS da API. Sem evento: só roda quando alguém a invoca.
 *
 * Por rodar antes do código novo, toda migration precisa funcionar com o código que ainda está
 * no ar (ex.: criar coluna nova pode; apagar uma coluna ainda usada, não — veja
 * docs/GUIDES.md, "Migration").
 */
import dataSource from './data-source';

export async function handler(): Promise<{ applied: string[] }> {
  if (!dataSource.isInitialized) await dataSource.initialize();
  try {
    // Uma transação para todas: se uma falhar, nenhuma fica aplicada pela metade
    const applied = (await dataSource.runMigrations({ transaction: 'all' })).map((m) => m.name);
    console.log(JSON.stringify({ level: 'info', msg: 'migrations', applied }));
    return { applied };
  } finally {
    await dataSource.destroy();
  }
}
