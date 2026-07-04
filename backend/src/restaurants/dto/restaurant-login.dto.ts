import { IsString } from 'class-validator';

export class RestaurantLoginDto {
  @IsString()
  phone: string;

  @IsString()
  password: string;
}
