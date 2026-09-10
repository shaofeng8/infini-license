import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

type Primitive = string | number | undefined

/**
 * 把列表页的筛选条件与分页存在 URL query 里。
 *
 * 设计文档要求持久化到 URL 而不是 localStorage（infini-proxy 用的是后者）。
 * 差别在这套后台的实际用法上很关键：运营查到一条有问题的授权，需要把链接
 * 贴到群里让同事直接看到**同样的筛选结果**；存 localStorage 的话对方打开
 * 看到的是他自己上次的筛选，而且两人都以为在看同一个东西。
 *
 * 顺带解决浏览器后退：从详情页返回时筛选条件还在。
 */
export function useQueryState<T extends Record<string, Primitive>>(
  defaults: T,
) {
  const [searchParams, setSearchParams] = useSearchParams()

  const state = useMemo(() => {
    const result = { ...defaults }
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const raw = searchParams.get(String(key))
      if (raw === null || raw === '') continue
      // 用默认值的类型决定怎么解析：page/pageSize 是数字，其余是字符串。
      // 不这样做的话 page 会变成 "2" 参与算术，翻页算出 "21"
      result[key] =
        typeof defaults[key] === 'number'
          ? (Number(raw) as T[keyof T])
          : (raw as T[keyof T])
    }
    return result
  }, [searchParams, defaults])

  const setState = useCallback(
    (patch: Partial<T>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [key, value] of Object.entries(patch)) {
            // 与默认值相同或为空时把参数删掉，URL 上只留真正改过的条件，
            // 否则分享出去的链接会挂满 page=1&pageSize=20&keyword= 这种噪音
            if (
              value === undefined ||
              value === '' ||
              value === defaults[key as keyof T]
            ) {
              next.delete(key)
            } else {
              next.set(key, String(value))
            }
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams, defaults],
  )

  /** 改筛选条件时把页码拉回第一页，否则会停在一个超出总页数的空页上 */
  const setFilter = useCallback(
    (patch: Partial<T>) => setState({ ...patch, page: 1 } as Partial<T>),
    [setState],
  )

  const reset = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true })
  }, [setSearchParams])

  return { state, setState, setFilter, reset }
}
