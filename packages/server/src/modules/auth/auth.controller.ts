import { Body, Controller, Get, Ip, Param, Post, Put } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { AdminRole } from './admin-user.entity'
import { AuthService } from './auth.service'
import { AuthUser, CurrentUser, MinRole, Public } from './auth.decorator'
import { ChangePasswordDto, CreateAdminUserDto, LoginDto, LoginResultDto } from './auth.dto'

@ApiTags('管理员认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: '登录' })
  login(@Body() dto: LoginDto, @Ip() ip: string): Promise<LoginResultDto> {
    return this.authService.login(dto.username, dto.password, ip)
  }

  @Get('profile')
  @ApiOperation({ summary: '当前登录用户' })
  profile(@CurrentUser() user: AuthUser) {
    return this.authService.profile(user.id)
  }

  @Put('password')
  @ApiOperation({ summary: '修改自己的密码' })
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto)
  }

  @Get('users')
  @MinRole(AdminRole.OWNER)
  @ApiOperation({ summary: '账号列表' })
  listUsers() {
    return this.authService.listUsers()
  }

  @Post('users')
  @MinRole(AdminRole.OWNER)
  @ApiOperation({ summary: '创建账号' })
  createUser(@Body() dto: CreateAdminUserDto, @CurrentUser() user: AuthUser) {
    return this.authService.createUser(dto, user)
  }

  @Put('users/:id/status')
  @MinRole(AdminRole.OWNER)
  @ApiOperation({ summary: '启用/停用账号' })
  setStatus(
    @Param('id') id: string,
    @Body('status') status: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.authService.setStatus(id, Number(status), user)
  }

  @Put('users/:id/password')
  @MinRole(AdminRole.OWNER)
  @ApiOperation({ summary: '重置他人密码' })
  resetPassword(
    @Param('id') id: string,
    @Body('password') password: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.authService.resetPassword(id, password, user)
  }
}
