import 'reflect-metadata';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { DataSource, EntityManager } from 'typeorm';
import { buildPostgresSsl } from '../config/postgres-config';
import { FilesCryptoService, lockTenantEncryption } from '../modules/files/files-crypto.service';

const BATCH_SIZE = 200;
const USAGE = 'Uso: npm run keys:rotate -- --to <versión mayor que 1> [--dry-run]';

interface RotationOptions {
  toVersion: number;
  dryRun: boolean;
}

interface RotationSummary {
  organizations: number;
  keys: number;
  versions: number;
  destinations: number;
}

interface VersionRow {
  id: string;
  fileId: string;
  versionNumber: number;
  encryptedDek: string;
  reference: string;
}

interface DestinationRow {
  id: string;
  ciphertext: string;
}

export function parseRotationOptions(args: string[]): RotationOptions {
  const version = Number(args[1]);
  if (args[0] !== '--to' || !/^[1-9]\d*$/.test(args[1] ?? '') || !Number.isSafeInteger(version) || version < 2 ||
    (args.length !== 2 && !(args.length === 3 && args[2] === '--dry-run'))) {
    throw new Error(USAGE);
  }
  return { toVersion: version, dryRun: args.length === 3 };
}

export async function rotateKeys(
  database: DataSource,
  crypto: FilesCryptoService,
  options: RotationOptions,
): Promise<RotationSummary> {
  crypto.assertMasterKeyAvailable(options.toVersion);
  const summary: RotationSummary = { organizations: 0, keys: 0, versions: 0, destinations: 0 };
  const organizations: { id: string }[] = await database.query(
    'SELECT organization_id AS id FROM admin.organization ORDER BY organization_id',
  );
  for (const { id } of organizations) {
    try {
      const result = await database.transaction(options.dryRun ? 'REPEATABLE READ' : 'READ COMMITTED', async (tx) => {
        if (options.dryRun) await tx.query('SET TRANSACTION READ ONLY');
        else await lockTenantEncryption(tx, id);
        return rotateOrganization(tx, crypto, id, options);
      });
      summary.organizations++;
      summary.keys += result.keys;
      summary.versions += result.versions;
      summary.destinations += result.destinations;
    } catch {
      // Los errores SQL pueden contener parámetros y los de cifrado pueden contener datos de la fila.
      throw new Error(`No se pudo procesar la organización ${id}. Organizaciones completadas: ${summary.organizations}. Revise las llaves configuradas, la versión objetivo y el estado de la base.`);
    }
  }
  return summary;
}

