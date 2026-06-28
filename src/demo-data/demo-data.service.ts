import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ReportStatus, UserRole, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

type JwtUser = {
  id?: string;
  userId?: string;
  sub?: string;
  role: UserRole;
};

type DemoSeedResult = {
  demoBatchId: string;
  created: {
    organizations: number;
    citizens: number;
    providers: number;
    reports: number;
    notifications: number;
  };
  demoLoginHint: {
    password: string;
    providerEmail: string;
    citizenEmail: string;
  };
};

@Injectable()
export class DemoDataService {
  private readonly logger = new Logger(DemoDataService.name);

  constructor(private readonly prisma: PrismaService) {}

  async seed(user: JwtUser): Promise<DemoSeedResult> {
    const superAdminId = this.requireSuperAdmin(user);
    const demoBatchId = `demo-${new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const password = 'DemoPassword123!';
    const passwordHash = await bcrypt.hash(password, 10);
    const tag = {
      isDemo: true,
      demoBatchId,
      createdBySuperAdminId: superAdminId,
    };

    this.logger.warn({
      message: 'Super Admin started demo data seed',
      superAdminId,
      demoBatchId,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: `FixZone Demo District ${demoBatchId.slice(-4).toUpperCase()}`,
          ...tag,
        },
      });

      const providers: User[] = [];
      for (const [index, fullName] of this.providerNames.entries()) {
        providers.push(
          await tx.user.create({
            data: {
              fullName,
              email: `demo.provider.${index + 1}.${demoBatchId}@fixzone.test`,
              phone: `+2348009${String(index + 1).padStart(6, '0')}`,
              passwordHash,
              role: UserRole.PROVIDER,
              organizationId: organization.id,
              ...tag,
            },
          }),
        );
      }

      const citizens: User[] = [];
      for (const [index, fullName] of this.citizenNames.entries()) {
        citizens.push(
          await tx.user.create({
            data: {
              fullName,
              email: `demo.citizen.${index + 1}.${demoBatchId}@fixzone.test`,
              phone: `+2348019${String(index + 1).padStart(6, '0')}`,
              passwordHash,
              role: UserRole.CITIZEN,
              organizationId: organization.id,
              ...tag,
            },
          }),
        );
      }

      let reports = 0;
      let notifications = 0;
      const statuses = [
        ReportStatus.PENDING,
        ReportStatus.ASSIGNED,
        ReportStatus.IN_PROGRESS,
        ReportStatus.COMPLETED_BY_PROVIDER,
        ReportStatus.CLOSED,
      ];

      for (let i = 0; i < 25; i++) {
        const template = this.reportTemplates[i % this.reportTemplates.length];
        const status = statuses[i % statuses.length];
        const citizen = citizens[i % citizens.length];
        const provider = providers[i % providers.length];
        const assigned =
          status === ReportStatus.PENDING ? null : provider.id;
        const createdAt = this.daysAgo(24 - i);
        const updatedAt = this.daysAgo(Math.max(0, 23 - i));

        const report = await tx.report.create({
          data: {
            title: template.title,
            description: template.description,
            category: template.category,
            location: template.location,
            latitude: template.latitude,
            longitude: template.longitude,
            status,
            citizenId: citizen.id,
            organizationId: organization.id,
            assignedProviderId: assigned,
            assignedAt: assigned ? updatedAt : null,
            completedByProviderAt:
              status === ReportStatus.COMPLETED_BY_PROVIDER ||
              status === ReportStatus.CLOSED
                ? updatedAt
                : null,
            completionNote:
              status === ReportStatus.COMPLETED_BY_PROVIDER ||
              status === ReportStatus.CLOSED
                ? 'Demo provider marked this job complete for review.'
                : null,
            citizenRating: status === ReportStatus.CLOSED ? 5 : null,
            citizenFeedback:
              status === ReportStatus.CLOSED
                ? 'Demo citizen confirmed the work was resolved.'
                : null,
            createdAt,
            updatedAt,
            ...tag,
          },
        });
        reports += 1;

        const notificationData = this.notificationForStatus(status, report.title);
        await tx.notification.create({
          data: {
            userId: citizen.id,
            reportId: report.id,
            type: notificationData.type,
            title: notificationData.title,
            message: notificationData.message,
            read: i % 3 === 0,
            createdAt: updatedAt,
            ...tag,
          },
        });
        notifications += 1;
      }

      return {
        organizations: 1,
        citizens: citizens.length,
        providers: providers.length,
        reports,
        notifications,
        providerEmail: providers[0].email ?? '',
        citizenEmail: citizens[0].email ?? '',
      };
    });

    this.logger.warn({
      message: 'Super Admin completed demo data seed',
      superAdminId,
      demoBatchId,
      created: result,
    });

    return {
      demoBatchId,
      created: {
        organizations: result.organizations,
        citizens: result.citizens,
        providers: result.providers,
        reports: result.reports,
        notifications: result.notifications,
      },
      demoLoginHint: {
        password,
        providerEmail: result.providerEmail,
        citizenEmail: result.citizenEmail,
      },
    };
  }

  async purge(user: JwtUser) {
    const superAdminId = this.requireSuperAdmin(user);
    this.logger.warn({
      message: 'Super Admin started demo data purge',
      superAdminId,
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const notifications = await tx.notification.deleteMany({
        where: { isDemo: true },
      });
      const reports = await tx.report.deleteMany({ where: { isDemo: true } });
      const users = await tx.user.deleteMany({ where: { isDemo: true } });
      const organizations = await tx.organization.deleteMany({
        where: { isDemo: true },
      });

      return {
        notifications: notifications.count,
        reports: reports.count,
        users: users.count,
        organizations: organizations.count,
      };
    });

    this.logger.warn({
      message: 'Super Admin completed demo data purge',
      superAdminId,
      deleted: result,
    });

    return { deleted: result };
  }

  private requireSuperAdmin(user: JwtUser) {
    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super Admin only');
    }

    const id = user.id ?? user.userId ?? user.sub;
    if (!id) throw new ForbiddenException('User id missing');
    return id;
  }

  private daysAgo(days: number) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }

  private notificationForStatus(status: ReportStatus, title: string) {
    switch (status) {
      case ReportStatus.ASSIGNED:
        return {
          type: 'assigned',
          title: 'Report assigned',
          message: `Demo report "${title}" has been assigned to a provider.`,
        };
      case ReportStatus.IN_PROGRESS:
        return {
          type: 'status_update',
          title: 'Work started',
          message: `A demo provider has started work on "${title}".`,
        };
      case ReportStatus.COMPLETED_BY_PROVIDER:
        return {
          type: 'completion_review',
          title: 'Ready for review',
          message: `Demo report "${title}" is ready for citizen review.`,
        };
      case ReportStatus.CLOSED:
        return {
          type: 'resolved',
          title: 'Report closed',
          message: `Demo report "${title}" has been closed.`,
        };
      case ReportStatus.PENDING:
      default:
        return {
          type: 'acknowledged',
          title: 'Report received',
          message: `Demo report "${title}" has been received.`,
        };
    }
  }

  private readonly providerNames = [
    'Aisha Technical Services',
    'Musa Rapid Repairs',
    'Greenline Sanitation Crew',
    'Northbridge Electrical Team',
    'CivicWorks Maintenance',
  ];

  private readonly citizenNames = [
    'Amina Yusuf',
    'Chinedu Okafor',
    'Grace Danladi',
    'Ibrahim Lawal',
    'Khadija Bello',
    'Maryam Sani',
    'Samuel Adeyemi',
    'Zainab Musa',
  ];

  private readonly reportTemplates = [
    {
      title: 'Blocked drainage near community market',
      description:
        'Water is collecting after rainfall and needs clearing before it affects nearby shops.',
      category: 'Water & Sanitation',
      location: 'Community Market Road',
      latitude: 9.082,
      longitude: 7.491,
    },
    {
      title: 'Street light outage at main junction',
      description:
        'The junction has been dark at night and pedestrians are avoiding the area.',
      category: 'Electricity',
      location: 'Main Junction',
      latitude: 9.084,
      longitude: 7.496,
    },
    {
      title: 'Road surface damage causing slow traffic',
      description:
        'A damaged section of road is forcing vehicles into the opposite lane.',
      category: 'Road & Infrastructure',
      location: 'Ring Road Extension',
      latitude: 9.079,
      longitude: 7.488,
    },
    {
      title: 'Overflowing waste collection point',
      description:
        'Waste has exceeded the collection bin and is spilling onto the walkway.',
      category: 'Waste Management',
      location: 'Central Bus Stop',
      latitude: 9.087,
      longitude: 7.485,
    },
    {
      title: 'Exposed cable beside footpath',
      description:
        'An electrical cable is exposed near a footpath used by residents.',
      category: 'Public Safety',
      location: 'Unity Close',
      latitude: 9.076,
      longitude: 7.492,
    },
  ];
}
