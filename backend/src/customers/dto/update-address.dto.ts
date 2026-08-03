import { IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  label?: string; // e.g. "Home", "Work"

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressDetails?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  receiverName?: string;

  @IsOptional()
  @Matches(/^[6-9]\d{9}$/, { message: 'receiverPhone must be a 10-digit mobile number' })
  receiverPhone?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}
