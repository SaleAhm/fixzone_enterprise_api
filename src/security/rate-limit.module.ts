import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  rateLimitProfiles,
  rateLimitSkip,
  rateLimitTracker,
} from './rate-limit.constants';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          limit: rateLimitProfiles.global.limit,
          ttl: rateLimitProfiles.global.ttl,
          getTracker: rateLimitTracker,
        },
      ],
      getTracker: rateLimitTracker,
      skipIf: rateLimitSkip,
      errorMessage: 'Too many requests',
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class RateLimitModule {}
