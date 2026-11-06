import { InternalServerErrorException, Logger } from '@nestjs/common';
import { S3ObjectStorage } from './object-storage';

describe('SPEC-801: S3ObjectStorage', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('put envía el objeto al bucket con su tamaño y tipo de contenido', async () => {
    const send = jest.fn().mockResolvedValue({});
    const storage = new S3ObjectStorage({ send }, 'nexus-dev');

    await storage.put('org-1/file-1/v1/uuid', Buffer.from('abc'), 3, 'application/octet-stream');

    const command = send.mock.calls[0][0];
    expect(command.input).toEqual({
      Bucket: 'nexus-dev',
      Key: 'org-1/file-1/v1/uuid',
      Body: Buffer.from('abc'),
      ContentLength: 3,
      ContentType: 'application/octet-stream',
    });
  });

  it('put con tamaño negativo no fija ContentLength', async () => {
    const send = jest.fn().mockResolvedValue({});
    const storage = new S3ObjectStorage({ send }, 'nexus-dev');

    await storage.put('k', Buffer.from('abc'), -1, 'text/plain');

    expect(send.mock.calls[0][0].input).not.toHaveProperty('ContentLength');
  });

  it('get devuelve el cuerpo del objeto', async () => {
    const body = { on: jest.fn() };
    const storage = new S3ObjectStorage({ send: jest.fn().mockResolvedValue({ Body: body }) }, 'nexus-dev');

    await expect(storage.get('k')).resolves.toBe(body);
  });

  it('un fallo del proveedor se traduce a error genérico sin exponer el detalle', async () => {
    const storage = new S3ObjectStorage(
      { send: jest.fn().mockRejectedValue(new Error('credenciales inválidas')) },
      'nexus-dev',
    );

    await expect(storage.delete('k')).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(storage.delete('k')).rejects.toThrow('Error al eliminar el objeto de Storage');
  });
});
