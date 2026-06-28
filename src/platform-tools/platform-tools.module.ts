import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MaintenanceMiddleware } from './maintenance.middleware';
import { PlatformToolsController } from './platform-tools.controller';
import { PlatformToolsService } from './platform-tools.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PlatformToolsController],
  providers: [PlatformToolsService, MaintenanceMiddleware],
  exports: [PlatformToolsService],
})
export class PlatformToolsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MaintenanceMiddleware).forRoutes('*');
  }
}
