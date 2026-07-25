import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RestaurantsModule } from './restaurants/restaurants.module';
import { MenuItemsModule } from './menu-items/menu-items.module';
import { CustomersModule } from './customers/customers.module';
import { DeliveryPartnersModule } from './delivery-partners/delivery-partners.module';
import { OrdersModule } from './orders/orders.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { PushModule } from './push/push.module';

import { Restaurant } from './restaurants/entities/restaurant.entity';
import { MenuItem } from './menu-items/entities/menu-item.entity';
import { MenuItemVariantGroup } from './menu-items/entities/menu-item-variant-group.entity';
import { MenuItemVariantOption } from './menu-items/entities/menu-item-variant-option.entity';
import { User } from './customers/entities/user.entity';
import { Customer } from './customers/entities/customer.entity';
import { DeliveryPartner } from './delivery-partners/entities/delivery-partner.entity';
import { Order } from './orders/entities/order.entity';
import { OrderItem } from './orders/entities/order-item.entity';
import { OrderItemOption } from './orders/entities/order-item-option.entity';
import { Rating } from './orders/entities/rating.entity';
import { Complaint } from './orders/entities/complaint.entity';
import { Payout } from './delivery-partners/entities/payout.entity';
import { PushSubscription } from './push/entities/push-subscription.entity';
import { Offer } from './offers/entities/offer.entity';
import { OfferRedemption } from './offers/entities/offer-redemption.entity';
import { OffersModule } from './offers/offers.module';
import { Shift } from './rider-programs/entities/shift.entity';
import { ShiftBooking } from './rider-programs/entities/shift-booking.entity';
import { RiderIncentive } from './rider-programs/entities/rider-incentive.entity';
import { Announcement } from './rider-programs/entities/announcement.entity';
import { Referral } from './rider-programs/entities/referral.entity';
import { SosAlert } from './rider-programs/entities/sos-alert.entity';
import { RiderProgramsModule } from './rider-programs/rider-programs.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get('DB_USERNAME', 'app'),
        password: config.get('DB_PASSWORD', 'app_local_dev_password'),
        database: config.get('DB_NAME', 'hyd_food_delivery'),
        entities: [
          Restaurant,
          MenuItem,
          MenuItemVariantGroup,
          MenuItemVariantOption,
          User,
          Customer,
          DeliveryPartner,
          Order,
          OrderItem,
          OrderItemOption,
          Rating,
          Complaint,
          Payout,
          PushSubscription,
          Offer,
          OfferRedemption,
          Shift,
          ShiftBooking,
          RiderIncentive,
          Announcement,
          Referral,
          SosAlert,
        ],
        // synchronize is fine for early MVP dev; switch to migrations before production
        synchronize: true,
        logging: false,
      }),
    }),
    RestaurantsModule,
    MenuItemsModule,
    CustomersModule,
    DeliveryPartnersModule,
    OffersModule,
    RiderProgramsModule,
    OrdersModule,
    AuthModule,
    AdminModule,
    PushModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
