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
}
