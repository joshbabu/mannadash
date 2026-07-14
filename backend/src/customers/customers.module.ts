import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { Customer } from './entities/customer.entity';
import { Restaurant } from '../restaurants/entities/restaurant.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Customer, Restaurant]), AuthModule],
  providers: [CustomersService],
  controllers: [CustomersController],
})
export class CustomersModule {}
