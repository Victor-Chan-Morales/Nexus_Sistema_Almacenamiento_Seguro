import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { trim } from './register.dto';

/**
 * SPEC-113. PATCH /auth/me. Solo acepta `fullName`: cualquier otro campo (p. ej. `email`) responde 400
 * porque ValidationPipe usa forbidNonWhitelisted.
 */
export class UpdateProfileDto {
  @Transform(trim)
  @IsString({ message: 'El nombre debe ser texto' })
  @Length(2, 120, { message: 'El nombre debe tener entre 2 y 120 caracteres' })
  fullName!: string;
}
