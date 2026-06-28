import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import {
  DemoEnvironmentController,
  LegacyDemoDataController,
} from './demo-data.controller';
import { DemoDataService } from './demo-data.service';

@Module({
  imports: [PrismaModule],
  controllers: [DemoEnvironmentController, LegacyDemoDataController],
  providers: [DemoDataService],
})
export class DemoDataModule {}
