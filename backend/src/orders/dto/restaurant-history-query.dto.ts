import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Filters for the restaurant Order History page. History means terminal orders only
 * (delivered or cancelled) — in-flight orders live on the Live Orders screen instead.
 */
export class RestaurantHistoryQueryDto {
  // Matches customer name, customer phone, or an order-id fragment (so pasting the short
  // "#3e78b2…" style id from a receipt works)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  // Omit for both terminal states
  @IsOptional()
  @IsIn(['delivered', 'cancelled'])
  status?: 'delivered' | 'cancelled';

  // placedAt >= from (inclusive) — ISO date or datetime
  @IsOptional()
  @IsDateString()
  from?: string;

  // placedAt <= to (inclusive)
  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
