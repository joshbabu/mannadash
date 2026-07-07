import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PushService } from './push.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('push')
export class PushController {
  constructor(
    private readonly pushService: PushService,
    private readonly config: ConfigService,
  ) {}

  // Public — the frontend needs this to call pushManager.subscribe(), no auth required to read it
  @Get('vapid-public-key')
  getPublicKey() {
    return { publicKey: this.config.get<string>('VAPID_PUBLIC_KEY', '') };
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscribe')
  async subscribe(@Req() req: any, @Body() body: { subscription: Record<string, any> }) {
    await this.pushService.saveSubscription(req.user.userId, req.user.role, body.subscription);
    return { subscribed: true };
  }
}
