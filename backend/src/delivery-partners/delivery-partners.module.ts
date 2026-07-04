import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeliveryPartnersService } from './delivery-partners.service';
import { DeliveryPartnersController } from './delivery-partners.controller';
import { DeliveryPartner } from './entities/delivery-partner.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([DeliveryPartner]), AuthModule],
  providers: [DeliveryPartnersService],
  controllers: [DeliveryPartnersController],
  exports: [DeliveryPartnersService],
})
export class DeliveryPartnersModule {}
