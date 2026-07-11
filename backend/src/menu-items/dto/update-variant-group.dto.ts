import { IsArray, IsBoolean, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { VariantOptionInputDto } from './variant-option-input.dto';

export class UpdateVariantGroupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsIn(['single', 'multiple'])
  selectionType?: 'single' | 'multiple';

  // Full replace: options with an id are updated in place, options without an id are
  // created, and any existing option NOT present in this list is deleted. Omit entirely to
  // leave the option list untouched (e.g. a pure rename of the group).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantOptionInputDto)
  options?: VariantOptionInputDto[];
}
