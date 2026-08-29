import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InternalAdminController } from './internal-admin.controller';
import { InternalAdminService } from './internal-admin.service';

@Module({
  imports: [PrismaModule],
  controllers: [InternalAdminController],
  providers: [InternalAdminService],
  exports: [InternalAdminService],
})
export class InternalAdminModule {}
