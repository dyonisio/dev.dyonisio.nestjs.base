import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

/** ThrottlerGuard com resposta 429 traduzida ("Tente novamente em X segundos"). */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  // eslint-disable-next-line @typescript-eslint/require-await
  protected async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new HttpException(
      { key: 'errors.tooManyRequests', args: { seconds: Math.max(1, detail.timeToBlockExpire) } },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
