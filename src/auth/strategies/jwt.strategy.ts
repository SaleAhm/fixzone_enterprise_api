import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type JwtPayload = {
  sub: string;
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  role: UserRole;
  organizationId?: string | null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET || 'fixzone_access_secret',
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        secureZoneId: true,
        email: true,
        phone: true,
        firebaseUid: true,
        fullName: true,
        role: true,
        organizationId: true,
        providerId: true,
        accountStatus: true,
        providerEngagementType: true,
        serviceCategories: true,
        coverageAreas: true,
        profileData: true,
        subscriptionPlan: true,
        identityVerificationStatus: true,
        identityVerificationLevel: true,
        trustScore: true,
        identityType: true,
        createdAt: true,
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
            subscriptionPlan: true,
            billingStatus: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    return {
      id: user.id, // ✅ primary id (used everywhere)
      userId: user.id, // ✅ backward compatibility
      sub: user.id, // ✅ JWT standard
      email: user.email,
      secureZoneId: user.secureZoneId,
      phone: user.phone,
      firebaseUid: user.firebaseUid,
      fullName: user.fullName,
      role: user.role,
      organizationId: user.organizationId,
      providerId: user.providerId,
      accountStatus: user.accountStatus,
      providerEngagementType: user.providerEngagementType,
      serviceCategories: user.serviceCategories,
      coverageAreas: user.coverageAreas,
      profileData: user.profileData,
      subscriptionPlan: user.subscriptionPlan,
      identityVerificationStatus: user.identityVerificationStatus,
      identityVerificationLevel: user.identityVerificationLevel,
      trustScore: user.trustScore,
      identityType: user.identityType,
      organization: user.organization,
    };
  }
}
