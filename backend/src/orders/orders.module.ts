import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { OrdersGateway } from './orders.gateway';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { Rating } from './entities/rating.entity';
import { Restaurant } from '../restaurants/entities/restaurant.entity';
import { MenuItem } from '../menu-items/entities/menu-item.entity';
import { Customer } from '../customers/entities/customer.entity';
import { AuthModule } from '../auth/auth.module';
import { DeliveryPartnersModule } from '../delivery-partners/delivery-partners.module';
import { PaymentsModule } from '../payments/payments.module';
import { RestaurantsModule } from '../restaurants/restaurants.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Rating, Restaurant, MenuItem, Customer]),
    AuthModule, // provides JwtStrategy/PassportModule needed by JwtAuthGuard
    DeliveryPartnersModule, // provides rider lookup/assignment for assignRider()
    PaymentsModule, // provides RazorpayService for create/verify payment
    RestaurantsModule, // provides RestaurantsService.setRatingAvg()
  ],
  providers: [OrdersService, OrdersGateway],
  controllers: [OrdersController],
})
export class OrdersModule {}
