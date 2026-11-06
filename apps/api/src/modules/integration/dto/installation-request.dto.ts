import { IsIn } from 'class-validator';
import { DeploymentModel } from '../../iam/domain/enums';
import type { InstallationRequestStatus } from '../entities/installation-request.entity';

/** SPEC-803 §5: cuerpo de `POST /organizations/installation-requests`. */
export class CreateInstallationRequestDto {
  @IsIn(Object.values(DeploymentModel))
  requestedModel!: DeploymentModel;
}

/** Respuesta `201` de `POST /organizations/installation-requests`. */
export interface InstallationRequestCreatedDto {
  id: string;
  status: InstallationRequestStatus;
  createdAt: string;
}

export interface InstallationRequestItemDto {
  id: string;
  requestedModel: DeploymentModel;
  status: InstallationRequestStatus;
  createdAt: string;
  reviewedAt: string | null;
}

/** Respuesta de `GET /organizations/installation-requests`: solo de la organización de la sesión. */
export interface InstallationRequestListDto {
  items: InstallationRequestItemDto[];
}
