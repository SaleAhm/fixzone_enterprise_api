import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { PlatformToolsService } from './platform-tools.service';

@Injectable()
export class MaintenanceMiddleware implements NestMiddleware {
  constructor(
    private readonly platformTools: PlatformToolsService,
    private readonly jwtService: JwtService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    if (
      req.path.includes('/platform-tools/maintenance') ||
      req.path.includes('/auth/login') ||
      req.path.includes('/auth/me')
    ) {
      next();
      return;
    }

    const state = await this.platformTools.getMaintenance();
    if (!state.enabled) {
      next();
      return;
    }

    if (state.allowAdminBypass && this.isAdminRequest(req)) {
      next();
      return;
    }

    res.status(503).json({
      statusCode: 503,
      message: state.message,
      maintenance: true,
      estimatedCompletionTime: state.estimatedCompletionTime,
    });
  }

  private isAdminRequest(req: Request) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return false;

    try {
      const payload = this.jwtService.decode(token) as {
        role?: UserRole;
      } | null;
      return (
        payload?.role === UserRole.SUPER_ADMIN ||
        payload?.role === UserRole.ORG_ADMIN ||
        payload?.role === UserRole.DISPATCH_OFFICER
      );
    } catch {
      return false;
    }
  }
}
