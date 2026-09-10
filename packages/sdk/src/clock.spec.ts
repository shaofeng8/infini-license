import { checkClock } from './clock'
import { DAY_MS } from './constants'

const NOW = Date.parse('2026-09-09T12:00:00Z')

describe('checkClock', () => {
  it('首次运行没有水位，以当前时间起算', () => {
    const result = checkClock(NOW, null)

    expect(result.rejected).toBe(false)
    expect(result.watermark.maxSeenTs).toBe(NOW)
    expect(result.watermark.rollbackCount).toBe(0)
  })

  it('时间正常前进时推进水位', () => {
    const result = checkClock(NOW, { maxSeenTs: NOW - DAY_MS, rollbackCount: 0 })

    expect(result.rejected).toBe(false)
    expect(result.watermark.maxSeenTs).toBe(NOW)
  })

  it('1 小时内的回退忽略，水位保持在更大的那个值', () => {
    const result = checkClock(NOW, { maxSeenTs: NOW + 1800_000, rollbackCount: 0 })

    expect(result.rejected).toBe(false)
    expect(result.rolledBack).toBe(false)
    expect(result.watermark.maxSeenTs).toBe(NOW + 1800_000)
  })

  it('单次回退超过 7 天直接判死，不给累计机会', () => {
    const result = checkClock(NOW, { maxSeenTs: NOW + 8 * DAY_MS, rollbackCount: 0 })

    expect(result.rejected).toBe(true)
    expect(result.rolledBack).toBe(true)
    expect(result.rollbackMs).toBe(8 * DAY_MS)
  })

  it('中等幅度回退累计到 3 次才判死', () => {
    const first = checkClock(NOW, { maxSeenTs: NOW + 2 * DAY_MS, rollbackCount: 0 })
    expect(first.rejected).toBe(false)
    expect(first.watermark.rollbackCount).toBe(1)

    const second = checkClock(NOW, { maxSeenTs: NOW + 2 * DAY_MS, rollbackCount: 1 })
    expect(second.rejected).toBe(false)
    expect(second.watermark.rollbackCount).toBe(2)

    const third = checkClock(NOW, { maxSeenTs: NOW + 2 * DAY_MS, rollbackCount: 2 })
    expect(third.rejected).toBe(true)
  })

  it('回拨时水位不下调 —— 跟着调低就等于接受了篡改', () => {
    const result = checkClock(NOW, { maxSeenTs: NOW + 2 * DAY_MS, rollbackCount: 0 })

    expect(result.watermark.maxSeenTs).toBe(NOW + 2 * DAY_MS)
  })

  it('24 小时不复发则回拨计数清零', () => {
    const result = checkClock(NOW, {
      maxSeenTs: NOW - DAY_MS,
      rollbackCount: 2,
      lastRollbackAt: NOW - 2 * DAY_MS,
    })

    expect(result.watermark.rollbackCount).toBe(0)
    expect(result.watermark.lastRollbackAt).toBeUndefined()
  })

  it('未到衰减周期时计数保留', () => {
    const result = checkClock(NOW, {
      maxSeenTs: NOW - 1000,
      rollbackCount: 2,
      lastRollbackAt: NOW - 3600_000,
    })

    expect(result.watermark.rollbackCount).toBe(2)
  })

  it('前跳超过 30 天时水位完全不推进', () => {
    // 模拟主板电池耗尽：系统时间跳到 70 年后
    const wild = NOW + 70 * 365 * DAY_MS
    const result = checkClock(wild, { maxSeenTs: NOW, rollbackCount: 0 })

    expect(result.rejected).toBe(false)
    expect(result.advanceClamped).toBe(true)
    expect(result.watermark.maxSeenTs).toBe(NOW)
  })

  it('前跳后时间恢复正常，不判回拨也不锁人 —— 硬件时钟故障必须能自愈', () => {
    const wild = NOW + 70 * 365 * DAY_MS
    const clamped = checkClock(wild, { maxSeenTs: NOW, rollbackCount: 0 })
    const recovered = checkClock(NOW, clamped.watermark)

    expect(recovered.rejected).toBe(false)
    expect(recovered.rolledBack).toBe(false)
    expect(recovered.watermark.rollbackCount).toBe(0)
  })

  it('前跳限幅时回拨计数按衰减规则处理，不额外惩罚', () => {
    const wild = NOW + 60 * DAY_MS
    const result = checkClock(wild, {
      maxSeenTs: NOW,
      rollbackCount: 2,
      lastRollbackAt: NOW - 1000,
    })

    expect(result.advanceClamped).toBe(true)
    // 按本地时钟看已过去 60 天，超过衰减周期，计数清零。
    // 衰减依赖的时间本身是攻击者可控的，这是时间衰减机制的固有局限，
    // 不构成额外风险：真正的防线是水位不下调与 7 天硬阈值。
    expect(result.watermark.rollbackCount).toBe(0)
  })

  it('前跳正好 30 天时正常采纳，不触发限幅', () => {
    const result = checkClock(NOW + 30 * DAY_MS, { maxSeenTs: NOW, rollbackCount: 0 })

    expect(result.advanceClamped).toBe(false)
    expect(result.watermark.maxSeenTs).toBe(NOW + 30 * DAY_MS)
  })

  it('容忍窗口可由凭证 policy 覆盖', () => {
    const strict = checkClock(NOW, { maxSeenTs: NOW + 600_000, rollbackCount: 0 }, {
      skewTolSec: 60,
    })

    expect(strict.rolledBack).toBe(true)
  })
})

