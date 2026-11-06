import { IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** SPEC-209: estado calculado del enlace; no se guarda en la base. */
export type ShareLinkStatus = 'active' | 'expired' | 'revoked';

/**
 * SPEC-209: cuerpo de `POST /files/:id/share-links`. La contraseña es opcional y tiene una política propia
 * (no la de la cuenta): para un enlace compartido basta con 8 caracteres. El tope de 128 acota el coste de Argon2id.
 */
export class CreateShareLinkDto {
  @IsInt()
  @IsIn([1, 7, 30])
  expiresInDays!: 1 | 7 | 30;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;
}

/** SPEC-209: respuesta de la creación. Es la única vez que aparece el `token` en claro. */
export class CreatedShareLinkDto {
  id: string;
  token: string;
  versionId: string;
  expiresAt: string;
  hasPassword: boolean;
  createdAt: string;
}

/** SPEC-209: un enlace en el listado. Nunca incluye el token ni su hash. */
export class ShareLinkItemDto {
  id: string;
  versionId: string;
  expiresAt: string;
  hasPassword: boolean;
  status: ShareLinkStatus;
  createdAt: string;
  revokedAt: string | null;
}

/** SPEC-209: respuesta de `GET /files/:id/share-links`, de la más reciente a la más antigua. */
export class ShareLinksResponseDto {
  items: ShareLinkItemDto[];
}
