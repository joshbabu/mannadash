import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiderProgramsService } from './rider-programs.service';
import { RiderProgramsController } from './rider-programs.controller';
import { Shift } from './entities/shift.entity';
import { ShiftBooking } from './entities/shift-booking.entity';
import { RiderIncentive } from './entities/rider-incentive.entity';
import { Announcement } from './entities/announcement.entity';
import { Order } from '../orders/entities/order.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Shift, ShiftBooking, RiderIncentive, Announcement, Order]), AuthModule],
  providers: [RiderProgramsService],
  controllers: [RiderProgramsController],
})
export class RiderProgramsModule {}
