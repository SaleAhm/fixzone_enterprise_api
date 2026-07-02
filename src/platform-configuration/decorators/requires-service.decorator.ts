import { SetMetadata } from '@nestjs/common';

export const REQUIRES_SERVICE_KEY = 'securezone:requires-service';

export type RequiresServiceMetadata = {
  serviceType: string;
  nonBlocking?: boolean;
};

export const RequiresService = (
  serviceType: string,
  options: { nonBlocking?: boolean } = {},
) =>
  SetMetadata(REQUIRES_SERVICE_KEY, {
    serviceType,
    nonBlocking: options.nonBlocking ?? true,
  } satisfies RequiresServiceMetadata);
