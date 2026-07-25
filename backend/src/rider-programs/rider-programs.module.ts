import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiderProgramsService } from './rider-programs.service';
import { RiderProgramsController } from './rider-programs.controller';
import { Shift } from './entities/shift.entity';
import { ShiftBooking } from './entities/shift-booking.entity';
import { RiderIncentive } from './entities/rider-incentive.entity';
import { Announcement } from './entities/announcement.entity';
import { Referral } from './entities/referral.entity';
import { SosAlert } from './entities/sos-alert.entity';
import { Order } from '../orders/entities/order.entity';
import { DeliveryPartner } from '../delivery-partners/entities/delivery-partner.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Shift, ShiftBooking, RiderIncentive, Announcement, Referral, SosAlert, Order, DeliveryPartner]),
    AuthModule,
  ],
  providers: [RiderProgramsService],
  controllers: [RiderProgramsController],
})
export class RiderProgramsModule {}
