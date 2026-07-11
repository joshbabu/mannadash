import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { OffersService } from './offers.service';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import { PreviewOfferDto } from './dto/preview-offer.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller()
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  // Public — powers the "Offers" section on the customer menu page
  @Get('restaurants/:id/offers')
  findPublicForRestaurant(@Param('id', ParseUUIDPipe) id: string) {
    return this.offersService.findPublicForRestaurant(id);
  }

  // Live checkout preview — shows the discount (or why a code didn't work) before the
  // customer commits to placing the order. Never throws; see OffersService.previewOffer.
  @UseGuards(JwtAuthGuard)
  @Post('offers/preview')
  preview(@Req() req: any, @Body() dto: PreviewOfferDto) {
    if (req.user.role !== 'customer') throw new ForbiddenException('Only customers can preview offers');
    return this.offersService.previewOfferWithRealFee(dto.restaurantId, req.user.userId, dto.subtotal, dto.latitude, dto.longitude, dto.promoCode);
  }

  @UseGuards(JwtAuthGuard)
  @Post('offers')
  create(@Req() req: any, @Body() dto: CreateOfferDto) {
    if (req.user.role !== 'restaurant') throw new ForbiddenException('Only restaurants can create offers');
    return this.offersService.create(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('offers/mine')
  findMine(@Req() req: any) {
    if (req.user.role !== 'restaurant') throw new ForbiddenException('Only restaurants can view their offers');
    return this.offersService.findMine(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('offers/:id')
  update(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOfferDto) {
    if (req.user.role !== 'restaurant') throw new ForbiddenException('Only restaurants can edit offers');
    return this.offersService.update(id, req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('offers/:id')
  remove(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    if (req.user.role !== 'restaurant') throw new ForbiddenException('Only restaurants can delete offers');
    return this.offersService.remove(id, req.user.userId);
  }
}
