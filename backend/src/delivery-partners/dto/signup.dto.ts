import { IsEnum, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { VehicleType } from '../entities/delivery-partner.entity';

export class DeliveryPartnerSignupDto {
  @IsString()
  name: string;

  @Matches(/^(\+91)?[6-9]\d{9}$/, {
    message: 'phone must be a valid 10-digit Indian mobile number',
  })
  phone: string;

  @MinLength(6)
  password: string;

  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;
}
