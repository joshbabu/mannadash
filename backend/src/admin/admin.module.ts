import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AuthModule } from '../auth/auth.module';
import { User } from '../customers/entities/user.entity';
import { Restaurant } from '../restaurants/entities/restaurant.entity';
import { DeliveryPartner } from '../delivery-partners/entities/delivery-partner.entity';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([User, Restaurant, DeliveryPartner])],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
