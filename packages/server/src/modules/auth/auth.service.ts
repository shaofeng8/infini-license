import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { BusinessException } from '@/common/exceptions/biz.exception'
import { ErrorEnum } from '@/constants/error-code.constant'
import { ISecurityConfig, securityRegToken } from '@/config'
import { CryptoService } from '../crypto/crypto.service'
import { AuditService } from '../audit/audit.service'
import { AdminRole, AdminUserEntity } from './admin-user.entity'
import { AuthUser } from './auth.decorator'
import { ChangePasswordDto, CreateAdminUserDto, LoginResultDto } from './auth.dto'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    @InjectRepository(AdminUserEntity)
    private readonly repo: Repository<AdminUserEntity>,
    private readonly jwtService: JwtService,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  async login(username: string, password: string, ip?: string): Promise<LoginResultDto> {
    const security = this.configService.get<ISecurityConfig>(securityRegToken)

    const user = await this.repo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.username = :username', { username })
      .getOne()

    // 用户不存在与密码错误返回同一个错误码，避免账号枚举
    if (!user) {
      throw new BusinessException(ErrorEnum.INVALID_CREDENTIALS)
    }
    if (user.status !== 1) {
      throw new BusinessException(ErrorEnum.ACCOUNT_DISABLED)
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new BusinessException(ErrorEnum.ACCOUNT_LOCKED)
    }

    if (!this.cryptoService.verifyPassword(password, user.passwordHash)) {
      await this.onLoginFailed(user, security)
      throw new BusinessException(ErrorEnum.INVALID_CREDENTIALS)
    }

    await this.repo.update(
      { _id: user._id },
      { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ip ?? null },
    )

    await this.auditService.record({
      actorId: user._id,
      actorName: user.username,
      action: 'admin.login',
      targetType: 'admin_user',
      targetId: user._id,
      summary: `${user.username} 登录成功`,
      ip,
    })

    return this.signToken(user)
  }

  private async onLoginFailed(user: AdminUserEntity, security: ISecurityConfig): Promise<void> {
    const attempts = user.failedAttempts + 1
    const shouldLock = attempts >= security.maxFailedAttempts

    await this.repo.update(
      { _id: user._id },
      {
        failedAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + security.lockMinutes * 60_000)
          : user.lockedUntil,
      },
    )

    if (shouldLock) {
      this.logger.warn(`账号 ${user.username} 连续登录失败 ${attempts} 次，已临时锁定`)
      await this.auditService.record({
        actorId: user._id,
        actorName: user.username,
        action: 'admin.locked',
        targetType: 'admin_user',
        targetId: user._id,
        summary: `连续失败 ${attempts} 次，锁定 ${security.lockMinutes} 分钟`,
      })
    }
  }

  private signToken(user: AdminUserEntity): LoginResultDto {
    const { jwtExpiresIn } = this.configService.get<ISecurityConfig>(securityRegToken)
    const accessToken = this.jwtService.sign({
      sub: user._id,
      username: user.username,
      realName: user.realName,
      role: user.role,
    })

    return {
      accessToken,
      expiresIn: parseDuration(jwtExpiresIn),
      user: {
        id: user._id,
        username: user.username,
        realName: user.realName,
        role: user.role,
      },
    }
  }

  async profile(userId: string): Promise<AdminUserEntity> {
    const user = await this.repo.findOne({ where: { _id: userId } })
    if (!user) {
      throw new BusinessException(ErrorEnum.TOKEN_INVALID)
    }
    return user
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.repo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u._id = :userId', { userId })
      .getOne()

    if (!user) {
      throw new BusinessException(ErrorEnum.TOKEN_INVALID)
    }
    if (!this.cryptoService.verifyPassword(dto.oldPassword, user.passwordHash)) {
      throw new BusinessException(ErrorEnum.OLD_PASSWORD_WRONG)
    }
    assertPasswordStrength(dto.newPassword)

    await this.repo.update(
      { _id: userId },
      { passwordHash: this.cryptoService.hashPassword(dto.newPassword) },
    )

    await this.auditService.record({
      actorId: userId,
      actorName: user.username,
      action: 'admin.change_password',
      targetType: 'admin_user',
      targetId: userId,
      summary: '修改自己的密码',
    })
  }

  async listUsers(): Promise<AdminUserEntity[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } })
  }

  async createUser(dto: CreateAdminUserDto, operator: AuthUser): Promise<AdminUserEntity> {
    assertPasswordStrength(dto.password)

    const exists = await this.repo.count({ where: { username: dto.username } })
    if (exists > 0) {
      throw new BusinessException('该用户名已被占用')
    }

    const saved = await this.repo.save(
      this.repo.create({
        username: dto.username,
        passwordHash: this.cryptoService.hashPassword(dto.password),
        realName: dto.realName ?? null,
        role: dto.role,
        status: 1,
        failedAttempts: 0,
      }),
    )

    await this.auditService.record({
      actorId: operator.id,
      actorName: operator.username,
      action: 'admin.create_user',
      targetType: 'admin_user',
      targetId: saved._id,
      summary: `创建账号 ${dto.username}（${dto.role}）`,
    })

    return saved
  }

  async setStatus(userId: string, status: number, operator: AuthUser): Promise<void> {
    if (userId === operator.id) {
      throw new BusinessException('不能停用自己的账号')
    }
    const target = await this.repo.findOne({ where: { _id: userId } })
    if (!target) {
      throw new BusinessException(ErrorEnum.RESOURCE_NOT_FOUND)
    }
    // 至少留一个可用的 owner，否则会把自己锁在门外
    if (target.role === AdminRole.OWNER && status !== 1) {
      const activeOwners = await this.repo.count({
        where: { role: AdminRole.OWNER, status: 1 },
      })
      if (activeOwners <= 1) {
        throw new BusinessException('这是最后一个可用的 owner 账号，不能停用')
      }
    }

    await this.repo.update({ _id: userId }, { status, failedAttempts: 0, lockedUntil: null })
    await this.auditService.record({
      actorId: operator.id,
      actorName: operator.username,
      action: 'admin.set_status',
      targetType: 'admin_user',
      targetId: userId,
      summary: `${status === 1 ? '启用' : '停用'}账号 ${target.username}`,
    })
  }

  async resetPassword(userId: string, newPassword: string, operator: AuthUser): Promise<void> {
    assertPasswordStrength(newPassword)
    const target = await this.repo.findOne({ where: { _id: userId } })
    if (!target) {
      throw new BusinessException(ErrorEnum.RESOURCE_NOT_FOUND)
    }

    await this.repo.update(
      { _id: userId },
      {
        passwordHash: this.cryptoService.hashPassword(newPassword),
        failedAttempts: 0,
        lockedUntil: null,
      },
    )

    await this.auditService.record({
      actorId: operator.id,
      actorName: operator.username,
      action: 'admin.reset_password',
      targetType: 'admin_user',
      targetId: userId,
      summary: `重置 ${target.username} 的密码`,
    })
  }
}

function assertPasswordStrength(password: string): void {
  const longEnough = password.length >= 12
  const hasLower = /[a-z]/.test(password)
  const hasUpper = /[A-Z]/.test(password)
  const hasDigit = /\d/.test(password)
  if (!longEnough || !hasLower || !hasUpper || !hasDigit) {
    throw new BusinessException(ErrorEnum.WEAK_PASSWORD)
  }
}

/** 支持 8h / 30m / 3600 这类写法，返回秒 */
function parseDuration(input: string): number {
  const match = /^(\d+)([smhd])?$/.exec(input?.trim() ?? '')
  if (!match) return 8 * 3600
  const value = Number(match[1])
  switch (match[2]) {
    case 's':
      return value
    case 'm':
      return value * 60
    case 'h':
      return value * 3600
    case 'd':
      return value * 86400
    default:
      return value
  }
}
