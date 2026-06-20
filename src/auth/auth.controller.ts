import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { FirebaseLoginDto } from './dto/firebase-login.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('firebase-login')
  firebaseLogin(@Body() dto: FirebaseLoginDto) {
    return this.authService.firebaseLogin(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: { user: any }) {
    return req.user;
  }

  // 🔒 Admin only (ORG_ADMIN or SUPER_ADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN)
  @Get('admin-only')
  adminOnly(@Req() req: { user: any }) {
    return {
      message: 'Welcome, admin',
      user: req.user,
    };
  }

  // 🔒 Provider or Admin
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    UserRole.PROVIDER,
    UserRole.ORG_ADMIN,
    UserRole.SUPER_ADMIN,
  )
  @Get('provider-or-admin')
  providerOrAdmin(@Req() req: { user: any }) {
    return {
      message: 'Welcome, provider or admin',
      user: req.user,
    };
  }
}
