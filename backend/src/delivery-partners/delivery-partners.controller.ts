import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsNumber, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DeliveryPartnersService } from './delivery-partners.service';
import { DeliveryPartnerSignupDto } from './dto/signup.dto';
import { DeliveryPartnerLoginDto } from './dto/login.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { SetAvailabilityDto } from './dto/set-availability.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';
import { UpdateBankDetailsDto } from './dto/update-bank-details.dto';

class AvailableNearbyQueryDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

@Controller('delivery-partners')
export class DeliveryPartnersController {
  constructor(private readonly deliveryPartnersService: DeliveryPartnersService) {}

  @Post('signup')
  signup(@Body() dto: DeliveryPartnerSignupDto) {
    return this.deliveryPartnersService.signup(dto);
  }

  @Post('login')
  login(@Body() dto: DeliveryPartnerLoginDto) {
    return this.deliveryPartnersService.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/change-password')
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    if (req.user.role !== 'rider') {
      throw new ForbiddenException('Only rider accounts can use this endpoint');
    }
    return this.deliveryPartnersService.changePassword(req.user.userId, dto.currentPassword, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/location')
  updateMyLocation(@Req() req: any, @Body() dto: UpdateLocationDto) {
    return this.deliveryPartnersService.updateLocation(req.user.userId, dto.latitude, dto.longitude);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/availability')
  setMyAvailability(@Req() req: any, @Body() dto: SetAvailabilityDto) {
    return this.deliveryPartnersService.setAvailability(req.user.userId, dto.isAvailable);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/bank-details')
  getMyBankDetails(@Req() req: any) {
    if (req.user.role !== 'rider') {
      throw new ForbiddenException('Only rider accounts can use this endpoint');
    }
    return this.deliveryPartnersService.getBankDetails(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/bank-details')
  updateMyBankDetails(@Req() req: any, @Body() dto: UpdateBankDetailsDto) {
    if (req.user.role !== 'rider') {
      throw new ForbiddenException('Only rider accounts can use this endpoint');
    }
    return this.deliveryPartnersService.updateBankDetails(req.user.userId, dto);
  }

  // Gives a restaurant visibility into who's actually online nearby, instead of assignment
  // being a total black box. Guarded (any logged-in account) rather than fully public —
  // still not scoped to "restaurants only" since there's no per-role guard yet.
  @UseGuards(JwtAuthGuard)
  @Get('available')
  listAvailableNearby(@Query() query: AvailableNearbyQueryDto) {
    return this.deliveryPartnersService.listAvailableNearby(query.lat, query.lng);
  }

  // Admin-only — now enforced with a real check instead of being left wide open
  @UseGuards(JwtAuthGuard)
  @Patch(':id/verify')
  verify(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Only an admin can verify a delivery partner');
    }
    return this.deliveryPartnersService.verify(id);
  }

  @Get()
  findAll() {
    return this.deliveryPartnersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.deliveryPartnersService.findOne(id);
  }
}
