import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 列表数据加载。筛选条件变了就重新请求，并丢弃过期响应。
 *
 * **为什么不直接用 alova 的 `useRequest` + `useEffect`。** 那样写出来是
 * `useEffect(() => send(query), [query, send])`，而 `send` 在每次渲染都是新
 * 函数：effect 重跑 → 请求 → loading/data 变化触发重渲染 → 又是新的 `send`
 * → effect 再跑，无限循环。实测一进列表页就在无操作的情况下打出 200+ 个
 * 相同请求，直接撞穿后端 300 次/分钟的限流，页面开始弹「请求过于频繁」。
 * 把 `send` 从依赖里删掉能止住循环，但那是在跟 lint 规则打架、且下一个人
 * 加回去就复发，所以这里干脆不依赖任何 hook 返回的函数身份。
 *
 * 顺带修掉一个竞态：翻页快时先发的请求可能后到，把新一页的数据盖回旧的。
 * `cancelled` 标记保证只有最后一次请求的结果会被写进 state。
 *
 * @param key     查询条件的序列化结果，变了就重新请求
 * @param fetcher 实际发请求的函数，闭包捕获当前查询条件即可
 * @param initial 首次渲染用的空数据
 */
export function useListQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  initial: T,
) {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [reloadTick, setReloadTick] = useState(0)

  // 每次渲染都把最新的 fetcher 存进 ref，但不让它参与 effect 依赖。
  // effect 里读 ref.current 拿到的就是当前渲染的闭包，条件是最新的
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    fetcherRef.current()
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch(() => {
        // 错误提示已由 http 拦截器统一弹出，这里只需要不让 Promise 悬空。
        // 保留上一次的数据而不是清空：筛选出错时表格突然变空，
        // 会让人以为「真的没有符合条件的记录」
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [key, reloadTick])

  /** 手动重新拉取（刷新按钮、写操作成功后） */
  const refresh = useCallback(() => setReloadTick(tick => tick + 1), [])

  return { data, loading, refresh }
}
