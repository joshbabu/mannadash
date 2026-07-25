import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { RiderProgramsService } from './rider-programs.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { CreateIncentiveDto } from './dto/create-incentive.dto';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { CreateSosAlertDto } from './dto/create-sos-alert.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

function requireAdmin(req: any) {
  if (req.user.role !== 'admin') {
    throw new ForbiddenException('Only admins can do this');
  }
}

@Controller()
export class RiderProgramsController {
  constructor(private readonly service: RiderProgramsService) {}

  // ==================== Shifts ====================

  @UseGuards(JwtAuthGuard)
  @Post('shifts')
  createShift(@Req() req: any, @Body() dto: CreateShiftDto) {
    requireAdmin(req);
    return this.service.createShift(dto);
  }

  // Shared by both the rider app (sees bookedByMe) and the admin panel (ignores it) — same
  // upcoming-shifts data either way, just consumed differently.
  @UseGuards(JwtAuthGuard)
  @Get('shifts')
  listShifts(@Req() req: any) {
    const riderId = req.user.role === 'rider' ? req.user.userId : undefined;
    return this.service.listUpcomingShifts(riderId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('shifts/:id/book')
  bookShift(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    if (req.user.role !== 'rider') {
      throw new ForbiddenException('Only riders can book shifts');
    }
    return this.service.bookShift(id, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('shifts/:id/book')
  unbookShift(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    if (req.user.role !== 'rider') {
      throw new ForbiddenException('Only riders can unbook shifts');
    }
    return this.service.unbookShift(id, req.user.userId);
  }

  // ==================== Rider incentives ====================

  @UseGuards(JwtAuthGuard)
  @Post('incentives')
  createIncentive(@Req() req: any, @Body() dto: CreateIncentiveDto) {
    requireAdmin(req);
    return this.service.createIncentive(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('incentives')
  listIncentives(@Req() req: any) {
    requireAdmin(req);
    return this.service.listAllIncentives();
  }

  @UseGuards(JwtAuthGuard)
  @Patch('incentives/:id/deactivate')
  deactivateIncentive(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    requireAdmin(req);
    return this.service.deactivateIncentive(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('incentives/mine')
  getMyIncentives(@Req() req: any) {
    if (req.user.role !== 'rider') {
      throw new ForbiddenException('Only riders have incentive progress');
    }
    return this.service.getMyIncentives(req.user.userId);
  }

  // ==================== Announcements ====================

  @UseGuards(JwtAuthGuard)
  @Post('announcements')
  createAnnouncement(@Req() req: any, @Body() dto: CreateAnnouncementDto) {
    requireAdmin(req);
    return this.service.createAnnouncement(dto);
  }

  // Admin sees every announcement (including deactivated, for oversight); riders only ever
  // see active ones — same route, different result, based on who's asking.
  @UseGuards(JwtAuthGuard)
  @Get('announcements')
  listAnnouncements(@Req() req: any) {
    if (req.user.role === 'admin') {
      return this.service.listAllAnnouncements();
    }
    return this.service.listActiveAnnouncements();
  }

  @UseGuards(JwtAuthGuard)
  @Patch('announcements/:id/deactivate')
  deactivateAnnouncement(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    requireAdmin(req);
    return this.service.deactivateAnnouncement(id);
  }

  // ==================== Referrals ====================

  @UseGuards(JwtAuthGuard)
  @Get('referrals/mine')
  getMyReferrals(@Req() req: any) {
    if (req.user.role !== 'rider') {
      throw new ForbiddenException('Only riders have a referral code');
    }
    return this.service.getMyReferrals(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('referrals')
  listReferrals(@Req() req: any) {
    requireAdmin(req);
    return this.service.listAllReferrals();
  }

  // ==================== SOS ====================

  @UseGuards(JwtAuthGuard)
  @Post('sos')
  triggerSos(@Req() req: any, @Body() dto: CreateSosAlertDto) {
    if (req.user.role !== 'rider') {
      throw new ForbiddenException('Only riders can trigger an SOS alert');
    }
    return this.service.triggerSos(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sos-alerts')
  listSosAlerts(@Req() req: any) {
    requireAdmin(req);
    return this.service.listSosAlerts();
  }
}
