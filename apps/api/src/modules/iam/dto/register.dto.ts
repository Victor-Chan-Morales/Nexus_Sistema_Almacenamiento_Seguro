import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { PasswordPolicy } from './password-policy';

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RegisterDto {
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  fullName!: string;

  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @PasswordPolicy()
  password!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  organizationName!: string;
}
