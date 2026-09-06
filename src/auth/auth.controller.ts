import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { AuthService, AuthUser } from './auth.service';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { LoginDto } from './dto/login.dto';
import {
  CompletePasswordResetDto,
  RequestPasswordResetDto,
} from './dto/password-reset.dto';
import {
  CompleteMfaChallengeDto,
  ConfirmMfaEnrollmentDto,
  StartMfaEnrollmentDto,
} from './dto/privileged-mfa.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import {
  EnterpriseRateLimit,
  RateLimitTier,
} from '../security/rate-limit.constants';

type AuthenticatedRequest = Request & { user: AuthUser };

function requestContext(req: Request) {
  const forwardedFor = req.header('x-forwarded-for');
  return {
    ipAddress: req.ip ?? forwardedFor,
    userAgent: req.header('user-agent'),
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @EnterpriseRateLimit(RateLimitTier.Registration)
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @EnterpriseRateLimit(RateLimitTier.Auth)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, requestContext(req));
  }

  @Post('firebase-login')
  @EnterpriseRateLimit(RateLimitTier.Auth)
  firebaseLogin(@Body() dto: FirebaseLoginDto) {
    return this.authService.firebaseLogin(dto);
  }

  @Post('password-reset/request')
  @EnterpriseRateLimit(RateLimitTier.Auth)
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(dto);
  }

  @Post('password-reset/complete')
  @EnterpriseRateLimit(RateLimitTier.Auth)
  completePasswordReset(@Body() dto: CompletePasswordResetDto) {
    return this.authService.completePasswordReset(dto);
  }

  @Post('mfa/enrollment/start')
  @EnterpriseRateLimit(RateLimitTier.Auth)
  startMfaEnrollment(@Body() dto: StartMfaEnrollmentDto, @Req() req: Request) {
    return this.authService.startMfaEnrollment(
      dto.preAuthToken,
      requestContext(req),
    );
  }

  @Post('mfa/enrollment/confirm')
  @EnterpriseRateLimit(RateLimitTier.Auth)
  confirmMfaEnrollment(
    @Body() dto: ConfirmMfaEnrollmentDto,
    @Req() req: Request,
  ) {
    return this.authService.confirmMfaEnrollment(
      dto.preAuthToken,
      dto.code,
      requestContext(req),
    );
  }

  @Post('mfa/challenge')
  @EnterpriseRateLimit(RateLimitTier.Auth)
  completeMfaChallenge(
    @Body() dto: CompleteMfaChallengeDto,
    @Req() req: Request,
  ) {
    return this.authService.completeMfaChallenge(
      dto.preAuthToken,
      dto.method,
      dto.code,
      requestContext(req),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return req.user;
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  @EnterpriseRateLimit(RateLimitTier.AdminMutation)
  updateMe(
    @Req() req: AuthenticatedRequest,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.authService.updateMe(req.user, dto);
  }

  // 🔒 Admin only (ORG_ADMIN or SUPER_ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin-only')
  adminOnly(@Req() req: AuthenticatedRequest) {
    return {
      message: 'Welcome, admin',
      user: req.user,
    };
  }

  // 🔒 Provider or Admin
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PROVIDER, UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  @Get('provider-or-admin')
  providerOrAdmin(@Req() req: AuthenticatedRequest) {
    return {
      message: 'Welcome, provider or admin',
      user: req.user,
    };
  }
}
