import { IsEnum } from 'class-validator';
import { RestaurantStatus } from '../entities/restaurant.entity';

export class SetRestaurantStatusDto {
  @IsEnum(RestaurantStatus)
  status: RestaurantStatus;
}
