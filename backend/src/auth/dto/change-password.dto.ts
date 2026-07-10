import { IsString, MinLength } from 'class-validator';

// Shared by all three roles' change-password endpoints (customer, restaurant, rider)
export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(6, { message: 'New password should be at least 6 characters' })
  newPassword: string;
}
