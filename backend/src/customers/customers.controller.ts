import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { SaveAddressDto } from './dto/save-address.dto';
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
}
