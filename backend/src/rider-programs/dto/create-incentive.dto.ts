import { IsDateString, IsInt, IsNumber, IsString, Min } from 'class-validator';

export class CreateIncentiveDto {
  @IsString()
  title: string;

  @IsInt()
  @Min(1)
  targetOrders: number;

  @IsNumber()
  @Min(0)
  bonusAmount: number;

  @IsDateString()
  validFrom: string;

  @IsDateString()
  validTo: string;
}
