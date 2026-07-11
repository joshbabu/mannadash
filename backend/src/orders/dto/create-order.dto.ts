import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsString, IsUUID, Max, Min, ValidateNested, IsIn, IsOptional, MaxLength } from 'class-validator';
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
}
