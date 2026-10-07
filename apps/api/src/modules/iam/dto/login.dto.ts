import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'El correo no es válido' })
  email: string;

  @IsString()
  password: string;
}
