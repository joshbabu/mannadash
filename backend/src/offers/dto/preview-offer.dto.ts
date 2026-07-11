import { IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class PreviewOfferDto {
  @IsUUID()
  restaurantId: string;

  @IsNumber()
  @Min(0)
  subtotal: number;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsOptional()
  @IsString()
  promoCode?: string;
}
