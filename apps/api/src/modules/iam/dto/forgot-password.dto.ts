import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { trim } from './register.dto';

export class ForgotPasswordDto {
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;
}
