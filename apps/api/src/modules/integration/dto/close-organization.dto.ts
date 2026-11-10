import { IsNotEmpty, IsString } from 'class-validator';

/** DTO para la solicitud de cierre de empresa (SPEC-114). */
export class CloseOrganizationDto {
  @IsString()
  @IsNotEmpty({ message: 'El nombre de la organización es obligatorio' })
  organizationName!: string;

  @IsString()
  @IsNotEmpty({ message: 'La contraseña de confirmación es obligatoria' })
  password!: string;
}
