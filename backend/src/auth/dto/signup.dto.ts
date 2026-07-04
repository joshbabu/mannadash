import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class SignupDto {
  @IsString()
  name: string;

  // Basic Indian mobile number check — 10 digits, optionally prefixed with +91
  @Matches(/^(\+91)?[6-9]\d{9}$/, {
    message: 'phone must be a valid 10-digit Indian mobile number',
  })
  phone: string;

  @IsOptional()
  @IsString()
  email?: string;

  @MinLength(6)
  password: string;
}
