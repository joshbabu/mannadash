import { IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

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

  // Who actually receives deliveries at this specific address — can genuinely differ from
  // the account holder (e.g. a family member at Home, a colleague at Work). Optional.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  receiverName?: string;

  @IsOptional()
  @Matches(/^[6-9]\d{9}$/, { message: 'receiverPhone must be a 10-digit mobile number' })
  receiverPhone?: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;
}
