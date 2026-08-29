import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  EnterpriseRateLimit,
  RateLimitTier,
} from '../security/rate-limit.constants';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { ReconcilePaymentsDto } from './dto/reconcile-payments.dto';
import { PaymentsService } from './payments.service';
import { RequestUser } from './payment.types';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('plans')
  @EnterpriseRateLimit(RateLimitTier.PublicRead)
  listPlans() {
    return this.payments.listPlans();
  }

  @Post('organization/:organizationId/initialize')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.BILLING_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  initialize(
    @Param('organizationId') organizationId: string,
    @Body() dto: InitializePaymentDto,
    @Req() req: Request,
  ) {
    return this.payments.initializeOrganizationPayment(
      organizationId,
      dto.planCode,
      req.user as RequestUser,
    );
  }

  @Get('organization/:organizationId/subscription')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.BILLING_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  subscription(
    @Param('organizationId') organizationId: string,
    @Req() req: Request,
  ) {
    return this.payments.getOrganizationSubscription(
      organizationId,
      req.user as RequestUser,
    );
  }

  @Get('organization/:organizationId/history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.BILLING_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  history(
    @Param('organizationId') organizationId: string,
    @Req() req: Request,
  ) {
    return this.payments.listPaymentHistory(
      organizationId,
      req.user as RequestUser,
    );
  }

  @Get('organization/:organizationId/transactions/:reference')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.BILLING_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  status(
    @Param('organizationId') organizationId: string,
    @Param('reference') reference: string,
    @Req() req: Request,
  ) {
    return this.payments.getTransactionStatus(
      organizationId,
      reference,
      req.user as RequestUser,
    );
  }

  @Post('organization/:organizationId/transactions/:reference/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.BILLING_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  verify(
    @Param('organizationId') organizationId: string,
    @Param('reference') reference: string,
    @Req() req: Request,
  ) {
    return this.payments.verifyTransaction(
      organizationId,
      reference,
      req.user as RequestUser,
    );
  }

  @Get('organization/:organizationId/receipts/:receiptNumber')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN, UserRole.BILLING_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminRead)
  receipt(
    @Param('organizationId') organizationId: string,
    @Param('receiptNumber') receiptNumber: string,
    @Req() req: Request,
  ) {
    return this.payments.getReceipt(
      organizationId,
      receiptNumber,
      req.user as RequestUser,
    );
  }

  @Post('webhooks/paystack')
  handlePaystackWebhook(
    @Req() req: RawBodyRequest,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    return this.payments.handlePaystackWebhook(
      req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})),
      signature,
    );
  }

  @Post('admin/reconcile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  reconcile(@Body() dto: ReconcilePaymentsDto, @Req() req: Request) {
    return this.payments.reconcilePending(req.user as RequestUser, dto.limit);
  }
}
