import { Injectable, ConflictException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { User, UserStatus } from './entities/user.entity';
import { Organization } from './entities/organization.entity';
import { Membership, MemberRole } from './entities/membership.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

/**
 * IamService — lógica de negocio de identidad y acceso.
 *
 * Este servicio es consumido directamente por otros módulos del monolito
 * (FilesModule, BillingModule) mediante inyección de dependencias.
 * No requiere llamadas HTTP entre servicios.
 */
@Injectable()
export class IamService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,

    @InjectRepository(Membership)
    private readonly membershipRepo: Repository<Membership>,

    private readonly jwtService: JwtService,
  ) {}

  // ── Registro ──────────────────────────────────────────────────────────────

  async register(dto: RegisterDto) {
    const existing = await this.userRepo.findOneBy({ email: dto.email });
    if (existing) {
      throw new ConflictException('El correo ya está registrado');
    }

    const passwordHash = await argon2.hash(dto.password);

    const user = this.userRepo.create({
      email: dto.email,
      fullName: dto.fullName,
      passwordHash,
      status: UserStatus.ACTIVE,
      emailVerified: false,
    });
    await this.userRepo.save(user);

    // Creamos u obtenemos organización y membresía
    let org = await this.orgRepo.findOneBy({ name: dto.organizationName });
    if (!org) {
      org = this.orgRepo.create({ name: dto.organizationName });
      await this.orgRepo.save(org);
    }

    const membership = this.membershipRepo.create({
      userId: user.id,
      organizationId: org.id,
      role: MemberRole.OWNER,
    });
    await this.membershipRepo.save(membership);

    return {
      userId: user.id,
      organizationId: org.id,
      role: membership.role,
      verificationRequired: true,
    };
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  async login(dto: LoginDto) {
    const user = await this.userRepo.findOne({
      where: { email: dto.email },
      relations: ['memberships', 'memberships.organization'],
    });
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const activeMembership = user.memberships?.[0];
    const organization = activeMembership?.organization;

    const payload = {
      sub: user.id,
      email: user.email,
      organizationId: organization?.id,
      role: activeMembership?.role || MemberRole.MEMBER,
    };
    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
      organization: organization
        ? { id: organization.id, name: organization.name }
        : { id: '', name: 'Personal' },
      role: activeMembership?.role || MemberRole.MEMBER,
    };
  }

  async getCurrentUser(userId: string) {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['memberships', 'memberships.organization'],
    });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    const activeMembership = user.memberships?.[0];
    const organization = activeMembership?.organization;

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
      },
      organization: organization
        ? { id: organization.id, name: organization.name }
        : { id: '', name: 'Personal' },
      role: activeMembership?.role || MemberRole.MEMBER,
    };
  }

  // ── Consulta de usuario (usado por otros módulos internamente) ────────────

  async findUserById(userId: string): Promise<User> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return user;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOneBy({ email });
  }

  // ── Organizaciones ────────────────────────────────────────────────────────

  async createOrganization(name: string, ownerId: string) {
    const existing = await this.orgRepo.findOneBy({ name });
    if (existing) {
      throw new ConflictException('El nombre de organización ya existe');
    }

    const org = this.orgRepo.create({ name });
    await this.orgRepo.save(org);

    const membership = this.membershipRepo.create({
      userId: ownerId,
      organizationId: org.id,
      role: MemberRole.OWNER,
    });
    await this.membershipRepo.save(membership);

    return org;
  }
}
