import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Única definición de la política de contraseña: la comparten el registro y el restablecimiento. */
export const PasswordPolicy = () =>
  applyDecorators(
    IsString(),
    MinLength(8),
    MaxLength(128),
    Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'La contraseña debe incluir letras y números' }),
  );
