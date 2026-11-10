import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { FilesCryptoService } from '../modules/files/files-crypto.service';
import { parseRotationOptions, rotateKeys } from './rotate-keys';

const keys = {
  FILES_MASTER_KEY: randomBytes(32).toString('base64'),
  FILES_MASTER_KEY_V2: randomBytes(32).toString('base64'),
};
const crypto = new FilesCryptoService(new ConfigService(keys));
const plain = Buffer.from('archivo de prueba');
const details = '{"endpoint":"environment:S3_ENDPOINT"}';
const apply = { toVersion: 2, dryRun: false };

function fixture() {
  const state = ['org-a', 'org-b'].map((id) => ({
    id,
    active: { id: `${id}-v1`, reference: crypto.externalKeyReference(id, 1) },
    retired: [] as string[],
    version: {
      id: `${id}-version`, fileId: `${id}-file`, versionNumber: 1, kekId: `${id}-v1`,
      encryptedDek: crypto.encryptFile(id, `${id}-file`, 1, plain, 1).encryptedDek,
    },
    destination: { id: `${id}-destination`, ciphertext: crypto.encryptConnectionDetails(id, details, 1) },
  }));
  let organizationIndex = 0;
  let failDestinationFor: string | null = null;
  const database = {
    query: jest.fn(async () => {
      organizationIndex = 0;
      return state.map(({ id }) => ({ id }));
    }),
    transaction: jest.fn(async (isolation, work) => {
      const index = organizationIndex++;
      const draft = structuredClone(state[index]);
      const originalReference = draft.active.reference;
      const tx = {
        query: async (sql: string, params: (string | number | null)[] = []) => {
          if (sql.startsWith('SET TRANSACTION') || sql.includes('pg_advisory_xact_lock')) return [];
          if (sql.includes('SELECT key_id AS id')) return [draft.active];
          if (isolation === 'REPEATABLE READ' && /^(UPDATE|INSERT)/.test(sql)) throw new Error('escritura durante dry-run');
          if (sql.startsWith('UPDATE files.tenant_encryption_key')) {
            draft.retired.push(String(params[0]));
          } else if (sql.startsWith('INSERT INTO files.tenant_encryption_key')) {
            draft.active = { id: `${draft.id}-v2`, reference: String(params[1]) };
            return [{ id: draft.active.id }];
          } else if (sql.includes('SELECT v.version_id')) {
            return params[2] || draft.version.kekId === params[1]
              ? []
              : [{ ...draft.version, reference: originalReference }];
          } else if (sql.startsWith('UPDATE files.file_version')) {
            draft.version.encryptedDek = String(params[0]);
            draft.version.kekId = String(params[1]);
          } else if (sql.includes('SELECT destination_id')) {
            return [draft.destination];
          } else if (sql.startsWith('UPDATE files.destination')) {
            if (failDestinationFor === draft.id) throw new Error('error simulado con parámetros privados');
            draft.destination.ciphertext = String(params[0]);
          } else {
            throw new Error('consulta inesperada');
          }
          return [];
        },
      };
      const result = await work(tx);
      state[index] = draft;
      return result;
    }),
  };
  return {
    database, state: () => structuredClone(state),
    failDestination: (id: string | null) => { failDestinationFor = id; },
  };
}

describe('keys:rotate (SPEC-005)', () => {
  it('valida la versión y rechaza opciones adicionales', () => {
    expect(parseRotationOptions(['--to', '2', '--dry-run'])).toEqual({ toVersion: 2, dryRun: true });
    expect(() => parseRotationOptions(['--to', '1'])).toThrow('Uso');
    expect(() => parseRotationOptions(['--to', '2', '--force'])).toThrow('Uso');
  });

  it('falla por llave de destino faltante antes de abrir una transacción', async () => {
    const { database } = fixture();
    const missing = new FilesCryptoService(new ConfigService({ FILES_MASTER_KEY: keys.FILES_MASTER_KEY, FILES_MASTER_KEY_V2: '' }));
    await expect(rotateKeys(database as never, missing, apply)).rejects.toThrow('FILES_MASTER_KEY_V2 no está configurada');
    expect(database.query).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('la simulación calcula el impacto sin escrituras', async () => {
    const f = fixture();
    const before = f.state();
    await expect(rotateKeys(f.database as never, crypto, { ...apply, dryRun: true }))
      .resolves.toEqual({ organizations: 2, keys: 2, versions: 2, destinations: 2 });
    expect(f.state()).toEqual(before);
  });

  it('revierte una organización fallida y reanuda sin duplicar la KEK confirmada', async () => {
    const f = fixture();
    const before = f.state();
    f.failDestination('org-b');
    await expect(rotateKeys(f.database as never, crypto, apply)).rejects.toThrow('Organizaciones completadas: 1');
    const interrupted = f.state();
    expect(interrupted[0].active.id).toBe('org-a-v2');
    expect(interrupted[1]).toEqual(before[1]);

    f.failDestination(null);
    await expect(rotateKeys(f.database as never, crypto, apply))
      .resolves.toEqual({ organizations: 2, keys: 1, versions: 1, destinations: 1 });
    expect(f.state()[0]).toEqual(interrupted[0]);
    expect(f.state()[1].retired).toEqual(['org-b-v1']);
    expect(crypto.decryptConnectionDetails('org-b', f.state()[1].destination.ciphertext)).toBe(details);
  });
});
