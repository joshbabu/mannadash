import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrdersGateway } from './orders.gateway';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderItemOption } from './entities/order-item-option.entity';
import { Rating } from './entities/rating.entity';
import { Complaint } from './entities/complaint.entity';
import { Payout } from '../delivery-partners/entities/payout.entity';
import { Restaurant } from '../restaurants/entities/restaurant.entity';
import { MenuItem } from '../menu-items/entities/menu-item.entity';
import { MenuItemVariantOption } from '../menu-items/entities/menu-item-variant-option.entity';
import { Customer } from '../customers/entities/customer.entity';
import { AuthModule } from '../auth/auth.module';
import { DeliveryPartnersModule } from '../delivery-partners/delivery-partners.module';
import { PaymentsModule } from '../payments/payments.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';
import { PushModule } from '../push/push.module';
import { OffersModule } from '../offers/offers.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      OrderItemOption,
      Rating,
      Complaint,
      Payout,
      Restaurant,
      MenuItem,
      MenuItemVariantOption,
      Customer,
    ]),
    AuthModule, // provides JwtStrategy/PassportModule needed by JwtAuthGuard
    DeliveryPartnersModule, // provides rider lookup/assignment for assignRider()
    PaymentsModule, // provides RazorpayService for create/verify payment
    RestaurantsModule, // provides RestaurantsService.setRatingAvg()
    PushModule, // provides PushService for real push notifications alongside sockets
    OffersModule, // provides OffersService.resolveOffer()/recordRedemption() for L1
  ],
  providers: [OrdersService, OrdersGateway],
  controllers: [OrdersController],
  exports: [OrdersService], // AdminModule needs staleUnassignedOrders() for the "Needs a rider" list
})
export class OrdersModule {}
