import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { ComplaintCategory } from '../entities/complaint.entity';

const CATEGORIES: ComplaintCategory[] = ['wrong_item', 'missing_item', 'quality_issue', 'late_delivery', 'other'];

export class CreateComplaintDto {
  @IsIn(CATEGORIES)
  category: ComplaintCategory;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  description: string;
}
