import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SaveAddressDto {
  @IsString()
  label: string; // e.g. "Home", "Work"

  @IsString()
  address: string;

  // Floor/flat/tower/landmark — the exact-unit detail a search result or dropped pin can't
  // capture on its own. Optional; shown alongside the address wherever it's displayed.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressDetails?: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;
}
