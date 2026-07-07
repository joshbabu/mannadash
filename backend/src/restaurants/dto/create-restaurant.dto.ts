import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class CreateRestaurantDto {
  @IsString()
  ownerName: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  cuisineType: string;

  @IsString()
  address: string;

  // Plain lat/lng from the client — service converts this to a PostGIS point
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsString()
  phone: string;

  @IsOptional()
  @IsBoolean()
  isOpen?: boolean;

  @IsOptional()
  @IsNumber()
  commissionRate?: number;

  @IsOptional()
  @IsInt()
  avgPrepTimeMins?: number;

  // HH:MM 24-hour format, e.g. "09:00" and "22:00" — both optional, omit for "always open"
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'openTime must be in HH:MM 24-hour format' })
  openTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'closeTime must be in HH:MM 24-hour format' })
  closeTime?: string;
}
