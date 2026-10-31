import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsString, Length, MaxLength } from 'class-validator';
import { Role } from '../domain/enums';
import { trim } from './register.dto';

/** Cuerpo de POST /organizations/members. No acepta organizationId: el tenant sale siempre del token. */
export class AddMemberDto {
  @Transform(trim)
  @IsString()
  @Length(2, 150)
  fullName!: string;

  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsEnum(Role)
  role!: Role;
}
