import { IsBoolean, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { MenuCategory } from '../entities/menu-item.entity';

export class CreateMenuItemDto {
  @IsUUID()
  restaurantId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  price: number;

  // Optional "was" price, to show a discount — should be higher than `price` when set
  @IsOptional()
  @IsNumber()
  @Min(0)
  originalPrice?: number;

  @IsOptional()
  @IsEnum(MenuCategory)
  category?: MenuCategory;

  @IsOptional()
  @IsBoolean()
  isVeg?: boolean;

  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  // Cloudflare R2 URL — set after image upload, optional at creation
  @IsOptional()
  @IsString()
  imageUrl?: string;

  // Nutritional info per serving — all optional, all in grams. Calorie count is never
  // accepted here; it's derived from these on display, never stored.
  @IsOptional()
  @IsNumber()
  @Min(0)
  weightGrams?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  proteinGrams?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  carbsGrams?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fatGrams?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fibreGrams?: number;
}
