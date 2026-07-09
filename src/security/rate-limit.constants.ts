import { createHash } from 'crypto';
import { ExecutionContext } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

export enum RateLimitTier {
  PublicRead = 'publicRead',
  Auth = 'auth',
  Registration = 'registration',
  Upload = 'upload',
  NotificationRead = 'notificationRead',
  NotificationMutation = 'notificationMutation',
  AdminRead = 'adminRead',
  AdminMutation = 'adminMutation',
  HeavyJob = 'heavyJob',
}

type RateLimitProfile = {
  limit: number;
  ttl: number;
};

const minute = 60_000;

function envNumber(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function rateLimitEnabled() {
  return process.env.RATE_LIMIT_ENABLED !== 'false';
}

export const rateLimitProfiles: Record<'global' | RateLimitTier, RateLimitProfile> = {
  global: {
    limit: envNumber('RATE_LIMIT_GLOBAL_LIMIT', 120),
    ttl: envNumber('RATE_LIMIT_GLOBAL_TTL_MS', minute),
  },
  [RateLimitTier.PublicRead]: {
    limit: envNumber('RATE_LIMIT_PUBLIC_READ_LIMIT', 60),
    ttl: envNumber('RATE_LIMIT_PUBLIC_READ_TTL_MS', minute),
  },
  [RateLimitTier.Auth]: {
    limit: envNumber('RATE_LIMIT_AUTH_LIMIT', 5),
    ttl: envNumber('RATE_LIMIT_AUTH_TTL_MS', minute),
  },
  [RateLimitTier.Registration]: {
    limit: envNumber('RATE_LIMIT_REGISTRATION_LIMIT', 3),
    ttl: envNumber('RATE_LIMIT_REGISTRATION_TTL_MS', minute),
  },
  [RateLimitTier.Upload]: {
    limit: envNumber('RATE_LIMIT_UPLOAD_LIMIT', 6),
    ttl: envNumber('RATE_LIMIT_UPLOAD_TTL_MS', minute),
  },
  [RateLimitTier.NotificationRead]: {
    limit: envNumber('RATE_LIMIT_NOTIFICATION_READ_LIMIT', 60),
    ttl: envNumber('RATE_LIMIT_NOTIFICATION_READ_TTL_MS', minute),
  },
  [RateLimitTier.NotificationMutation]: {
    limit: envNumber('RATE_LIMIT_NOTIFICATION_MUTATION_LIMIT', 30),
    ttl: envNumber('RATE_LIMIT_NOTIFICATION_MUTATION_TTL_MS', minute),
  },
  [RateLimitTier.AdminRead]: {
    limit: envNumber('RATE_LIMIT_ADMIN_READ_LIMIT', 60),
    ttl: envNumber('RATE_LIMIT_ADMIN_READ_TTL_MS', minute),
  },
  [RateLimitTier.AdminMutation]: {
    limit: envNumber('RATE_LIMIT_ADMIN_MUTATION_LIMIT', 10),
    ttl: envNumber('RATE_LIMIT_ADMIN_MUTATION_TTL_MS', minute),
  },
  [RateLimitTier.HeavyJob]: {
    limit: envNumber('RATE_LIMIT_HEAVY_JOB_LIMIT', 2),
    ttl: envNumber('RATE_LIMIT_HEAVY_JOB_TTL_MS', minute),
  },
};

export function EnterpriseRateLimit(tier: RateLimitTier) {
  const profile = rateLimitProfiles[tier];
  return Throttle({
    default: {
      limit: profile.limit,
      ttl: profile.ttl,
      getTracker: rateLimitTracker,
    },
  });
}

export function rateLimitTracker(req: Record<string, any>) {
  const authToken = bearerToken(req.headers?.authorization);
  if (authToken) {
    return `token:${hash(authToken)}`;
  }

  const ip = clientIp(req);
  const identifier = requestIdentifier(req);
  return identifier ? `${ip}:${identifier}` : ip;
}

export function rateLimitSkip(context: ExecutionContext) {
  if (!rateLimitEnabled()) return true;

  const request = context.switchToHttp().getRequest<Record<string, any>>();
  const path = normalizedPath(request);
  return path === '/api/health' || path === '/health';
}

function requestIdentifier(req: Record<string, any>) {
  const path = normalizedPath(req);
  const body = req.body ?? {};

  if (path.endsWith('/auth/login')) {
    return valueHash(body.email ?? body.phone ?? body.providerId);
  }

  if (path.endsWith('/auth/firebase-login')) {
    return valueHash(body.idToken);
  }

  if (
    path.endsWith('/auth/register') ||
    path.endsWith('/onboarding/citizen/register') ||
    path.endsWith('/onboarding/provider/request-access') ||
    path.endsWith('/onboarding/organization/register')
  ) {
    return valueHash(
      body.email ?? body.phone ?? body.ownerEmail ?? body.ownerPhone,
    );
  }

  return '';
}

function clientIp(req: Record<string, any>) {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = req.headers?.['x-forwarded-for'];
    const firstForwarded = Array.isArray(forwarded)
      ? forwarded[0]
      : forwarded?.split(',')[0];
    if (firstForwarded?.trim()) return firstForwarded.trim();
  }

  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}

function normalizedPath(req: Record<string, any>) {
  const raw = req.originalUrl ?? req.url ?? '';
  return raw.split('?')[0].toLowerCase();
}

function bearerToken(value: unknown) {
  if (typeof value !== 'string') return '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function valueHash(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) return '';
  return hash(value.trim().toLowerCase());
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
