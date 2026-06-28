import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DemoDataController } from './demo-data.controller';
import { DemoDataService } from './demo-data.service';

@Module({
  imports: [PrismaModule],
  controllers: [DemoDataController],
  providers: [DemoDataService],
})
export class DemoDataModule {}
