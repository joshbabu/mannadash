import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

// CORS wide open for MVP dev — restrict to the actual app domain(s) before production
@WebSocketGateway({ cors: { origin: '*' } })
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(OrdersGateway.name);

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  // Client emits this after connecting to start receiving updates for one specific order,
  // e.g. socket.emit('subscribeToOrder', orderId)
  @SubscribeMessage('subscribeToOrder')
  handleSubscribe(client: Socket, orderId: string) {
    client.join(`order:${orderId}`);
    this.logger.log(`Client ${client.id} subscribed to order ${orderId}`);
  }

  @SubscribeMessage('unsubscribeFromOrder')
  handleUnsubscribe(client: Socket, orderId: string) {
    client.leave(`order:${orderId}`);
  }

  // Client emits this once after connecting/logging in, using their own rider id — lets us push
  // a "you've got a new delivery" notification the instant they're assigned, before they've ever
  // subscribed to that specific order's room (which they can't do until they know it exists).
  @SubscribeMessage('subscribeToRider')
  handleSubscribeRider(client: Socket, riderId: string) {
    client.join(`rider:${riderId}`);
    this.logger.log(`Client ${client.id} subscribed to rider channel ${riderId}`);
  }

  // Called by OrdersService.assignRider — this is the "new order for you" push, distinct from
  // the generic orderUpdate so the rider app can play a sound / show a banner specifically for this.
  emitNewAssignment(riderId: string, payload: unknown) {
    this.server.to(`rider:${riderId}`).emit('newAssignment', payload);
  }

  // Called by OrdersService whenever an order's status or rider assignment changes
  emitOrderUpdate(orderId: string, payload: unknown) {
    this.server.to(`order:${orderId}`).emit('orderUpdate', payload);
  }

  // Called when a rider pings their location — lets the customer's live map update without polling
  emitRiderLocation(orderId: string, lat: number, lng: number) {
    this.server.to(`order:${orderId}`).emit('riderLocation', { lat, lng });
  }
}
