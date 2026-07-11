import { Body, Controller, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('login')
  login(@Body() dto: AdminLoginDto) {
    return this.adminService.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stale-unassigned-orders')
  getStaleUnassignedOrders(@Req() req: any) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Only admins can view this');
    }
    return this.adminService.getStaleUnassignedOrders();
  }

  @UseGuards(JwtAuthGuard)
  @Post('reset-password')
  resetPassword(@Req() req: any, @Body() dto: ResetPasswordDto) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Only admins can reset passwords');
    }
    return this.adminService.resetPassword(dto);
  }
}
