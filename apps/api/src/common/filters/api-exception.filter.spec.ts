import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('ApiExceptionFilter — Formato canónico de errores { code, message, requestId }', () => {
  let filter: ApiExceptionFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: any;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    filter = new ApiExceptionFilter();

    mockResponse = {
      setHeader: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockRequest = {
      headers: {},
    };

    mockHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => mockRequest,
      }),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('debe transformar NotFoundException a formato estricto con requestId', () => {
    const exception = new NotFoundException('Recurso no encontrado');

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'NOT_FOUND',
        message: 'Recurso no encontrado',
        requestId: expect.any(String),
      }),
    );
  });

  it('debe conservar el código de error explícito cuando se proporciona en la excepción', () => {
    const exception = new ConflictException({
      code: 'CONCURRENT_SUBSCRIPTION_CONFLICT',
      message: 'Ya existe una suscripción activa para esta organización',
    });

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONCURRENT_SUBSCRIPTION_CONFLICT',
        message: 'Ya existe una suscripción activa para esta organización',
        requestId: expect.any(String),
      }),
    );
  });

  // El filtro no traduce errores crudos del driver: el 23505 lo convierte en
  // CONCURRENT_SUBSCRIPTION_CONFLICT la capa que conoce la restricción violada
  // (BillingService.persistSubscription y SubscriptionCoordinator). Aquí se verifica
  // lo contrario: que un error no controlado no filtre nada hacia el cliente.
  it('debe ocultar un error no controlado tras INTERNAL_ERROR 500 sin filtrar detalles', () => {
    const driverError = new Error('duplicate key value violates unique constraint');
    (driverError as any).code = '23505';

    filter.catch(driverError, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockResponse.json).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      message: 'Error interno del servidor',
      requestId: expect.any(String),
    });
  });

  it('debe generar el requestId en el servidor e ignorar el X-Request-Id del cliente', () => {
    mockRequest.headers['x-request-id'] = 'custom-request-uuid-777';
    const exception = new BadRequestException('Entrada inválida');

    filter.catch(exception, mockHost);

    const payload = mockResponse.json.mock.calls[0][0];
    expect(payload.requestId).not.toBe('custom-request-uuid-777');
    expect(payload.requestId).toMatch(UUID_V4);
    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-Id', payload.requestId);
  });

  it('debe reemplazar el mensaje de una excepción sin código por el genérico del estado', () => {
    filter.catch(new BadRequestException('planId must be a UUID'), mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(mockResponse.json).toHaveBeenCalledWith({
      code: 'VALIDATION_ERROR',
      message: 'Datos ausentes o mal formados',
      requestId: expect.any(String),
    });
  });
});
