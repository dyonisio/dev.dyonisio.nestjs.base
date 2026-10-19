# Receitas

> Os comandos `npm` e os caminhos deste guia (`.env`, `serverless.yml`, `src/...`) são da API: rode-os em `apps/api`.

Passo a passo para as tarefas mais comuns. Ao terminar qualquer uma, rode:

```bash
npm run lint && npm run typecheck && npm test && npm run test:e2e
```

## Novo módulo (CRUD)

Exemplo: pedidos (`orders`), com leitura para managers e escrita para admins.

**1. Permissões** — em [src/common/enums/permission.enum.ts](../apps/api/src/common/enums/permission.enum.ts):

```ts
export enum Permission {
  // ...
  ORDERS_READ = 'orders:read',
  ORDERS_WRITE = 'orders:write',
}

export const ROLE_PERMISSIONS = {
  [Role.ADMIN]: Object.values(Permission),             // admin ganha as novas sozinho
  [Role.MANAGER]: [Permission.USERS_READ, Permission.ORDERS_READ],
  [Role.USER]: [],
};
```

**2. Entidade** — `src/orders/entities/order.entity.ts`:

```ts
@Entity({ name: 'orders' })
export class Order {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_orders_id' })
  id: string;

  @ApiProperty({ example: 'Pedido #1' })
  @Column({ type: 'varchar', length: 120 })
  title: string;

  @ApiProperty()
  @CreateDateColumn()
  createdAt: Date;
}
```

**3. DTOs** — `src/orders/dto/order.dto.ts`. Todo campo de entrada precisa de validação; campos não declarados são recusados.

```ts
export class CreateOrderDto {
  @ApiProperty({ example: 'Pedido #1', maxLength: 120 })
  @IsBoundedString(120)          // obrigatório, texto, com tamanho máximo
  title: string;
}
export class UpdateOrderDto extends PartialType(CreateOrderDto) {}
```

**4. Service** — regra de negócio e erros traduzidos:

```ts
@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    private readonly audit: AuditService,
  ) {}

  async get(id: string) {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException(i18nKey('orders.notFound'));
    return order;
  }
}
```

Adicione `"orders": { "notFound": "..." }` em **todos** os arquivos de `src/i18n/locales/` (o TypeScript e um teste conferem).

**5. Controller**:

```ts
@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get(':id')
  @Authorize(Permission.ORDERS_READ)
  @ApiOperation({ summary: 'Get an order' })
  @ApiOkResponse({ type: Order })
  @ApiErrors([404, 'Order not found'])
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.get(id);
  }
}
```

**6. Módulo** — `orders.module.ts` com `TypeOrmModule.forFeature([Order])`. Importe-o em `app.module.ts`.

**7. Migration**:

```bash
npm run migration:generate -- src/database/migrations/CreateOrders
```

Revise o arquivo gerado e rode `npm run migration:run`.

**8. Testes** — um e2e em `test/orders.e2e-spec.ts` (copie a estrutura de `test/users-admin.e2e-spec.ts`), testando ao menos:
o caminho feliz, o 403 sem permissão, o 401 sem login e a validação (400).

**9. Contrato** — `npm run openapi:export` e commite o `openapi.json`.

**Dados do próprio usuário** (ex.: "meus pedidos"): filtre **sempre** pelo dono, `where: { id, ownerId: userId }`,
e responda 404 (não 403) quando não for dele, para não revelar que o registro existe.

## Nova permissão ou nova role

- **Permissão:** adicione em `Permission` e às roles que devem tê-la em `ROLE_PERMISSIONS`. Use com `@Authorize(...)`.
- **Role:** adicione em [role.enum.ts](../apps/api/src/common/enums/role.enum.ts) e uma entrada em `ROLE_PERMISSIONS` (um teste exige que toda role esteja no mapa).
  Não precisa de migration (a role é `varchar`). Adicione o nome traduzido em `roles.*` nos locales (aparece no e-mail de troca de role).
