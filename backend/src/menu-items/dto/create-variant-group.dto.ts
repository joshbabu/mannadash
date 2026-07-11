import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { VariantOptionInputDto } from './variant-option-input.dto';

export class CreateVariantGroupDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsIn(['single', 'multiple'])
  selectionType?: 'single' | 'multiple';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VariantOptionInputDto)
  options: VariantOptionInputDto[];
}
