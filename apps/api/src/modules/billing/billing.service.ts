import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PlanResponse, SubscriptionActivationResponse } from './billing.dto';

@Injectable()
export class BillingService {

  async getCatalog(): Promise<PlanResponse[]> {
    return [
      {
        id: 'demo-plan-uuid-1234',
        name: 'Plan Demo',
        description: 'Plan de prueba con límite de 5GB',
        priceMonthly: 0,
        storageLimitBytes: 5368709120, // 5 GB en bytes
        userLimit: 5, // Límite de 5 usuarios
        validityDays: 30
      }
    ];
  }

  async activate(planId: string, organizationId: string): Promise<SubscriptionActivationResponse> {

    if (planId !== 'demo-plan-uuid-1234') {
      throw new NotFoundException({
        code: 'ERROR_NOT_FOUND',
        message: 'El plan solicitado no existe'
      });
    }

    const hasActiveSub = false; 
    if (hasActiveSub) {
      throw new ConflictException({
        code: 'ERROR_CONFLICT',
        message: 'La organización ya tiene una suscripción activa'
      });
    }

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 30);

    return {
      subscriptionId: 'new-sub-uuid-5678',
      status: 'active',
      simulated: true, 
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    };
  }
}