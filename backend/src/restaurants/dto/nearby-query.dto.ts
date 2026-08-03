import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class NearbyQueryDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  // Search radius in meters — defaults to 15km, matching the radius Zomato uses. The max
  // is raised to give some headroom above the default without being unbounded.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(100)
  @Max(25000)
  radius?: number = 15000;

  // Phase H: find restaurants BY DISH, not just by name/cuisine — e.g. searching "litti
  // chokha" surfaces every nearby restaurant that actually serves it, even ones whose own
  // name/cuisine tag never mentions it. Case-insensitive substring match against currently
  // AVAILABLE menu items only — surfacing a restaurant for a dish that's sold out there
  // right now would be misleading, not helpful.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  dish?: string;
}
