import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PublicController } from './public.controller';
import { PublicMetricsService } from './public-metrics.service';

@Module({
  imports: [PrismaModule],
  controllers: [PublicController],
  providers: [PublicMetricsService],
})
export class PublicModule {}
