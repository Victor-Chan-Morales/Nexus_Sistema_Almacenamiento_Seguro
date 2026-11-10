import { IsString, IsUUID, ValidateIf } from 'class-validator';

class RenameDto {
  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @IsString()
  name?: string;
}

export class OrganizeFileDto extends RenameDto {
  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @IsUUID()
  folderId?: string;
}

export class OrganizeFolderDto extends RenameDto {
  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @IsUUID()
  parentId?: string;
}
