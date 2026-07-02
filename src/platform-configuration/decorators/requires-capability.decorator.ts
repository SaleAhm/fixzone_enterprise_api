import { SetMetadata } from '@nestjs/common';

export const REQUIRES_CAPABILITY_KEY = 'securezone:requires-capability';

export type RequiresCapabilityMetadata = {
  capabilityId: string;
  nonBlocking?: boolean;
};

export const RequiresCapability = (
  capabilityId: string,
  options: { nonBlocking?: boolean } = {},
) =>
  SetMetadata(REQUIRES_CAPABILITY_KEY, {
    capabilityId,
    nonBlocking: options.nonBlocking ?? true,
  } satisfies RequiresCapabilityMetadata);
