import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async register(dto: RegisterDto) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Email or phone is required');
    }

    const orFilters = [
      dto.email ? { email: dto.email } : null,
      dto.phone ? { phone: dto.phone } : null,
    ].filter((v): v is { email: string } | { phone: string } => v !== null);

    const existing = await this.prisma.user.findFirst({
      where: {
        OR: orFilters,
      },
    });

    if (existing) {
      throw new BadRequestException('User already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const prismaRole = this.mapApiRoleToPrismaRole(dto.role);

    const user = await this.prisma.user.create({
      data: {
        fullName: dto.fullName,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        passwordHash,
        role: prismaRole,
        organizationId: dto.organizationId ?? null,
      },
    });

    return this.issueTokens(user);
  }

  async login(dto: LoginDto) {
    const orFilters = [
      dto.email ? { email: dto.email } : null,
      dto.phone ? { phone: dto.phone } : null,
    ].filter((v): v is { email: string } | { phone: string } => v !== null);

    const user = await this.prisma.user.findFirst({
      where: {
        OR: orFilters,
      },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);

    if (!ok) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokens(user);
  }

  private mapApiRoleToPrismaRole(role: string): UserRole {
    switch (role.toLowerCase()) {
      case 'admin':
        return UserRole.ORG_ADMIN;
      case 'provider':
        return UserRole.PROVIDER;
      case 'citizen':
        return UserRole.CITIZEN;
      default:
        throw new BadRequestException(`Unsupported role: ${role}`);
    }
  }

  private mapPrismaRoleToApiRole(role: UserRole | string): string {
    switch (role) {
      case UserRole.SUPER_ADMIN:
      case UserRole.ORG_ADMIN:
      case UserRole.DISPATCH_OFFICER:
        return 'admin';
      case UserRole.PROVIDER:
        return 'provider';
      case UserRole.CITIZEN:
        return 'citizen';
      default:
        return String(role).toLowerCase();
    }
  }

  private async issueTokens(user: {
    id: string;
    email: string | null;
    phone: string | null;
    fullName: string;
    role: UserRole | string;
    organizationId: string | null;
  }) {
    const payload = {
      sub: user.id,
      email: user.email,
      phone: user.phone,
      fullName: user.fullName,
      role: this.mapPrismaRoleToApiRole(user.role),
      organizationId: user.organizationId,
    };

    return {
      user: payload,
      accessToken: await this.jwtService.signAsync(payload, {
        secret: process.env.JWT_ACCESS_SECRET || 'fixzone_access_secret',
        expiresIn: '1d',
      }),
    };
  }
}