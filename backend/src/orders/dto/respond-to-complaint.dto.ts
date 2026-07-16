import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { ComplaintStatus } from '../entities/complaint.entity';

const STATUSES: ComplaintStatus[] = ['open', 'in_progress', 'resolved'];

export class RespondToComplaintDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  responseText?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: ComplaintStatus;
}
