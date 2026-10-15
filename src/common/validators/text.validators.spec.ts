import { PERSON_NAME_PATTERN, toPersonName } from './text.validators';

describe('nome de pessoa', () => {
  it.each(['Maria', 'José da Silva', "Ana-Clara D'Ávila", 'J. R. Tolkien', '王小明', 'Zoë O’Neil'])(
    'aceita %s',
    (name) => expect(PERSON_NAME_PATTERN.test(name)).toBe(true),
  );

  it.each([
    'Acesse http://evil.com',
    'evil.com',
    'Ana <script>',
    'User 123',
    ' Ana',
    '.Ana',
    'Ana\nBcc: x@y.com',
  ])('recusa %j (links, números, HTML, quebras de linha)', (name) =>
    expect(PERSON_NAME_PATTERN.test(name)).toBe(false),
  );

  it('toPersonName limpa nomes de fora e cai no fallback', () => {
    expect(toPersonName('  Ana   Souza ')).toBe('Ana Souza');
    expect(toPersonName('visite site.com agora')).toBe('visite site com agora');
    expect(toPersonName('12345', 'maria.silva')).toBe('maria silva');
    expect(toPersonName(undefined, '123')).toBe('User');
  });
});
