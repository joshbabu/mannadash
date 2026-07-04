import { IsOptional, IsUUID } from 'class-validator';

export class ListMenuItemsQueryDto {
  @IsOptional()
  @IsUUID()
  restaurantId?: string;
}
