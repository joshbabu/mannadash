import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateRatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  restaurantRating: number;

  @IsInt()
  @Min(1)
  @Max(5)
  deliveryRating: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
