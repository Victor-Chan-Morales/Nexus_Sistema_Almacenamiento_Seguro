import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { AuthUser } from '../iam/interfaces/auth-user.interface';
import { FilesService } from './files.service';

@Controller('drives')
@UseGuards(AuthGuard('jwt'))
export class DrivesController {
  constructor(private readonly files: FilesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.files.listDrives(user);
  }
}
