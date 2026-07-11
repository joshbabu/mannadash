import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class VariantOptionInputDto {
  // Present when editing an existing option (keeps its id and history); absent when adding
  // a brand-new option to the group.
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  label: string;

  @IsNumber()
  @Min(0)
  priceDelta: number;
}
