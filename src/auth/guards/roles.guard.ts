import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.role) {
      return false;
    }

    const userRole = this.normalizeRole(String(user.role));
    const allowedRoles = requiredRoles.map((role) =>
      this.normalizeRole(String(role)),
    );

    return allowedRoles.includes(userRole);
  }

  private normalizeRole(role: string): string {
    switch (role.toUpperCase()) {
      case 'SUPER_ADMIN':
      case 'ORG_ADMIN':
      case 'DISPATCH_OFFICER':
      case 'ADMIN':
        return 'admin';
      case 'PROVIDER':
        return 'provider';
      case 'CITIZEN':
        return 'citizen';
      default:
        return role.toLowerCase();
    }
  }
}