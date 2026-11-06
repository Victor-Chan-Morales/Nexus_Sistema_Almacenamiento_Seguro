import { ConflictException, HttpException, HttpStatus, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditResource } from '../audit/audit.types';
import { StorageRouter } from '../storage/storage-router.service';
import {
  CreateDestinationDto,
  DestinationDto,
  DestinationListDto,
  DestinationTestResultDto,
  UpdateDestinationDto,
} from './dto/destination.dto';
import { Destination } from './entities/destination.entity';
import { Folder } from './entities/folder.entity';
import { DestinationConnectionDetails, FilesCryptoService } from './files-crypto.service';

/** Misma forma que los errores de negocio de Files: { statusCode, error, code, message }. */
function businessError(status: HttpStatus, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, error: HttpStatus[status] ?? 'Error', code, message }, status);
}

/** SPEC-802: 422. Endpoint de loopback, link-local o metadatos, rango privado sin bandera, o host sin resolver. */
function endpointNotAllowedError(): HttpException {
  return businessError(HttpStatus.UNPROCESSABLE_ENTITY, 'DESTINATION_ENDPOINT_NOT_ALLOWED', 'El endpoint no está permitido');
}

/** SPEC-802: 422. El destino es el predeterminado o tiene carpetas activas asignadas. */
function destinationInUseError(): HttpException {
  return businessError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'DESTINATION_IN_USE',
    'El destino es el predeterminado o tiene carpetas activas asignadas',
  );
}

/** SPEC-802: 400. Los destinos de entorno solo admiten cambiar nombre, ubicación y estado. */
function environmentDestinationError(): HttpException {
  return businessError(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_ERROR',
    'Este destino usa la configuración del servidor; solo se puede cambiar su nombre, ubicación o estado',
  );
}

function destinationNotFoundError(): NotFoundException {
  return new NotFoundException('Destino no encontrado');
}

export type AddressClass = 'public' | 'private' | 'blocked';

/**
 * SPEC-802: clasifica una IPv4. Loopback, "este" equipo, link-local y metadatos de nube (169.254.169.254)
 * están siempre bloqueados. Los rangos privados (y CGNAT, 100.64/10) solo se admiten con DESTINATION_ALLOW_PRIVATE.
 */
function classifyIpv4(address: string): AddressClass {
  const [a, b] = address.split('.').map(Number);
  if (a === 0 || a === 127) return 'blocked';
  if (a === 169 && b === 254) return 'blocked';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'private';
  return 'public';
}

/**
 * Expande una IPv6 a sus 8 grupos de 16 bits. Acepta las formas comprimidas (`::`) y la cola IPv4 (`::ffff:1.2.3.4`).
 * Devuelve null si no puede interpretarla: quien llama la trata como bloqueada.
 */
function expandIpv6(address: string): number[] | null {
  let text = address.split('%')[0].toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const o = dotted[1].split('.').map(Number);
    text = text.slice(0, -dotted[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 && head.length !== 8) return null;
  if (fill < 0) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** SPEC-802: clasifica una IPv6, incluidas las IPv4 mapeadas (`::ffff:127.0.0.1` se trata como IPv4). */
function classifyIpv6(address: string): AddressClass {
  const h = expandIpv6(address);
  if (!h) return 'blocked';

  const mappedIpv4 = h.slice(0, 5).every((g) => g === 0) && h[5] === 0xffff;
  if (mappedIpv4) return classifyIpv4([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff].join('.'));

  const unspecifiedOrLoopback = h.slice(0, 7).every((g) => g === 0) && (h[7] === 0 || h[7] === 1);
  if (unspecifiedOrLoopback) return 'blocked';
  if ((h[0] & 0xffc0) === 0xfe80) return 'blocked'; // fe80::/10, link-local
  if ((h[0] & 0xfe00) === 0xfc00) return 'private'; // fc00::/7, única local
  return 'public';
}

/** Clasifica una dirección IP literal. Cualquier cosa que no sea IP se trata como bloqueada. */
export function classifyAddress(address: string): AddressClass {
  const version = isIP(address);
  if (version === 4) return classifyIpv4(address);
  if (version === 6) return classifyIpv6(address);
  return 'blocked';
}

/**
 * SPEC-802: valida el endpoint antes de conectarse. Resuelve el DNS del host y revisa cada dirección,
 * porque un nombre público puede apuntar a loopback o a metadatos. Lanza 422 DESTINATION_ENDPOINT_NOT_ALLOWED.
 * Un host que no resuelve también se rechaza: no hay nada a lo que conectarse.
 */
export async function assertEndpointAllowed(endpoint: string, allowPrivate: boolean): Promise<void> {
  let host: string;
  try {
    // URL conserva los corchetes de IPv6 en `hostname`.
    host = new URL(endpoint).hostname.replace(/^\[|\]$/g, '');
  } catch {
    throw endpointNotAllowedError();
  }

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true })).map((record) => record.address);
    } catch {
      throw endpointNotAllowedError();
    }
  }
  if (addresses.length === 0) throw endpointNotAllowedError();

  for (const address of addresses) {
    const cls = classifyAddress(address);
    if (cls === 'blocked' || (cls === 'private' && !allowPrivate)) throw endpointNotAllowedError();
  }
}

