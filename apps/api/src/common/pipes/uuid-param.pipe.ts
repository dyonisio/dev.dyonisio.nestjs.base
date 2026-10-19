import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';
import { i18nKey } from '../../i18n/translations';

/** :id deve ser UUID — com mensagem traduzível em vez da padrão do Nest. */
export const UuidParam = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException(i18nKey('errors.invalidUuid')),
});
