import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformModulesController } from './platform-modules.controller';
import { PlatformModulesService } from './platform-modules.service';

@Module({
  imports: [PrismaModule],
  controllers: [PlatformModulesController],
  providers: [PlatformModulesService],
  exports: [PlatformModulesService],
})
export class PlatformModulesModule {}
