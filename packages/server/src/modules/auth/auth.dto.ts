import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { AdminRole } from './admin-user.entity'

export class LoginDto {
  @ApiProperty({ description: '用户名' })
  @IsString()
  @IsNotEmpty({ message: '请输入用户名' })
  @MaxLength(64)
  username: string

  @ApiProperty({ description: '密码' })
  @IsString()
  @IsNotEmpty({ message: '请输入密码' })
  @MaxLength(128)
  password: string
}

export class ChangePasswordDto {
  @ApiProperty({ description: '原密码' })
  @IsString()
  @IsNotEmpty()
  oldPassword: string

  @ApiProperty({ description: '新密码，至少 12 位且含大小写字母与数字' })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword: string
}

export class CreateAdminUserDto {
  @ApiProperty({ description: '用户名' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  username: string

  @ApiProperty({ description: '初始密码' })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password: string

  @ApiPropertyOptional({ description: '真实姓名' })
  @IsString()
  @IsOptional()
  @MaxLength(64)
  realName?: string

  @ApiProperty({ description: '角色', enum: AdminRole })
  @IsEnum(AdminRole)
  role: AdminRole
}

export class LoginResultDto {
  @ApiProperty({ description: '访问令牌' })
  accessToken: string

  @ApiProperty({ description: '有效期（秒）' })
  expiresIn: number

  @ApiProperty({ description: '当前用户信息' })
  user: {
    id: string
    username: string
    realName: string | null
    role: AdminRole
  }
}
