import { IsString } from 'class-validator';

export class DeliveryPartnerLoginDto {
  @IsString()
  phone: string;

  @IsString()
  password: string;
}
