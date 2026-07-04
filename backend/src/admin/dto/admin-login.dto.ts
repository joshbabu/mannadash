import { IsString } from 'class-validator';

export class AdminLoginDto {
  @IsString()
  username: string;

  @IsString()
  password: string;
}