export interface DestinationActor {
  organizationId: string;
  userId: string;
}

/** Datos de conexión de un destino propio. Viven cifrados en `connection_details_encrypted`. */
type ConnectionDetails = DestinationConnectionDetails;

const CONNECTION_FIELDS = ['endpoint', 'bucket', 'region', 'accessKey', 'secretKey', 'useSsl'] as const;

/**
 * SPEC-802: administrar los destinos de almacenamiento propios de una organización (crear, listar y editar).
 * Las credenciales se cifran al guardar y nunca salen en una respuesta, un log ni un evento de auditoría.
 * Los destinos de entorno (creados con la configuración `S3_*`) siguen en la base con referencias `environment:*`:
 * se listan, pero sus datos de conexión no se pueden reemplazar desde la API.
 */
@Injectable()
export class DestinationsService {
  constructor(
    @InjectRepository(Destination)
    private readonly destinations: Repository<Destination>,
    private readonly dataSource: DataSource,
    private readonly crypto: FilesCryptoService,
    private readonly config: ConfigService,
    private readonly router: StorageRouter,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async list(actor: DestinationActor): Promise<DestinationListDto> {
    const rows = await this.destinations.find({
      where: { organizationId: actor.organizationId },
      order: { createdAt: 'ASC' },
    });
    return { items: rows.map((row) => this.toDto(row, this.readDetails(row))) };
  }

  /** Registra un destino propio. Nace en `Sin comprobar`, habilitado y no predeterminado. */
  async create(dto: CreateDestinationDto, actor: DestinationActor): Promise<DestinationDto> {
    await assertEndpointAllowed(dto.endpoint, this.allowPrivate());

    const details: ConnectionDetails = {
      endpoint: dto.endpoint,
      bucket: dto.bucket,
      region: dto.region,
      accessKey: dto.accessKey,
      secretKey: dto.secretKey,
      useSsl: dto.useSsl,
    };
    const saved = await this.destinations.save(
      this.destinations.create({
        organizationId: actor.organizationId,
        name: dto.name,
        location: dto.location,
        providerType: dto.providerType,
        connectionStatus: 'Sin comprobar',
        isEnabled: true,
        isDefault: false,
        bucketOrPrefix: dto.bucket,
        connectionDetailsEncrypted: this.encrypt(actor.organizationId, details),
      }),
    );

    this.audit(AuditAction.DESTINATION_CREATED, saved.id, actor);
    return this.toDto(saved, details);
  }

  /**
   * Edita un destino. Cualquier cambio devuelve el estado a `Sin comprobar`. Deshabilitar el predeterminado
   * o uno con carpetas activas responde 422. La validación del endpoint y la revisión de uso ocurren antes de escribir.
   */
  async update(id: string, dto: UpdateDestinationDto, actor: DestinationActor): Promise<DestinationDto> {
    if (dto.endpoint !== undefined) {
      await assertEndpointAllowed(dto.endpoint, this.allowPrivate());
    }
    const changesConnection = CONNECTION_FIELDS.some((field) => dto[field] !== undefined);

    const { row, details } = await this.dataSource.transaction(async (manager) => {
      const current = await manager.findOne(Destination, {
        where: { id, organizationId: actor.organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw destinationNotFoundError();

      const currentDetails = this.readDetails(current);
      if (currentDetails === null && changesConnection) throw environmentDestinationError();

      if (dto.isEnabled === false) {
        const activeFolders = await manager.count(Folder, {
          where: { organizationId: actor.organizationId, destinationId: id, deletedAt: IsNull() },
        });
        if (current.isDefault || activeFolders > 0) throw destinationInUseError();
      }

      const nextDetails: ConnectionDetails | null =
        currentDetails === null
          ? null
          : {
              // Una secretKey omitida conserva la actual.
              endpoint: dto.endpoint ?? currentDetails.endpoint,
              bucket: dto.bucket ?? currentDetails.bucket,
              region: dto.region ?? currentDetails.region,
              accessKey: dto.accessKey ?? currentDetails.accessKey,
              secretKey: dto.secretKey ?? currentDetails.secretKey,
              useSsl: dto.useSsl ?? currentDetails.useSsl,
            };

      current.name = dto.name ?? current.name;
      current.location = dto.location ?? current.location;
      current.providerType = dto.providerType ?? current.providerType;
      current.isEnabled = dto.isEnabled ?? current.isEnabled;
      current.connectionStatus = 'Sin comprobar';
      if (nextDetails && changesConnection) {
        current.bucketOrPrefix = nextDetails.bucket;
        current.connectionDetailsEncrypted = this.encrypt(actor.organizationId, nextDetails);
      }

      const saved = await manager.save(Destination, current);
      return { row: saved, details: nextDetails };
    });

    // Credenciales nuevas: el cliente cacheado con las anteriores ya no sirve.
    this.router.invalidate(id);
    this.audit(AuditAction.DESTINATION_UPDATED, id, actor);
    return this.toDto(row, details);
  }

  /**
   * SPEC-802 escenario 3: prueba la conexión del destino. Repite la validación del endpoint antes de conectarse
   * (el DNS pudo cambiar desde que se guardó), marca `Comprobando` mientras corre y guarda el resultado.
   */
  async testConnection(id: string, actor: DestinationActor): Promise<DestinationTestResultDto> {
    const row = await this.destinations.findOne({ where: { id, organizationId: actor.organizationId } });
    if (!row) throw destinationNotFoundError();
    if (!row.isEnabled) {
      throw new ConflictException({ code: 'CONFLICT', message: 'El destino está deshabilitado; habilítalo para probarlo' });
    }

    const details = this.readDetails(row);
    if (details) await assertEndpointAllowed(details.endpoint, this.allowPrivate());

    row.connectionStatus = 'Comprobando';
    await this.destinations.save(row);

    const result = await this.router.probe(actor.organizationId, id);
    const checkedAt = new Date();
    const status = result.ok ? ('Conectado' as const) : ('Sin conexión' as const);
    row.connectionStatus = status;
    await this.destinations.save(row);

    this.audit(AuditAction.DESTINATION_TESTED, id, actor);
    return {
      status,
      checkedAt: checkedAt.toISOString(),
      reason: 'reason' in result ? result.reason : null,
    };
  }

  private encrypt(organizationId: string, details: ConnectionDetails): string {
    return this.crypto.encryptConnectionDetails(organizationId, JSON.stringify(details));
  }

  /** Devuelve los datos propios, o null si el destino usa la configuración del servidor. */
  private readDetails(row: Destination): ConnectionDetails | null {
    return this.crypto.readDestinationDetails(row.organizationId, row.connectionDetailsEncrypted);
  }

  /** Solo los campos públicos: nunca accessKey ni secretKey. */
  private toDto(row: Destination, details: ConnectionDetails | null): DestinationDto {
    return {
      id: row.id,
      name: row.name,
      location: row.location,
      providerType: row.providerType,
      endpoint: details?.endpoint ?? null,
      bucket: details?.bucket ?? row.bucketOrPrefix,
      region: details?.region ?? null,
      connectionStatus: row.connectionStatus,
      isEnabled: row.isEnabled,
      isDefault: row.isDefault,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private allowPrivate(): boolean {
    return this.config.get<string>('DESTINATION_ALLOW_PRIVATE') === 'true';
  }

  private audit(action: AuditAction, resourceId: string, actor: DestinationActor): void {
    void this.auditService?.logEvent({
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action,
      resourceType: AuditResource.DESTINATION,
      resourceId,
    });
  }
}
