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
  migrations: [path.resolve(__dirname, '../../../database/migrations/*{.ts,.js}')],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
});
