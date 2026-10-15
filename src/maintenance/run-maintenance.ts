/**
 * Job de manutenção pela linha de comando:
 *   npm run maintenance        (dev, com ts-node)
 *   npm run maintenance:prod   (JS compilado — ex.: tarefa agendada no ECS)
 */
import { handler } from './maintenance.handler';

handler()
  .then((report) => console.log(JSON.stringify(report)))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
