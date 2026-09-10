import {
  DAY_MS,
  DEFAULT_CLOCK_SKEW_TOL_SEC,
  HARD_ROLLBACK_DAYS,
  MAX_ROLLBACK_COUNT,
  MAX_WATERMARK_ADVANCE_DAYS,
  ROLLBACK_DECAY_MS,
} from './constants'
import { ClockWatermark } from './types'

export interface ClockCheckResult {
  /** 是否判定为时钟异常，需要阻断 */
  rejected: boolean
  /** 更新后的水位，调用方负责持久化 */
  watermark: ClockWatermark
  /** 本次是否检测到回拨 */
  rolledBack: boolean
  /** 回拨幅度（毫秒），未回拨时为 0 */
  rollbackMs: number
  /** 水位是否因前跳过大而被拒绝推进 */
  advanceClamped: boolean
  /** 本次回退是否被判定为「在撤销此前的一次前跳」，即时钟正被修正回来 */
  clockCorrected: boolean
}

export interface ClockCheckOptions {
  skewTolSec?: number
}

/**
 * 时钟回拨检测。纯函数：不读系统时间、不落盘，水位的持久化由调用方负责。
 *
 * 离线授权的唯一时间依据是本地时钟，把时钟往回调就能无限延长授权。防线是
 * 一个单调水位：记住见过的最大时间戳，比它小得离谱就说明有人动了时钟。
 *
 * 三个阈值都是在「防绕过」和「别误伤」之间取的折中：
 * - 1 小时内的回退忽略，NTP 校时、虚拟机挂起恢复都在这个量级
 * - 单次回退超过 7 天直接判死，这个幅度不可能是校时
 * - 中等幅度的回退累计 3 次才判死，且 24 小时不复发就清零
 *
 * **前跳是可撤销的**，靠 `jumpBaseTs` 这张退票，见下方 §前跳与撤销。这一条是
 * P8 时钟篡改演练之后加的：在那之前，一次 20 天的前跳（BIOS 电池、NTP 配错、
 * 快照恢复）会把水位毒化，运维把时钟修正回来的那一刻客户全员被锁死，而且要
 * 一直锁到真实时间追上被毒化的水位 —— 实测锁 21 天，期间无法自愈。
 */
export function checkClock(
  now: number,
  previous: ClockWatermark | null | undefined,
  options: ClockCheckOptions = {},
): ClockCheckResult {
  const skewTolMs = (options.skewTolSec ?? DEFAULT_CLOCK_SKEW_TOL_SEC) * 1000

  if (!previous) {
    // 首次运行没有水位可比，直接以当前时间起算
    return {
      rejected: false,
      watermark: { maxSeenTs: now, rollbackCount: 0 },
      rolledBack: false,
      rollbackMs: 0,
      advanceClamped: false,
      clockCorrected: false,
    }
  }

  const drift = previous.maxSeenTs - now

  // -- 时间前进（或在容忍窗口内后退） ---------------------------------------
  if (drift <= skewTolMs) {
    const decayed = shouldDecay(now, previous) ? 0 : previous.rollbackCount
    const advance = now - previous.maxSeenTs
    const maxAdvance = MAX_WATERMARK_ADVANCE_DAYS * DAY_MS

    if (advance > maxAdvance) {
      // 前跳过大，水位**完全不推进**（而不是推进上限值）。
      //
      // 只推进 30 天仍然会毒化水位：时间修回来时会被判成 30 天回拨，
      // 客户照样被锁，只是从永久变成一个月。彻底不推进才能让时钟恢复后
      // 自动回到正常状态。
      //
      // 不推进不会被利用：把时钟往前调只会让授权提前到期，攻击者拿不到
      // 任何好处，所以这里可以放心地选择「宁可不设防，也不要误锁」。
      return {
        rejected: false,
        watermark: {
          maxSeenTs: previous.maxSeenTs,
          rollbackCount: decayed,
          lastRollbackAt: previous.lastRollbackAt,
          jumpBaseTs: previous.jumpBaseTs,
        },
        rolledBack: false,
        rollbackMs: 0,
        advanceClamped: true,
        clockCorrected: false,
      }
    }

    return {
      rejected: false,
      watermark: {
        maxSeenTs: Math.max(previous.maxSeenTs, now),
        rollbackCount: decayed,
        lastRollbackAt: decayed === 0 ? undefined : previous.lastRollbackAt,
        // 幅度可疑（超出容忍窗口）的前跳会把水位推上去，所以必须同时留一张
        // 退票：记住跳跃前的水位。只记最早那一个，后续前跳不覆盖 —— 要撤销
        // 就得能退到最初那个可信点，否则连着跳两次就退不回去了。
        jumpBaseTs:
          advance > skewTolMs ? previous.jumpBaseTs ?? previous.maxSeenTs : previous.jumpBaseTs,
      },
      rolledBack: false,
      rollbackMs: 0,
      advanceClamped: false,
      clockCorrected: false,
    }
  }

  // -- 前跳与撤销 -----------------------------------------------------------
  //
  // 先看这次后退是不是在撤销此前的一次前跳。落在跳跃前的水位之上，就说明时钟
  // 正被修正回来 —— 接受它，并把水位一并降回去，否则毒化的水位还在，下一次
  // 检查照样判回拨。
  //
  // 这张退票不设有效期，只在被使用时清除。看着宽松，但它给不出攻击者拿不到的
  // 东西：能退到的最远处是他自己前跳之前那个已经合法到达过的时刻，而要拿到这
  // 张票，得先把时钟往前拨 —— 那只会让授权提前到期。
  //
  // 更根本的理由是：绕过时钟防护的强度上限已经不由这里决定。**把时钟冻结住**
  // 就能无限延长授权，而单调水位只能发现「往回走」、发现不了「不走」，这一条
  // 我们明确不防（见 docs/02-license-model.md §9 安全边界表）。既然一行
  // `timedatectl set-ntp false` 就能绕过，为了防一个更麻烦的绕过路径而给退票
  // 加上有效期、再换回一个会锁死客户的误伤面，是净亏。
  if (previous.jumpBaseTs !== undefined && now >= previous.jumpBaseTs - skewTolMs) {
    return {
      rejected: false,
      watermark: {
        maxSeenTs: now,
        rollbackCount: previous.rollbackCount,
        lastRollbackAt: previous.lastRollbackAt,
        jumpBaseTs: undefined,
      },
      rolledBack: false,
      rollbackMs: 0,
      advanceClamped: false,
      clockCorrected: true,
    }
  }

  // -- 检测到回拨 -----------------------------------------------------------
  const hardRollback = drift > HARD_ROLLBACK_DAYS * DAY_MS
  const count = previous.rollbackCount + 1

  return {
    rejected: hardRollback || count >= MAX_ROLLBACK_COUNT,
    // 回拨时水位保持不动，否则把水位跟着调低就等于接受了篡改
    watermark: {
      maxSeenTs: previous.maxSeenTs,
      rollbackCount: count,
      lastRollbackAt: now,
      // 退票留着：这次退得比跳跃前的水位还低，不算撤销，但之后若再退到那个
      // 可信点上方，仍然应该被认作修正
      jumpBaseTs: previous.jumpBaseTs,
    },
    rolledBack: true,
    rollbackMs: drift,
    advanceClamped: false,
    clockCorrected: false,
  }
}

function shouldDecay(now: number, previous: ClockWatermark): boolean {
  if (previous.rollbackCount === 0) return false
  if (previous.lastRollbackAt === undefined) return false
  return now - previous.lastRollbackAt >= ROLLBACK_DECAY_MS
}
