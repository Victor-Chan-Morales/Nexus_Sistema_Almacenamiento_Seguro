import { IsBoolean, IsIn, IsOptional, IsString, IsUrl, Length, MaxLength } from 'class-validator';

export const DESTINATION_LOCATIONS = ['cloud', 'on_premises'] as const;
export type DestinationLocation = (typeof DESTINATION_LOCATIONS)[number];

export const DESTINATION_PROVIDERS = ['s3', 'minio'] as const;
export type DestinationProvider = (typeof DESTINATION_PROVIDERS)[number];

export type DestinationConnectionStatus = 'Sin comprobar' | 'Comprobando' | 'Conectado' | 'Sin conexión';

/**
 * SPEC-802: cuerpo de `POST /destinations`. Las credenciales nunca vuelven en una respuesta: el DTO de salida no las declara.
 * `require_tld: false` permite nombres de servicio como `http://minio:9000` dentro de Docker.
 */
export class CreateDestinationDto {
  @IsString()
  @Length(1, 150)
  name!: string;

  @IsIn(DESTINATION_LOCATIONS)
  location!: DestinationLocation;

  @IsIn(DESTINATION_PROVIDERS)
  providerType!: DestinationProvider;

  @IsUrl({ require_protocol: true, protocols: ['http', 'https'], require_tld: false })
  @MaxLength(512)
  endpoint!: string;

  @IsString()
  @Length(3, 63)
  bucket!: string;

  @IsString()
  @Length(1, 64)
  region!: string;

  @IsString()
  @Length(1, 256)
  accessKey!: string;

  @IsString()
  @Length(1, 512)
  secretKey!: string;

  @IsBoolean()
  useSsl!: boolean;
}

/**
 * SPEC-802: cuerpo de `PATCH /destinations/:id`. Todos los campos son opcionales. Una `secretKey` omitida conserva la actual.
 */
export class UpdateDestinationDto {
  @IsOptional()
  @IsString()
  @Length(1, 150)
  name?: string;

  @IsOptional()
  @IsIn(DESTINATION_LOCATIONS)
  location?: DestinationLocation;

  @IsOptional()
  @IsIn(DESTINATION_PROVIDERS)
  providerType?: DestinationProvider;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'], require_tld: false })
  @MaxLength(512)
  endpoint?: string;

  @IsOptional()
  @IsString()
  @Length(3, 63)
  bucket?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  region?: string;

  @IsOptional()
  @IsString()
  @Length(1, 256)
  accessKey?: string;

  @IsOptional()
  @IsString()
  @Length(1, 512)
  secretKey?: string;

  @IsOptional()
  @IsBoolean()
  useSsl?: boolean;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

/**
 * SPEC-802: forma de un destino en las respuestas. `endpoint` y `region` son null en los destinos de entorno,
 * cuya configuración vive en el servidor y no se expone al administrador del tenant.
 */
export class DestinationDto {
  id!: string;
  name!: string;
  location!: DestinationLocation;
  providerType!: DestinationProvider;
  endpoint!: string | null;
  bucket!: string;
  region!: string | null;
  connectionStatus!: DestinationConnectionStatus;
  isEnabled!: boolean;
  isDefault!: boolean;
  createdAt!: string;
}

/** SPEC-802: respuesta de `GET /destinations`. */
export class DestinationListDto {
  items!: DestinationDto[];
}

/** SPEC-802: respuesta de `POST /destinations/:id/test`. `reason` es null cuando la conexión funciona. */
export class DestinationTestResultDto {
  status!: 'Conectado' | 'Sin conexión';
  checkedAt!: string;
  reason!: 'AUTH' | 'NETWORK' | 'BUCKET_NOT_FOUND' | 'DATA_MISMATCH' | null;
}
