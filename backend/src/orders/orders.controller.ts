import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { CreateRatingDto } from './dto/create-rating.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Req() req: any, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(req.user.userId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findMyOrders(@Req() req: any) {
    return this.ordersService.findAllForCustomer(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('restaurant/mine')
  findMyRestaurantOrders(@Req() req: any) {
    return this.ordersService.findAllForRestaurant(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('restaurant/insights')
  getMyRestaurantInsights(@Req() req: any) {
    return this.ordersService.getRestaurantInsights(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('rider/mine')
  findMyRiderOrders(@Req() req: any) {
    return this.ordersService.findAllForRider(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('rider/earnings')
  getMyEarnings(@Req() req: any) {
    return this.ordersService.getRiderEarnings(req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('rider/:id/payout')
  createPayout(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Only an admin can issue a payout');
    }
    return this.ordersService.createPayout(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/complete-refund')
  completeRefund(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Only an admin can mark a refund as completed');
    }
    return this.ordersService.completeRefund(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.findOne(id, req.user.userId);
  }

  // Authority depends on the target status: the restaurant owns accepted/preparing/cancelled
  // (kitchen-side decisions), while only the assigned rider can mark picked_up/delivered
  // (they're the only one who actually knows those happened). This mirrors how Swiggy/Zomato-style
  // apps split responsibility — the restaurant stays informed via live updates either way,
  // it just can't unilaterally declare a delivery complete.
  @UseGuards(JwtAuthGuard)
  @Patch(':id/status')
  async updateStatus(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderStatusDto) {
    const order = await this.ordersService.findOne(id);
    const restaurantOnlyStatuses = ['accepted', 'preparing', 'ready_for_pickup'];
    const riderOwnedStatuses = ['picked_up', 'delivered'];

    if (dto.status === 'cancelled') {
      const isRestaurant = order.restaurant.id === req.user.userId;
      // Customers can cancel their own order, but only before the restaurant has accepted it —
      // once accepted, cancelling wastes real prep work, so only the restaurant can call it off
      const isCustomerCancellingBeforeAccept =
        req.user.role === 'customer' && order.customer.user.id === req.user.userId && order.status === 'placed';
      if (!isRestaurant && !isCustomerCancellingBeforeAccept) {
        throw new ForbiddenException(
          'Only the restaurant can cancel after acceptance — you can cancel your own order only before it\'s accepted',
        );
      }
    } else if (restaurantOnlyStatuses.includes(dto.status)) {
      if (order.restaurant.id !== req.user.userId) {
        throw new ForbiddenException('Only the restaurant can accept, prepare, or mark this order ready');
      }
    } else if (riderOwnedStatuses.includes(dto.status)) {
      if (!order.deliveryPartner || order.deliveryPartner.id !== req.user.userId) {
        throw new ForbiddenException('Only the assigned rider can mark this order picked up or delivered');
      }
    }

    return this.ordersService.updateStatus(id, dto.status);
  }

  // Restaurant-owner-only — same ownership check as above
  @UseGuards(JwtAuthGuard)
  @Post(':id/assign-rider')
  async assignRider(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const order = await this.ordersService.findOne(id);
    if (order.restaurant.id !== req.user.userId) {
      throw new ForbiddenException('You can only assign riders for orders placed with your own restaurant');
    }
    return this.ordersService.assignRider(id);
  }

  // Manual override — restaurant picks a specific rider from the "available now" list
  // instead of the automatic nearest-match
  @UseGuards(JwtAuthGuard)
  @Post(':id/assign-rider/:riderId')
  async assignSpecificRider(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('riderId', ParseUUIDPipe) riderId: string,
  ) {
    const order = await this.ordersService.findOne(id);
    if (order.restaurant.id !== req.user.userId) {
      throw new ForbiddenException('You can only assign riders for orders placed with your own restaurant');
    }
    return this.ordersService.assignSpecificRider(id, riderId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/create-payment')
  createPayment(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.ordersService.createPayment(id, req.user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/verify-payment')
  verifyPayment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VerifyPaymentDto) {
    return this.ordersService.verifyPayment(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/rating')
  rateOrder(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRatingDto) {
    return this.ordersService.rateOrder(id, req.user.userId, dto);
  }

  // Admin-only, one-time (but safe to re-run) — recalculates ratingCount/ratingAvg for every
  // restaurant and rider from their full historical ratings, needed once after adding ratingCount
  @UseGuards(JwtAuthGuard)
  @Post('admin/backfill-rating-stats')
  backfillRatingStats(@Req() req: any) {
    if (req.user.role !== 'admin') {
      throw new ForbiddenException('Only an admin can run this');
    }
    return this.ordersService.backfillAllRatingStats();
  }
}
