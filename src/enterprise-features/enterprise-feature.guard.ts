import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  ENTERPRISE_FEATURES,
  ENTERPRISE_FOUNDATION_MASTER_ENV,
  enterpriseFlagEnabled,
} from './enterprise-feature.config';
import {
  ENTERPRISE_FEATURE_KEY,
  EnterpriseFeatureKey,
} from './enterprise-feature.decorator';

type EnterpriseFeatureUser = {
  id?: string;
  userId?: string;
  sub?: string;
  role?: UserRole;
  organizationId?: string | null;
};

@Injectable()
export class EnterpriseFeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<EnterpriseFeatureKey>(
      ENTERPRISE_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!feature) return true;

    const config = ENTERPRISE_FEATURES[feature];
    if (!config) {
      await this.auditDenied(context, feature, 'unknown_feature');
      throw this.unavailable(feature);
    }

    if (
      !enterpriseFlagEnabled(process.env[ENTERPRISE_FOUNDATION_MASTER_ENV]) ||
      !enterpriseFlagEnabled(process.env[config.envName])
    ) {
      await this.auditDenied(context, feature, 'configuration_disabled');
      throw this.unavailable(feature);
    }

    const user = this.userFromContext(context);
    if (user?.organizationId) {
      const organization = await this.prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { enabledModules: true },
      });
      if (
        !this.enabledModules(organization?.enabledModules).includes(
          config.moduleKey,
        )
      ) {
        await this.auditDenied(context, feature, 'module_disabled');
        throw this.unavailable(feature);
      }
    }

    return true;
  }

  private unavailable(feature: EnterpriseFeatureKey) {
    const config = ENTERPRISE_FEATURES[feature];
    return new ServiceUnavailableException({
      code: 'ENTERPRISE_FEATURE_UNAVAILABLE',
      feature,
      message: `${config?.displayName ?? 'Enterprise foundation'} is not enabled for this release.`,
    });
  }

  private enabledModules(value: Prisma.JsonValue | undefined): string[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0);
  }

  private userFromContext(
    context: ExecutionContext,
  ): EnterpriseFeatureUser | undefined {
    const request = context.switchToHttp().getRequest<{
      user?: EnterpriseFeatureUser;
    }>();
    return request.user;
  }

  private async auditDenied(
    context: ExecutionContext,
    feature: EnterpriseFeatureKey,
    reason: string,
  ) {
    const user = this.userFromContext(context);
    const actorId = user?.id ?? user?.userId ?? user?.sub;
    if (!actorId) return;

    const request = context.switchToHttp().getRequest<{
      ip?: string;
      method?: string;
      route?: { path?: string };
      originalUrl?: string;
      url?: string;
      get?: (name: string) => string | undefined;
    }>();

    try {
      await this.prisma.complianceAuditLog.create({
        data: {
          actorId,
          actorRole: user?.role as UserRole,
          organizationId: user?.organizationId ?? null,
          action: 'Enterprise Feature Access Denied',
          entityType: 'EnterpriseFeature',
          entityId: feature,
          metadata: {
            feature,
            reason,
            method: request.method ?? null,
            path: request.route?.path ?? request.originalUrl ?? request.url,
            ipAddress: request.ip ?? null,
            userAgent: request.get?.('user-agent') ?? null,
          } as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Feature denial must not disclose audit-storage internals to callers.
    }
  }
}
