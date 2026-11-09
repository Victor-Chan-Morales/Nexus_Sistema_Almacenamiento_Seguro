import { Logger } from '@nestjs/common';
import { FilesService } from './files.service';
import { TrashRetentionService } from './trash-retention.service';

describe('TrashRetentionService (SPEC-215)', () => {
  it('purga carpetas antes que archivos, continúa ante fallos y no solapa ciclos', async () => {
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const item = (id: string) => ({ id, organizationId: 'org' });
    const files = {
      listExpiredTrash: jest.fn(async (kind: string, after: string | null) => {
        if (kind === 'folder') return after ? [] : [item('folder')];
        if (after === null) return [item('fallido'), item('siguiente')];
        return after === 'siguiente' ? [item('último')] : [];
      }),
      purgeExpiredFolder: jest.fn().mockResolvedValue(undefined),
      purgeExpiredFile: jest.fn().mockRejectedValueOnce(new Error('error de prueba')).mockResolvedValue(undefined),
    };
    const worker = new TrashRetentionService(files as unknown as FilesService);

    try {
      const run = worker.run();
      expect(worker.run()).toBe(run);
      await run;
      expect(files.purgeExpiredFolder).toHaveBeenCalledWith('folder', 'org');
      expect(files.purgeExpiredFolder.mock.invocationCallOrder[0])
        .toBeLessThan(files.purgeExpiredFile.mock.invocationCallOrder[0]);
      expect(files.purgeExpiredFile.mock.calls).toEqual([
        ['fallido', 'org'], ['siguiente', 'org'], ['último', 'org'],
      ]);
      expect(logger).toHaveBeenCalledTimes(1);
      await worker.run();
      expect(files.purgeExpiredFile).toHaveBeenCalledTimes(6);
    } finally {
      await worker.onModuleDestroy();
      logger.mockRestore();
    }
  });
});
