import { IsString, MaxLength } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString()
  @MaxLength(150)
  title: string;

  @IsString()
  @MaxLength(2000)
  body: string;
}