- **No front:** rode `npm run api:types` em `apps/web` (a role e as permissões novas entram nos tipos) e adicione o nome
  da role em `roles` no [messages.ts](../apps/web/src/i18n/messages.ts). Uma tela nova protegida usa
  `<RequirePermission permission="...">` (veja [WEB.md](WEB.md#mostrar-algo-só-para-quem-tem-permissão)).

## Migration

- **Gerar a partir das entidades:** `npm run migration:generate -- src/database/migrations/NomeDaMudanca`.
- **Escrever à mão** (dados, índices especiais): `npm run migration:create -- src/database/migrations/NomeDaMudanca`.
- **Sempre** escreva o `down()`. O `npm run test:pg` aplica tudo, compara com as entidades, desfaz e aplica de novo.
- Migration que muda dados existentes: teste em `test/postgres/` (veja os exemplos lá).
- **Nunca** edite uma migration que já foi para produção. Crie outra.

## Novo e-mail

1. Crie o template em **todos** os idiomas: `src/mail/templates/en/invoice-paid.hbs` e `src/mail/templates/pt-BR/invoice-paid.hbs`.
2. Em [mail.types.ts](../apps/api/src/mail/mail.types.ts): `INVOICE_PAID = 'invoice-paid'` no enum e o contexto em `MailTemplateContextMap`.
3. Assunto em `mail.subjects.invoicePaid` nos locales.
4. Um helper no `MailService`, no padrão dos existentes (idioma do usuário):

```ts
sendInvoicePaid(user: MailRecipient, amount: string) {
  const lang = this.resolveLang(user.locale);
  return this.send({
    to: user.email,
    lang,
    subject: this.subject('invoicePaid', lang),
    template: MailTemplate.INVOICE_PAID,
    context: { name: user.name, amount },
  });
}
```

5. Adicione exemplos em `scripts/mail-preview.ts` e no teste `mail-template.service.spec.ts`, e confira com `npm run mail:preview`.

## Novo tipo de upload

Uma linha em [src/files/file-purposes.ts](../apps/api/src/files/file-purposes.ts):

```ts
receipt: { contentTypes: ['application/pdf', 'image/jpeg'], maxSize: 5 * 1024 * 1024, visibility: 'private' },
```

Se o tipo de arquivo for novo, adicione também a extensão (`EXTENSIONS`) e a assinatura (`SIGNATURES`) no mesmo arquivo.
No front, repita os limites em `FILE_LIMITS` ([upload.ts](../apps/web/src/api/upload.ts)) e envie com
`uploadFile(file, 'receipt')`.

No service que usa o arquivo:

```ts
const file = await this.files.consume(userId, dto.fileId, 'receipt'); // é do usuário, está pronto, é desta finalidade
order.receiptFileId = file.id;                                         // guarde o id na sua entidade
```

`consume()` marca o arquivo como "em uso". Sem isso, a limpeza automática o apaga em 24 h. Se o arquivo vale por si só
(ex.: "meus documentos"), use `standalone: true` na finalidade. Ao apagar a sua entidade, chame `files.removeById(id)`.

## Nova tarefa agendada

Em [maintenance.service.ts](../apps/api/src/maintenance/maintenance.service.ts), adicione uma linha em `tasks` (a função devolve quantos itens processou):

```ts
expiredInvites: () => this.invites.deleteExpired(now),
```

Importe o módulo do serviço em `maintenance.module.ts`. A tarefa roda junto com as outras a cada 6 h. Para outro horário, crie
outra função no `serverless.yml` com o seu próprio `schedule`.

## Novo idioma

1. Copie `src/i18n/locales/en.json` para `es.json` e traduza.
2. Registre em [src/i18n/translations.ts](../apps/api/src/i18n/translations.ts): `es` no objeto `TRANSLATIONS`.
3. Crie `src/mail/templates/es/` com todos os templates e `partials/footer.hbs`.
4. Rode `npm test`: os testes de paridade apontam qualquer chave, placeholder ou template faltando.

## Nova variável de ambiente

1. Leia em [configuration.ts](../apps/api/src/config/configuration.ts), com valor padrão e comentário.
2. Se for obrigatória ou perigosa em produção, adicione a regra em [env.validation.ts](../apps/api/src/config/env.validation.ts) (e um teste).
3. Documente no [.env.example](../apps/api/.env.example) e, se for para a Lambda, no `serverless.yml` (segredo → SSM).
4. Use com `this.config.get<number>('secao.nome', padrao)`.

## Ação sensível com confirmação de identidade

Para ações como "transferir saldo" ou "trocar a chave Pix", reaproveite a reautenticação:

```ts
async transfer(userId: string, dto: TransferDto) {          // TransferDto extends ReauthDto
  await this.reauth.confirm(userId, dto);                  // senha (ou login recente) + código 2FA
  // ...
}
```

E coloque `@AuthRateLimit()` na rota.

## Nova versão da API (v2)

Só quando um contrato **precisa** quebrar (renomear campo, mudar formato). Os apps antigos continuam na v1:

```ts
@Controller({ path: 'orders', version: '2' })   // GET /api/v2/orders
export class OrdersV2Controller {}
```

O restante continua em `/api/v1`. Marque a rota antiga com `@ApiOperation({ deprecated: true })` e combine um prazo para removê-la.
