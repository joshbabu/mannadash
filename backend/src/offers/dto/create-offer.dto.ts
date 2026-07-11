import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:mm, 24-hour
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export class CreateOfferDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9]+$/, { message: 'code should be letters and numbers only' })
  code?: string;

  @IsIn(['percentage', 'flat', 'free_delivery'])
  discountType: 'percentage' | 'flat' | 'free_delivery';

  // Required for percentage/flat, ignored for free_delivery — cross-field check happens
  // in the service, since class-validator's conditional decorators get unreadable fast
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderValue?: number;

  @IsOptional()
  @IsIn(['all', 'first_order'])
  audience?: 'all' | 'first_order';

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(DAY_NAMES, { each: true })
  daysOfWeek?: string[];

  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'startTime must be HH:mm, e.g. 12:00' })
  startTime?: string;

  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'endTime must be HH:mm, e.g. 15:00' })
  endTime?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimitPerCustomer?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  totalUsageLimit?: number;
}