async function rotateOrganization(
  tx: EntityManager,
  crypto: FilesCryptoService,
  organizationId: string,
  { toVersion, dryRun }: RotationOptions,
): Promise<Omit<RotationSummary, 'organizations'>> {
  const [active]: { id: string; reference: string }[] = await tx.query(
    "SELECT key_id AS id, external_reference AS reference FROM files.tenant_encryption_key WHERE organization_id = $1 AND status = 'active'" +
    (dryRun ? '' : ' FOR UPDATE'),
    [organizationId],
  );
  const activeVersion = active && crypto.keyVersionFromReference(active.reference, organizationId);
  if (activeVersion > toVersion) throw new Error('No se admite volver a una versión anterior');

  const needsKey = activeVersion !== toVersion;
  let targetId = needsKey ? null : active.id;
  if (needsKey && !dryRun) {
    if (active) {
      await tx.query("UPDATE files.tenant_encryption_key SET status = 'rotated', rotated_at = clock_timestamp() WHERE key_id = $1", [active.id]);
    }
    const [target]: { id: string }[] = await tx.query(
      'INSERT INTO files.tenant_encryption_key (organization_id, external_reference) VALUES ($1, $2) RETURNING key_id AS id',
      [organizationId, crypto.externalKeyReference(organizationId, toVersion)],
    );
    targetId = target.id;
  }

  let versions = 0;
  let after: string | null = null;
  while (true) {
    const batch: VersionRow[] = await tx.query(
      `SELECT v.version_id AS id, v.file_id AS "fileId", v.version_number AS "versionNumber",
              v.encrypted_dek AS "encryptedDek", k.external_reference AS reference
         FROM files.file_version v JOIN files.file f ON f.file_id = v.file_id
         JOIN files.tenant_encryption_key k ON k.key_id = v.kek_id
        WHERE f.organization_id = $1 AND v.kek_id IS DISTINCT FROM $2::uuid
          AND ($3::uuid IS NULL OR v.version_id > $3)
        ORDER BY v.version_id LIMIT $4` + (dryRun ? '' : ' FOR UPDATE OF v'),
      [organizationId, targetId, after, BATCH_SIZE],
    );
    if (!batch.length) break;
    for (const row of batch) {
      const fromVersion = crypto.keyVersionFromReference(row.reference, organizationId);
      if (fromVersion > toVersion) throw new Error('No se admite volver a una versión anterior');
      const encryptedDek = crypto.rewrapDek(organizationId, row.fileId, row.versionNumber, row.encryptedDek, fromVersion, toVersion);
      if (!dryRun) {
        await tx.query('UPDATE files.file_version SET encrypted_dek = $1, kek_id = $2 WHERE version_id = $3', [
          encryptedDek, targetId, row.id,
        ]);
      }
    }
    versions += batch.length;
    after = batch[batch.length - 1].id;
  }

  const rows: DestinationRow[] = await tx.query(
    'SELECT destination_id AS id, connection_details_encrypted AS ciphertext FROM files.destination WHERE organization_id = $1' +
    (dryRun ? '' : ' FOR UPDATE'),
    [organizationId],
  );
  let destinations = 0;
  for (const row of rows) {
    const fromVersion = crypto.connectionKeyVersion(row.ciphertext);
    if (fromVersion === toVersion) continue;
    if (fromVersion > toVersion) throw new Error('No se admite volver a una versión anterior');
    const details = crypto.decryptConnectionDetails(organizationId, row.ciphertext);
    if (!dryRun) {
      await tx.query('UPDATE files.destination SET connection_details_encrypted = $1 WHERE destination_id = $2', [
        crypto.encryptConnectionDetails(organizationId, details, toVersion), row.id,
      ]);
    }
    destinations++;
  }
  return { keys: Number(needsKey), versions, destinations };
}

async function main(): Promise<void> {
  await ConfigModule.forRoot({ envFilePath: ['.env', '../../.env'], ignoreEnvVars: false });
  const config = new ConfigService();
  const crypto = new FilesCryptoService(config);
  let options: RotationOptions;
  try {
    options = parseRotationOptions(process.argv.slice(2));
    crypto.assertMasterKeyAvailable(options.toVersion);
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : USAGE) + '\n');
    process.exitCode = 1;
    return;
  }

  const database = new DataSource({
    type: 'postgres',
    host: config.get('POSTGRES_HOST', 'localhost'),
    port: Number(config.get('POSTGRES_PORT', 5433)),
    username: config.get('POSTGRES_USER', 'nexus_dev'),
    password: config.get('POSTGRES_PASSWORD', 'local_only_change_me'),
    database: config.get('POSTGRES_DB', 'nexus_dev'),
    ssl: buildPostgresSsl((key) => config.get<string>(key), (path) => readFileSync(path, 'utf8')),
    synchronize: false,
    logging: false,
  });
  try {
    await database.initialize();
    const summary = await rotateKeys(database, crypto, options);
    const title = options.dryRun ? 'Simulación sin escrituras' : 'Rotación completada';
    process.stdout.write(
      `${title}\nOrganizaciones: ${summary.organizations} | KEK nuevas: ${summary.keys} | Versiones: ${summary.versions} | Destinos: ${summary.destinations}\n`,
    );
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith('No se pudo procesar la organización ')
      ? error.message
      : 'No se pudo completar la rotación. Revise la conexión y las migraciones de PostgreSQL.';
    process.stderr.write(message + '\n');
    process.exitCode = 1;
  } finally {
    if (database.isInitialized) await database.destroy();
  }
}

if (require.main === module) {
  void main().catch(() => {
    process.stderr.write('No se pudo iniciar la rotación. Revise la configuración.\n');
    process.exitCode = 1;
  });
}
