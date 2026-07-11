import { IsArray, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class OrderItemInputDto {
  @IsUUID()
  menuItemId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  notes?: string;

  // Which MenuItemVariantOption ids were chosen for this line — e.g. ["<Large id>",
  // "<ExtraHot id>"]. Omitted or empty is fine for a dish with no required variant groups.
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  selectedOptionIds?: string[];
}
