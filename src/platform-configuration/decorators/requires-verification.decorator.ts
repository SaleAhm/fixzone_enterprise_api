import { SetMetadata } from '@nestjs/common';

export const REQUIRES_VERIFICATION_KEY = 'securezone:requires-verification';

export type RequiresVerificationMetadata = {
  level: number;
  nonBlocking?: boolean;
};

export const RequiresVerification = (
  level: number,
  options: { nonBlocking?: boolean } = {},
) =>
  SetMetadata(REQUIRES_VERIFICATION_KEY, {
    level,
    nonBlocking: options.nonBlocking ?? true,
  } satisfies RequiresVerificationMetadata);
