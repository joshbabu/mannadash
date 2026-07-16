import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsISO8601, IsNumber, IsString, IsUUID, Max, Min, ValidateNested, IsIn, IsOptional, MaxLength } from 'class-validator';
import { OrderItemInputDto } from './order-item-input.dto';

export class CreateOrderDto {
  @IsUUID()
  restaurantId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items: OrderItemInputDto[];

  @IsString()
  deliveryAddress: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  // 'cod' (cash on delivery) or 'online' — omitted means online, matching pre-COD behavior
  @IsOptional()
  @IsIn(['online', 'cod'])
  paymentMethod?: 'online' | 'cod';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  instructions?: string;

  // L1: a customer-typed code always takes precedence over whatever automatic offer would
  // otherwise apply. Case-insensitive — normalized (uppercased/trimmed) in the service,
  // same as how the code was normalized when the restaurant created the offer.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  promoCode?: string;

  @IsOptional()
  @IsBoolean()
  cutleryNeeded?: boolean;

  @IsOptional()
  @IsIn(['standard', 'express', 'eco'])
  deliveryType?: 'standard' | 'express' | 'eco';

  @IsOptional()
  @IsNumber()
  @Min(0)
  tipAmount?: number;

  // Order-for-later. Omitted (or null) means "as soon as possible" — today's only
  // behavior. "Must actually be in the future" is checked in the service, not here,
  // since that's a business rule about the current moment rather than a shape check.
  @IsOptional()
  @IsISO8601()
  scheduledFor?: string;
}
