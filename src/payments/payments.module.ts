import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InternalAdminModule } from '../internal-admin/internal-admin.module';
import { PaystackPaymentAdapter } from './paystack.adapter';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [PrismaModule, InternalAdminModule],
  controllers: [PaymentsController],
  providers: [PaystackPaymentAdapter, PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
