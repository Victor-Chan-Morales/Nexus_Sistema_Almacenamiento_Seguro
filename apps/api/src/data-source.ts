import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Cargar variables de entorno desde la raíz del monorepo
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  username: process.env.POSTGRES_USER || 'nexus_dev',
  password: process.env.POSTGRES_PASSWORD || 'local_only_change_me',
  database: process.env.POSTGRES_DB || 'nexus_dev',
  entities: [path.resolve(__dirname, 'modules/**/*.entity{.ts,.js}')],
  // Las migraciones viven dentro del paquete de la API: un .ts fuera de apps/api no puede
  // resolver 'typeorm', porque node_modules solo existe aquí.
  migrations: [path.resolve(__dirname, 'migrations/*{.ts,.js}')],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
});
