import { SetMetadata } from '@nestjs/common'

export const BYPASS_KEY = 'license:bypass_transform'

/** 跳过统一响应包装，用于文件下载等需要裸响应的接口 */
export const Bypass = () => SetMetadata(BYPASS_KEY, true)
