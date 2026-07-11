import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OffersService } from './offers.service';
import { OffersController } from './offers.controller';
import { Offer } from './entities/offer.entity';
import { OfferRedemption } from './entities/offer-redemption.entity';
import { Order } from '../orders/entities/order.entity';
import { Restaurant } from '../restaurants/entities/restaurant.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Offer, OfferRedemption, Order, Restaurant]), AuthModule],
  providers: [OffersService],
  controllers: [OffersController],
  exports: [OffersService], // OrdersModule needs resolveOffer()/recordRedemption() at order creation
})
export class OffersModule {}
