import { IsIn, Matches } from 'class-validator';

export class ResetPasswordDto {
  @IsIn(['customer', 'restaurant', 'rider'])
  role: 'customer' | 'restaurant' | 'rider';

  @Matches(/^[6-9]\d{9}$/, { message: 'phone must be a 10-digit mobile number' })
  phone: string;
}
