import { existsSync, readFileSync } from 'fs';
import { join, posix } from 'path';

/**
 * Garante que cada `handler:` do serverless.yml aponta para um arquivo e uma função que
 * existem — do jeito que o runtime Node.js da AWS os encontra: no nome do arquivo, o módulo
 * vai até o PRIMEIRO ponto. "dist/x/foo.handler.handler" procura o arquivo "foo.js"
 * (e não "foo.handler.js") — por isso entrypoints de Lambda não podem ter ponto no nome.
 */
describe('handlers do serverless.yml', () => {
  const root = join(__dirname, '..');
  const yml = readFileSync(join(root, 'serverless.yml'), 'utf8');
  const handlers = [...yml.matchAll(/^\s+handler:\s*(\S+)/gm)].map((m) => m[1]);

  it('existe ao menos a função da API', () => {
    expect(handlers).toContain('dist/lambda.handler');
  });

  it.each(handlers)('%s aponta para um arquivo e uma função exportada', (handler) => {
    const dir = posix.dirname(handler);
    const [, moduleName, exportPath] = /^([^.]*)\.(.*)$/.exec(posix.basename(handler))!;
    // dist/<caminho>.js é compilado de src/<caminho>.ts
    const source = join(root, dir.replace(/^dist/, 'src'), `${moduleName}.ts`);

    expect(existsSync(source)).toBe(true);
    expect(exportPath).not.toContain('.'); // export aninhado = nome de arquivo com ponto
    expect(readFileSync(source, 'utf8')).toMatch(
      new RegExp(`export (const|async function|function) ${exportPath}\\b`),
    );
  });
});
