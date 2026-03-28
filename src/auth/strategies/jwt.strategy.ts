import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET || 'fixzone_access_secret',
    });
  }

  async validate(payload: {
    sub: string;
    email?: string | null;
    phone?: string | null;
    fullName?: string;
    role: string;
    organizationId?: string | null;
  }) {
    return {
      id: payload.sub,
      email: payload.email ?? null,
      phone: payload.phone ?? null,
      fullName: payload.fullName,
      role: this.normalizeRole(payload.role),
      organizationId: payload.organizationId ?? null,
    };
  }

  private normalizeRole(role: string): string {
    switch (String(role).toUpperCase()) {
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
        return String(role).toLowerCase();
    }
  }
}