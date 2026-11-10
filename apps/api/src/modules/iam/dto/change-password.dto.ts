import { IsString, Length } from 'class-validator';
import { PasswordPolicy } from './password-policy';

/**
 * SPEC-113. POST /auth/change-password. `currentPassword` solo se compara con el hash: no se le aplica la
 * política completa, para no dejar fuera a una cuenta creada con una regla anterior. Las contraseñas no se recortan.
 */
export class ChangePasswordDto {
  @IsString({ message: 'La contraseña actual es obligatoria' })
  @Length(1, 128, { message: 'La contraseña actual debe tener entre 1 y 128 caracteres' })
  currentPassword!: string;

  @PasswordPolicy()
  newPassword!: string;
}
