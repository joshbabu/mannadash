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
import { User } from './customers/entities/user.entity';
import { Customer } from './customers/entities/customer.entity';
import { DeliveryPartner } from './delivery-partners/entities/delivery-partner.entity';
import { Order } from './orders/entities/order.entity';
import { OrderItem } from './orders/entities/order-item.entity';
import { Rating } from './orders/entities/rating.entity';
import { Payout } from './delivery-partners/entities/payout.entity';
import { PushSubscription } from './push/entities/push-subscription.entity';

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
        entities: [Restaurant, MenuItem, User, Customer, DeliveryPartner, Order, OrderItem, Rating, Payout, PushSubscription],
        // synchronize is fine for early MVP dev; switch to migrations before production
        synchronize: true,
        logging: false,
      }),
    }),
    RestaurantsModule,
    MenuItemsModule,
    CustomersModule,
    DeliveryPartnersModule,
    OrdersModule,
    AuthModule,
    AdminModule,
    PushModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
