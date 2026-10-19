/**
 * Invoca o handler compilado da Lambda (dist/lambda.js) com um evento fake do
 * API Gateway HTTP API — útil para validar o bundle antes do deploy, sem AWS.
 *
 * Uso: npm run build && npx ts-node scripts/invoke-lambda-local.ts [GET] [/api/health]
 * (usa as variáveis do .env; para testar sem Postgres: DB_TYPE=sqljs)
 */
import 'dotenv/config';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

async function main() {
  const [method = 'GET', path = '/api/health'] = process.argv.slice(2);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { handler } = require('../dist/lambda');

  const event: Partial<APIGatewayProxyEventV2> = {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: { host: 'localhost', 'content-type': 'application/json' },
    requestContext: {
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'local' },
      stage: '$default',
    } as APIGatewayProxyEventV2['requestContext'],
    isBase64Encoded: false,
  };

  const result = await handler(event, { functionName: 'local' }, () => undefined);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
