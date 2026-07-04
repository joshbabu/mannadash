import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RazorpayService } from './razorpay.service';

@Module({
  imports: [ConfigModule],
  providers: [RazorpayService],
  exports: [RazorpayService],
})
export class PaymentsModule {}
