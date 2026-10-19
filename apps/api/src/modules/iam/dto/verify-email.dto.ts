import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { trim } from './register.dto';

export class VerifyEmailDto {
  @Transform(trim)
  @IsString()
  @Length(20, 200)
  token!: string;
}
