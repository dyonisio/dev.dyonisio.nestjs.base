/**
 * Cria (se não existir) o usuário administrador inicial.
 * Uso: npm run seed  (lê ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD do .env)
 *
 * Sem ADMIN_PASSWORD, gera uma senha aleatória e a mostra UMA vez no terminal.
 * Nunca existe senha padrão: uma senha conhecida num admin de produção é a invasão mais fácil.
 */
import { randomBytes } from 'crypto';
import dataSource from '../data-source';
import { hashPassword } from '../../common/crypto/password-hash';
import { Role } from '../../common/enums/role.enum';
import { User } from '../../users/entities/user.entity';

/** Valores de exemplo da documentação/.env.example — recusados fora do desenvolvimento. */
const EXAMPLE_PASSWORDS = ['Admin@123456', 'Password123', 'Senha123'];

async function run() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error('Defina ADMIN_EMAIL (e-mail do administrador inicial)');
  const name = process.env.ADMIN_NAME || 'Administrador';

  let password = process.env.ADMIN_PASSWORD;
  if (process.env.NODE_ENV === 'production' && password && EXAMPLE_PASSWORDS.includes(password)) {
    throw new Error('ADMIN_PASSWORD está com um valor de exemplo — use uma senha forte');
  }
  const generated = !password;
  password ??= `${randomBytes(12).toString('base64url')}9a`; // garante letra + número

  await dataSource.initialize();
  const repo = dataSource.getRepository(User);

  if (await repo.exists({ where: { email } })) {
    console.log(`[seed] Admin ${email} já existe — nada a fazer.`);
  } else {
    await repo.save(
      repo.create({
        name,
        email,
        password: await hashPassword(password),
        role: Role.ADMIN,
        emailVerifiedAt: new Date(),
      }),
    );
    console.log(`[seed] Admin ${email} criado.`);
    if (generated) {
      console.log(`[seed] Senha gerada (anote agora, ela não é mostrada de novo): ${password}`);
    }
  }

  await dataSource.destroy();
}

run().catch((err) => {
  console.error('[seed] Falhou:', err);
  process.exit(1);
});
