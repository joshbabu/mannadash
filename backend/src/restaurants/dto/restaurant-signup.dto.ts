import { IsString, IsUUID, MinLength } from 'class-validator';

export class RestaurantSignupDto {
  @IsUUID()
  restaurantId: string;

  @MinLength(6)
  password: string;
}
