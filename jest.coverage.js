/**
 * Cobertura COMBINADA: testes unitários + e2e numa única execução, com um relatório só.
 * Uso: npm run test:cov   (relatório HTML em coverage/lcov-report/index.html)
 *
 * Por que combinada? Controllers, guards e filtros são testados de verdade nos e2e;
 * medir só os unitários daria ~40% e incentivaria testes duplicados.
 */

/** Só conta código com lógica. Arquivos declarativos (DTOs, entidades, módulos...) ficam de fora. */
const collectCoverageFrom = [
  'src/**/*.ts',
  '!src/**/*.spec.ts',
  '!src/main.ts', // bootstrap — coberto pelo e2e via configureApp()
  '!src/lambda.ts',
  '!src/**/*-handler.ts', // entrypoints de Lambda (a lógica fica em arquivos testados)
  '!src/maintenance/run-maintenance.ts', // entrypoint de linha de comando
  '!src/database/**', // migrations (testadas em `npm run test:pg`), seed, data-source da CLI
  '!src/**/dto/**',
  '!src/**/*.entity.ts',
  '!src/**/*.module.ts',
  '!src/**/*.interface.ts',
  '!src/**/*.enum.ts',
];

const base = {
  rootDir: __dirname,
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom,
};

/**
 * Metas (o CI falha abaixo delas). Funcionam como "catraca": ficam um pouco abaixo
 * do valor atual para nunca cair. Quando a cobertura subir, suba o piso também.
 *
 * Valores medidos ao criar as metas (unit + e2e): linhas 99%, branches 95%, funções 99%.
 * As pastas críticas para segurança são cobradas separadamente — um arquivo mal testado
 * ali não pode "se esconder" na média do projeto.
 */
const global = { lines: 95, statements: 95, functions: 95, branches: 88 };
const critical = { lines: 95, statements: 95, functions: 95, branches: 90 };

module.exports = {
  projects: [
    { ...base, displayName: 'unit', testMatch: ['<rootDir>/src/**/*.spec.ts'] },
    {
      ...base,
      displayName: 'e2e',
      testMatch: ['<rootDir>/test/*.e2e-spec.ts'],
      setupFiles: ['<rootDir>/test/setup-env.ts'],
    },
  ],
  // Os e2e sobem a aplicação inteira e, com o cache frio (sempre, no CI), a primeira
  // compilação passa dos 5 s padrão. Precisa ficar AQUI: dentro de `projects` o Jest ignora.
  testTimeout: 30000,
  // Precisa estar também no nível global (além de em cada projeto) para as exclusões valerem
  collectCoverageFrom,
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'text-summary', 'json-summary', 'lcov'],
  coverageThreshold: {
    global,
    './src/auth/services/': critical,
    './src/auth/strategies/': critical,
    './src/auth/two-factor/': critical,
    './src/auth/social/': critical,
    './src/common/crypto/': critical,
    './src/common/guards/': critical,
    './src/common/validators/': critical,
    './src/rate-limit/': critical,
    './src/sessions/': critical,
    './src/users/account/': critical,
  },
};
