import { ApiProperty } from '@nestjs/swagger';
import { Session } from '../entities/session.entity';

export class SessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({
    nullable: true,
    example: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ...',
    description: 'Raw user agent of the browser/app that signed in',
  })
  userAgent: string | null;

  @ApiProperty({ nullable: true, example: '203.0.113.7', description: 'Last IP seen' })
  ip: string | null;

  @ApiProperty({ description: 'When the session was opened (sign-in)' })
  createdAt: Date;

  @ApiProperty({ nullable: true, description: 'Last token refresh' })
  lastUsedAt: Date | null;

  @ApiProperty({ description: 'true = the session making this request' })
  current: boolean;

  static from(session: Session, currentSessionId?: string): SessionResponseDto {
    return {
      id: session.id,
      userAgent: session.userAgent,
      ip: session.ip,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      current: session.id === currentSessionId,
    };
  }
}
