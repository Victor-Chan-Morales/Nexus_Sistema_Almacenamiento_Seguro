import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter — Formato canónico de errores { code, message, requestId }', () => {
  let filter: ApiExceptionFilter;
  let mockResponse: any;
  let mockRequest: any;
  let mockHost: any;

  beforeEach(() => {
    filter = new ApiExceptionFilter();

    mockResponse = {
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
      code: 'STORAGE_QUOTA_EXCEEDED',
      message: 'Capacidad insuficiente',
    });

    filter.catch(exception, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'STORAGE_QUOTA_EXCEEDED',
        message: 'Capacidad insuficiente',
        requestId: expect.any(String),
      }),
    );
  });

  it('debe capturar error 23505 de PostgreSQL y responder con CONCURRENT_SUBSCRIPTION_CONFLICT y HTTP 409', () => {
    const pgError = new Error('duplicate key value violates unique constraint');
    (pgError as any).code = '23505';

    filter.catch(pgError, mockHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CONCURRENT_SUBSCRIPTION_CONFLICT',
        message: expect.stringContaining('suscripción activa'),
        requestId: expect.any(String),
      }),
    );
  });

  it('debe utilizar X-Request-Id del header si está presente', () => {
    mockRequest.headers['x-request-id'] = 'custom-request-uuid-777';
    const exception = new BadRequestException('Entrada inválida');

    filter.catch(exception, mockHost);

    expect(mockResponse.json).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'custom-request-uuid-777',
      }),
    );
  });
});
