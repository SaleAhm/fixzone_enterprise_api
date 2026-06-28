import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';

type JwtUser = {
  sub: string;
  email?: string | null;
  phone?: string | null;
  fullName?: string;
  role?: string;
  organizationId?: string | null;
};

@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOrganizationDto, _user: JwtUser) {
    const name = dto.name?.trim();

    if (!name) {
      throw new BadRequestException('Organization name is required');
    }

    return this.prisma.organization.create({
      data: { name },
    });
  }

  async findAll() {
    return this.prisma.organization.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async getMine(user: JwtUser) {
    if (user.role === 'SUPER_ADMIN' && !user.organizationId) {
      return {
        id: 'platform',
        name: 'Global Platform Admin',
        description: 'Platform-wide access',
        platformWide: true,
      };
    }

    if (!user.organizationId) {
      throw new NotFoundException('User is not linked to any organization');
    }

    const organization = await this.prisma.organization.findUnique({
      where: {
        id: user.organizationId,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }
}
