import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Use this on any future route that requires a logged-in customer, e.g.:
// @UseGuards(JwtAuthGuard)
// @Post('orders')
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
