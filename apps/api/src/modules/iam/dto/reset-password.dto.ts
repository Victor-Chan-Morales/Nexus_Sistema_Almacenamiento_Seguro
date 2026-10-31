import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { PasswordPolicy } from './password-policy';
import { trim } from './register.dto';

export class ResetPasswordDto {
  @Transform(trim)
  @IsString()
  @Length(20, 200)
  token!: string;

  @PasswordPolicy()
  newPassword!: string;
}
