import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { SaveAddressDto } from './dto/save-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me/addresses')
  getAddresses(@Req() req: any) {
    return this.customersService.getAddresses(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/addresses')
  addAddress(@Req() req: any, @Body() dto: SaveAddressDto) {
    return this.customersService.addAddress(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/addresses/:id')
  removeAddress(@Req() req: any, @Param('id') id: string) {
    return this.customersService.removeAddress(req.user.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/addresses/:id')
  updateAddress(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateAddressDto) {
    return this.customersService.updateAddress(req.user.userId, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/favorites')
  getFavorites(@Req() req: any) {
    return this.customersService.getFavoriteRestaurants(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/favorites/:restaurantId')
  addFavorite(@Req() req: any, @Param('restaurantId') restaurantId: string) {
    return this.customersService.addFavorite(req.user.userId, restaurantId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/favorites/:restaurantId')
  removeFavorite(@Req() req: any, @Param('restaurantId') restaurantId: string) {
    return this.customersService.removeFavorite(req.user.userId, restaurantId);
  }
}
