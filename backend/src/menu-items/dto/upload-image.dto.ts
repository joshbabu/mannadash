import { IsString } from 'class-validator';

export class UploadImageDto {
  @IsString()
  imageBase64: string;
}
