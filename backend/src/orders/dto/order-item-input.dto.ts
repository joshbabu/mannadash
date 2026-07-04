import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class OrderItemInputDto {
  @IsUUID()
  menuItemId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
