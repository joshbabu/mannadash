import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RestaurantsService } from './restaurants.service';
import { CreateRestaurantDto } from './dto/create-restaurant.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { NearbyQueryDto } from './dto/nearby-query.dto';
import { RestaurantSignupDto } from './dto/restaurant-signup.dto';
import { RestaurantLoginDto } from './dto/restaurant-login.dto';
import { SetRestaurantStatusDto } from './dto/set-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  // Public — anyone can submit a restaurant application. It stays "pending" until an admin approves it
  // and the owner claims it via /restaurants/signup below.
  @Post()
  create(@Body() dto: CreateRestaurantDto) {
    return this.restaurantsService.create(dto);
  }

  @Post('signup')
  signup(@Body() dto: RestaurantSignupDto) {
    return this.restaurantsService.signup(dto);
  }

  @Post('login')
  login(@Body() dto: RestaurantLoginDto) {
    return this.restaurantsService.login(dto);
  }

  @Get()
  findAll() {
    return this.restaurantsService.findAll();
  }

  // NOTE: must be declared before ':id' route so 'nearby' isn't parsed as a UUID
  @Get('nearby')
  findNearby(@Query() query: NearbyQueryDto) {
    return this.restaurantsService.findNearby(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.restaurantsService.findOne(id);
  }

  // The ONLY route that returns PAN and bank details (they're @Exclude'd everywhere else).
  // Admins need it to review KYC before approving; the owner can view their own submission.
  @UseGuards(JwtAuthGuard)
  @Get(':id/kyc')
  async getKyc(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const isAdmin = req.user.role === 'admin';
    const isSelf = req.user.userId === id;
    if (!isAdmin && !isSelf) {
      throw new ForbiddenException('Only an admin or the restaurant owner can view KYC details');
    }
    return this.restaurantsService.getKyc(id);
  }

  // Owner-only — the JWT's subject must match the restaurant being updated
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRestaurantDto) {
    if (req.user.userId !== id) {
      throw new ForbiddenException('You can only update your own restaurant');
    }
    return this.restaurantsService.update(id, dto);
  }

  // Admin-only — now enforced with a real check instead of being left wide open
  @UseGuards(JwtAuthGuard)
  @Patch(':id/status')
  setStatus(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRestaurantStatusDto) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Only an admin can approve or suspend a restaurant');
    }
    return this.restaurantsService.setStatus(id, dto.status);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.restaurantsService.remove(id);
  }
}
