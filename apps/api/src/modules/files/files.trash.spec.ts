import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";
import { BillingService } from "../billing/billing.service";
import { StorageService } from "../storage/storage.service";
import { Drive } from "./entities/drive.entity";
import { FileRecord } from "./entities/file-record.entity";
import { FileVersion } from "./entities/file-version.entity";
import { Folder } from "./entities/folder.entity";
import { Reservation } from "./entities/reservation.entity";
import { TenantEncryptionKey } from "./entities/tenant-encryption-key.entity";
import { TenantQuota } from "./entities/tenant-quota.entity";
import { Upload } from "./entities/upload.entity";
import { FilesCryptoService } from "./files-crypto.service";
import { FilesService, TRASH_RETENTION_DAYS } from "./files.service";

describe("FilesService - listTrash (SPEC-202)", () => {
  let service: FilesService;
  let driveRepo: Partial<Repository<Drive>>;
  let fileRepo: Partial<Repository<FileRecord>>;
  let versionRepo: Partial<Repository<FileVersion>>;

  const mockOrgId = "00000000-0000-0000-0000-000000000001";
  const mockUserId = "00000000-0000-0000-0000-000000000002";
  const mockDriveId = "00000000-0000-0000-0000-000000000003";

  beforeEach(async () => {
    driveRepo = {
      findOne: jest.fn(),
    };

    fileRepo = {
      createQueryBuilder: jest.fn(),
    };

    versionRepo = {
      findBy: jest.fn(),
    };

    const mockDataSource = {
      getRepository: jest.fn((entity) => {
        if (entity === Drive) return driveRepo;
        return {};
      }),
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: DataSource, useValue: mockDataSource },
        { provide: getRepositoryToken(FileRecord), useValue: fileRepo },
        { provide: getRepositoryToken(FileVersion), useValue: versionRepo },
        { provide: getRepositoryToken(Folder), useValue: {} },
        { provide: getRepositoryToken(Drive), useValue: driveRepo },
        { provide: getRepositoryToken(Upload), useValue: {} },
        { provide: getRepositoryToken(Reservation), useValue: {} },
        { provide: getRepositoryToken(TenantQuota), useValue: {} },
        { provide: getRepositoryToken(TenantEncryptionKey), useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: FilesCryptoService, useValue: {} },
        { provide: BillingService, useValue: {} },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
  });

  it("Escenario 1: Devuelve archivos en papelera con retentionEndsAt y tamaño correcto", async () => {
    (driveRepo.findOne as jest.Mock).mockResolvedValue({ id: mockDriveId });

    const deletedAt = new Date("2026-10-01T10:00:00.000Z");
    const mockFiles = [
      {
        id: "file-1",
        name: "documento.pdf",
        mimeType: "application/pdf",
        isDeleted: true,
        deletedAt,
        currentVersionId: "ver-1",
      },
    ];

    const qbMock: any = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([mockFiles, 1]),
    };
    (fileRepo.createQueryBuilder as jest.Mock).mockReturnValue(qbMock);

    (versionRepo.findBy as jest.Mock).mockResolvedValue([
      { id: "ver-1", sizeBytes: "1048576" },
    ]);

    const result = await service.listTrash(mockOrgId, mockUserId);

    expect(result.totalItems).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("documento.pdf");
    expect(result.items[0].sizeBytes).toBe(1048576);

    const expectedRetention = new Date(
      deletedAt.getTime() + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(result.items[0].retentionEndsAt).toBe(expectedRetention);
  });

  it("Escenario 2: Retorna lista vacía si el usuario no tiene Drive personal (sin crearlo)", async () => {
    (driveRepo.findOne as jest.Mock).mockResolvedValue(null);

    const result = await service.listTrash(mockOrgId, mockUserId);

    expect(result).toEqual({ items: [], totalItems: 0 });
    expect(fileRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it("Escenario 3: Respeta totalItems real cuando hay más de 500 registros", async () => {
    (driveRepo.findOne as jest.Mock).mockResolvedValue({ id: mockDriveId });

    const mockFiles = Array.from({ length: 500 }, (_, i) => ({
      id: `file-${i}`,
      name: `file-${i}.txt`,
      mimeType: "text/plain",
      isDeleted: true,
      deletedAt: new Date(),
      currentVersionId: null,
    }));

    const qbMock: any = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([mockFiles, 580]),
    };
    (fileRepo.createQueryBuilder as jest.Mock).mockReturnValue(qbMock);

    const result = await service.listTrash(mockOrgId, mockUserId);

    expect(result.items).toHaveLength(500);
    expect(result.totalItems).toBe(580);
  });

  it("Escenario 4: Si el archivo no tiene currentVersionId, sizeBytes es 0", async () => {
    (driveRepo.findOne as jest.Mock).mockResolvedValue({ id: mockDriveId });

    const mockFiles = [
      {
        id: "file-no-ver",
        name: "huerfano.bin",
        mimeType: null,
        isDeleted: true,
        deletedAt: new Date("2026-10-15T00:00:00.000Z"),
        currentVersionId: null,
      },
    ];

    const qbMock: any = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([mockFiles, 1]),
    };
    (fileRepo.createQueryBuilder as jest.Mock).mockReturnValue(qbMock);

    const result = await service.listTrash(mockOrgId, mockUserId);

    expect(result.items[0].sizeBytes).toBe(0);
    expect(result.items[0].mimeType).toBe("application/octet-stream");
    expect(versionRepo.findBy).not.toHaveBeenCalled();
  });
});
