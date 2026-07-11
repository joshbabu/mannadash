import { IsString, MaxLength, MinLength } from 'class-validator';

export class ReplyToRatingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  replyText: string;
}
