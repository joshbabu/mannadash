import { IsNumber, IsString, Max, Min } from 'class-validator';

export class SaveAddressDto {
  @IsString()
  label: string; // e.g. "Home", "Work"

  @IsString()
  address: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;
}
