import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { Injectable } from '@nestjs/common'

/** 时间戳容忍窗口。客户环境时钟未必准，但 5 分钟足够宽松 */
export const TIMESTAMP_SKEW_TOL_SEC = 300

export interface SignedRequestParts {
  method: string
  /** 含 globalPrefix 的完整路径，不含 query */
  path: string
  timestampSec: number
  nonce: string
  rawBody: string
}

@Injectable()
export class HmacService {
  /**
   * 拼签名串。
   *
   * **这是 packages/sdk/src/trial/signer.ts 的镜像实现，两边必须逐字节一致。**
   * 故意不共享代码：SDK 要以源码形式内嵌进客户侧项目，不能依赖服务端。改动
   * 签名格式时两个文件一起改，并同时跑两侧单测。
   */
  buildSigningString(parts: SignedRequestParts): string {
    return [
      parts.method.toUpperCase(),
      parts.path,
      String(parts.timestampSec),
      parts.nonce,
      createHash('sha256').update(parts.rawBody, 'utf8').digest('hex'),
    ].join('\n')
  }

  sign(parts: SignedRequestParts, secret: string): string {
    return createHmac('sha256', secret)
      .update(this.buildSigningString(parts), 'utf8')
      .digest('base64')
  }

  /** 恒定时间比对，避免通过响应耗时逐字节猜签名 */
  verify(parts: SignedRequestParts, secret: string, provided: string): boolean {
    const expected = this.sign(parts, secret)
    const expectedBuf = Buffer.from(expected, 'utf8')
    const providedBuf = Buffer.from(provided ?? '', 'utf8')

    // timingSafeEqual 要求等长，长度本身不是秘密
    if (expectedBuf.length !== providedBuf.length) return false
    return timingSafeEqual(expectedBuf, providedBuf)
  }

  /** 时间戳是否落在容忍窗口内。双向都要卡，未来的时间戳同样可疑 */
  isTimestampFresh(timestampSec: number, nowMs = Date.now()): boolean {
    if (!Number.isFinite(timestampSec)) return false
    return Math.abs(nowMs / 1000 - timestampSec) <= TIMESTAMP_SKEW_TOL_SEC
  }
}