/**
 * P8 时钟篡改演练抓到的缺陷：前跳幅度落在容忍窗口与 30 天限幅之间时，水位被
 * 推上去却无法退回。运维把时钟修正回来的那一刻客户全员被锁死，且要一直锁到
 * 真实时间追上被毒化的水位（实测 21 天）。
 */
describe('checkClock · 前跳可撤销', () => {
  it('可疑幅度的前跳会留下跳跃前的水位', () => {
    const result = checkClock(NOW + 20 * DAY_MS, { maxSeenTs: NOW, rollbackCount: 0 })

    expect(result.watermark.maxSeenTs).toBe(NOW + 20 * DAY_MS)
    expect(result.watermark.jumpBaseTs).toBe(NOW)
  })

  it('容忍窗口内的正常前进不留退票 —— 否则每一步都在攒撤销权限', () => {
    const result = checkClock(NOW + 60_000, { maxSeenTs: NOW, rollbackCount: 0 })

    expect(result.watermark.jumpBaseTs).toBeUndefined()
  })

  it('时钟被修正回跳跃前，放行且水位降回来', () => {
    const jumped = checkClock(NOW + 20 * DAY_MS, { maxSeenTs: NOW, rollbackCount: 0 })
    const fixed = checkClock(NOW, jumped.watermark)

    expect(fixed.rejected).toBe(false)
    expect(fixed.rolledBack).toBe(false)
    expect(fixed.clockCorrected).toBe(true)
    // 水位必须一并降下来，否则下一次检查照样判成 20 天回拨
    expect(fixed.watermark.maxSeenTs).toBe(NOW)
    // 退票用掉即作废
    expect(fixed.watermark.jumpBaseTs).toBeUndefined()
  })

  it('修正之后继续跑不再被判回拨 —— 这才是「锁 21 天」被真正解掉', () => {
    const jumped = checkClock(NOW + 20 * DAY_MS, { maxSeenTs: NOW, rollbackCount: 0 })
    const fixed = checkClock(NOW, jumped.watermark)
    const next = checkClock(NOW + 60_000, fixed.watermark)

    expect(next.rejected).toBe(false)
    expect(next.rolledBack).toBe(false)
  })

  it('连着前跳两次也能退回最初那个可信点', () => {
    const first = checkClock(NOW + 10 * DAY_MS, { maxSeenTs: NOW, rollbackCount: 0 })
    const second = checkClock(NOW + 25 * DAY_MS, first.watermark)

    expect(second.watermark.jumpBaseTs).toBe(NOW)
    expect(checkClock(NOW, second.watermark).clockCorrected).toBe(true)
  })

  it('退得比跳跃前的水位还低，仍然按篡改处理', () => {
    const jumped = checkClock(NOW + 20 * DAY_MS, { maxSeenTs: NOW, rollbackCount: 0 })
    const tampered = checkClock(NOW - 30 * DAY_MS, jumped.watermark)

    expect(tampered.rejected).toBe(true)
    expect(tampered.rolledBack).toBe(true)
    expect(tampered.clockCorrected).toBe(false)
    // 退票不作废：之后若退到基点上方，仍应认作修正
    expect(tampered.watermark.jumpBaseTs).toBe(NOW)
  })

  it('没有前跳记录时，回拨照旧判死 —— 撤销机制不能变成万能借口', () => {
    const result = checkClock(NOW, { maxSeenTs: NOW + 20 * DAY_MS, rollbackCount: 0 })

    expect(result.rejected).toBe(true)
    expect(result.clockCorrected).toBe(false)
  })

  it('前跳超过 30 天时不留退票 —— 水位本来就没动，没有可撤销的东西', () => {
    const result = checkClock(NOW + 70 * 365 * DAY_MS, { maxSeenTs: NOW, rollbackCount: 0 })

    expect(result.advanceClamped).toBe(true)
    expect(result.watermark.jumpBaseTs).toBeUndefined()
  })
})
