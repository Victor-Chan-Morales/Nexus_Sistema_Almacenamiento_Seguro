import { EntityManager } from 'typeorm';
import { DeploymentModel } from '../../iam/domain/enums';

/**
 * Puerto (DIP) por el que Files consulta el modelo de despliegue de una organización sin importar IAM.
 * Se enlaza en FilesModule con `useExisting: OrganizationRepository`, que IamModule exporta.
 */
export abstract class DeploymentModelSource {
  abstract findDeploymentModel(manager: EntityManager, organizationId: string): Promise<DeploymentModel | null>;
}
