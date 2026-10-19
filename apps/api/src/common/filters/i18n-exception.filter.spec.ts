import { ArgumentsHost, BadRequestException, HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { I18nRequest, I18nService } from '../../i18n/i18n.service';
import { I18nExceptionFilter } from './i18n-exception.filter';

describe('I18nExceptionFilter', () => {
  const i18n = new I18nService({ get: () => 'en' } as unknown as ConfigService);
  const filter = new I18nExceptionFilter(i18n);

  /** Executa o filtro e devolve { status, body } enviados na resposta. */
  function run(exception: unknown, req: Partial<I18nRequest> = { lang: 'pt-BR' }) {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {}, ...req }), getResponse: () => res }),
    } as unknown as ArgumentsHost;

    filter.catch(exception, host);
    return { status: res.status.mock.calls[0][0] as number, body: res.json.mock.calls[0][0] };
  }

  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('traduz exceções lançadas com uma chave', () => {
    expect(run(new BadRequestException('users.cannotDeleteSelf'))).toEqual({
      status: 400,
      body: {
        statusCode: 400,
        code: 'users.cannotDeleteSelf',
        message: 'Você não pode remover a sua própria conta',
      },
    });
  });

  it('interpola argumentos ({ key, args })', () => {
    const { body } = run(
      new HttpException({ key: 'errors.tooManyRequests', args: { seconds: 42 } }, 429),
    );
    expect(body.message).toBe('Muitas tentativas. Tente novamente em 42 segundos.');
  });

  it('aceita response em string (HttpException("chave", status))', () => {
    expect(run(new HttpException('auth.forbidden', 403)).body.code).toBe('auth.forbidden');
  });

  it('mensagem que não é chave -> mensagem genérica do status', () => {
    expect(run(new BadRequestException('Unexpected token } in JSON')).body).toEqual({
      statusCode: 400,
      code: 'errors.http.400',
      message: 'Requisição inválida',
    });
  });

  it('status sem tradução genérica -> mantém a mensagem original', () => {
    expect(run(new HttpException('I am a teapot', 418)).body).toEqual({
      statusCode: 418,
      code: 'errors.http.418',
      message: 'I am a teapot',
    });
  });

  it('status sem tradução e mensagem que não é texto -> mensagem vazia', () => {
    expect(run(new HttpException({ message: ['a', 'b'] }, 418)).body.message).toBe('');
  });

  it('corpo customizado sem key/message (ex.: health check) passa sem alteração', () => {
    const body = { status: 'error', database: 'down' };
    expect(run(new HttpException(body, 503))).toEqual({ status: 503, body });
  });

  it('erro inesperado (não-HTTP) vira 500 traduzido e é logado com stack', () => {
    const logged = jest.spyOn(Logger.prototype, 'error');
    const { status, body } = run(new Error('conexão com o banco caiu'));

    expect(status).toBe(500);
    expect(body).toEqual({
      statusCode: 500,
      code: 'errors.http.500',
      message: 'Erro interno do servidor',
    });
    expect(body.message).not.toContain('banco'); // detalhes internos não vazam
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('conexão com o banco caiu'));
  });

  it('valor lançado que nem é Error também é tratado', () => {
    const logged = jest.spyOn(Logger.prototype, 'error');
    expect(run('falha').status).toBe(500);
    expect(logged).toHaveBeenCalledWith('falha');
  });

  it('erros de validação: traduz cada campo; chave desconhecida vira validation.invalid', () => {
    const { body } = run(
      new BadRequestException({
        key: 'errors.validation',
        issues: [
          { field: 'password', key: 'validation.minLength', args: { min: 8 } },
          { field: 'address.zip', key: 'validation.regraInventada', args: {} },
        ],
      }),
    );

    expect(body.errors).toEqual([
      {
        field: 'password',
        code: 'validation.minLength',
        message: 'senha deve ter pelo menos 8 caracteres',
      },
      { field: 'address.zip', code: 'validation.invalid', message: 'address.zip é inválido' },
    ]);
  });

  it('sem idioma resolvido pelo middleware, resolve pelo Accept-Language', () => {
    const { body } = run(new BadRequestException('users.notFound'), {
      headers: { 'accept-language': 'en-US' },
    });
    expect(body.message).toBe('User not found');
  });
});
