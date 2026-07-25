import { IsDateString, IsNumber, IsString, Min } from 'class-validator';

export class CreateShiftDto {
  @IsString()
  label: string;

  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;

  @IsNumber()
  @Min(0)
  minPayPerHour: number;

  @IsNumber()
  @Min(0)
  maxPayPerHour: number;
}
