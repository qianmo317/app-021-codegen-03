import type { Assignment, ClassEntity } from '../types'
import { InfeasibleError } from '../types'
import { generatePlan } from './engine'
import { hashSeed } from './rng'
import { planMetrics, type PlanMetrics } from './fairness'

// ================= 多种子批量比选（同一班同一份配置，跑多套种子挑最优） =================
// 设计要点：
// - 确定性：第 k 个种子 = hashSeed(baseSeed, 0x57e7 + k)，同参数重复跑结果完全一致（含排序）。
// - 不阻塞 UI：每个种子跑完之间让出宏任务，进度回调 + 可中途取消（取消在种子之间生效）。
// - 排序口径：硬约束违反数优先（必须为 0）；可行方案之间对三项软指标做跨方案 min-max 归一化，
//   等权合成综合分（0 最好），相同则按原始指标字典序兜底，保证排序稳定可复现。

export interface SweepCandidate {
  index: number // 第几个（从 0 开始，完成顺序）
  seed: number
  assignments: Assignment[]
  metrics: PlanMetrics
  feasible: boolean // 生成成功且硬约束违反 = 0
  error?: string
  durationMs: number
}

export interface SweepProgress {
  done: number
  total: number
  currentSeed: number
  candidates: SweepCandidate[] // 已完成（按完成顺序）
  elapsedMs: number
  avgMs: number // 每套平均耗时
  etaMs: number // 预计剩余毫秒
}

export type SweepStatus = 'done' | 'cancelled'

export interface SweepResult {
  baseSeed: number
  total: number
  status: SweepStatus
  candidates: SweepCandidate[] // 已完成（按完成顺序）
  ranked: SweepCandidate[] // 综合排序（最优在前；失败的排最后）
  best: SweepCandidate | null
  elapsedMs: number
}

// 取消信号：cancel() 后，下一个种子开始前被观察到即停止
export class SweepToken {
  cancelled = false
  cancel(): void {
    this.cancelled = true
  }
}

/** 由基准种子确定性派生 count 个互不相同的种子（同参数可复现） */
export function deriveSeeds(baseSeed: number, count: number): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (let k = 0; out.length < count; k++) {
    const s = hashSeed(baseSeed | 0, 0x57e7, k)
    if (!seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * 一次跑多套种子。
 * @param onProgress 每完成一套回调一次（首套开始前也回调一次，便于 UI 立即显示进度条）
 */
export async function runSweep(
  cls: ClassEntity,
  count: number,
  baseSeed: number,
  onProgress?: (p: SweepProgress) => void,
  token?: SweepToken,
): Promise<SweepResult> {
  const total = Math.max(1, Math.min(32, Math.floor(count) || 1))
  const seeds = deriveSeeds(baseSeed, total)
  const candidates: SweepCandidate[] = []
  const start = Date.now()
  onProgress?.({
    done: 0,
    total,
    currentSeed: seeds[0],
    candidates,
    elapsedMs: 0,
    avgMs: 0,
    etaMs: 0,
  })
  // 先让出一帧，确保 UI 能画出「0/total」进度条后再开始第一套（否则首套同步计算期间无进度）
  await nextTick()

  let status: SweepStatus = 'done'
  for (let i = 0; i < total; i++) {
    if (token?.cancelled) {
      status = 'cancelled'
      break
    }
    const seed = seeds[i]
    const t0 = Date.now()
    let candidate: SweepCandidate
    try {
      const assignments = generatePlan(cls, { seed })
      const metrics = planMetrics(cls, assignments)
      candidate = {
        index: i,
        seed,
        assignments,
        metrics,
        feasible: metrics.hardViolations === 0,
        durationMs: Date.now() - t0,
      }
    } catch (e) {
      candidate = {
        index: i,
        seed,
        assignments: [],
        metrics: emptyMetrics(),
        feasible: false,
        error: e instanceof InfeasibleError ? e.message : e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - t0,
      }
    }
    candidates.push(candidate)
    const elapsedMs = Date.now() - start
    const avgMs = elapsedMs / candidates.length
    onProgress?.({
      done: candidates.length,
      total,
      currentSeed: seeds[Math.min(i + 1, total - 1)],
      candidates: [...candidates],
      elapsedMs,
      avgMs,
      etaMs: Math.round(avgMs * (total - candidates.length)),
    })
    if (i < total - 1) await nextTick() // 让出主线程给 UI 渲染进度 / 响应停止
  }

  const ranked = rankCandidates(candidates)
  return {
    baseSeed,
    total,
    status,
    candidates,
    ranked,
    best: ranked.find((c) => c.feasible) ?? null,
    elapsedMs: Date.now() - start,
  }
}

function emptyMetrics(): PlanMetrics {
  return {
    weeks: 0,
    hardViolations: 0,
    frontRowsRange: 0,
    variance: 0,
    std: 0,
    deskOverLimit: 0,
    deskmateOverLimit: [],
    heightViolations: 0,
  }
}

/**
 * 综合排序：
 * 1) 可行（硬约束 0）且生成成功 → tier 0；有硬约束违反 → tier 1；生成失败 → tier 2
 * 2) tier 0 内三项软指标 min-max 归一化等权合成（0 最好）
 * 3) 完全相同 → 原始（极差、方差、超限对、种子）字典序兜底，保证确定性
 */
export function rankCandidates(candidates: SweepCandidate[]): SweepCandidate[] {
  const feasible = candidates.filter((c) => !c.error && c.feasible)
  const hardBad = candidates.filter((c) => !c.error && !c.feasible)
  const failed = candidates.filter((c) => !!c.error)

  const keys = ['frontRowsRange', 'variance', 'deskOverLimit'] as const
  const mins: Record<(typeof keys)[number], number> = { frontRowsRange: 0, variance: 0, deskOverLimit: 0 }
  const spans: Record<(typeof keys)[number], number> = { frontRowsRange: 1, variance: 1, deskOverLimit: 1 }
  for (const k of keys) {
    const vals = feasible.map((c) => c.metrics[k])
    const lo = vals.length ? Math.min(...vals) : 0
    const hi = vals.length ? Math.max(...vals) : 0
    mins[k] = lo
    spans[k] = hi > lo ? hi - lo : 1
  }

  const scoreOf = (c: SweepCandidate): number =>
    keys.reduce((sum, k) => sum + (c.metrics[k] - mins[k]) / spans[k], 0) / keys.length

  const cmpSoft = (a: SweepCandidate, b: SweepCandidate): number => {
    const ds = scoreOf(a) - scoreOf(b)
    if (Math.abs(ds) > 1e-12) return ds
    for (const k of keys) {
      if (a.metrics[k] !== b.metrics[k]) return a.metrics[k] - b.metrics[k]
    }
    return a.seed - b.seed
  }

  const cmpHard = (a: SweepCandidate, b: SweepCandidate): number => {
    if (a.metrics.hardViolations !== b.metrics.hardViolations)
      return a.metrics.hardViolations - b.metrics.hardViolations
    return cmpSoft(a, b)
  }

  return [
    ...[...feasible].sort(cmpSoft),
    ...[...hardBad].sort(cmpHard),
    ...[...failed].sort((a, b) => a.index - b.index),
  ]
}

// 单项软指标的取值器（UI 列头 / 判定最优项共用）
export const SOFT_METRICS = [
  { key: 'frontRowsRange', label: '前排次数极差' },
  { key: 'variance', label: '位置分偏差²' },
  { key: 'deskOverLimit', label: '同桌超次对数' },
] as const

export type SoftMetricKey = (typeof SOFT_METRICS)[number]['key']

// 最优方案的「好在哪 / 差在哪」结构化说明（UI 据此生成中文文案）
export interface WinnerVerdict {
  tied: SoftMetricKey[] // 该项取值为全场最优（含并列），且各方案之间有差异
  invariant: SoftMetricKey[] // 所有方案该项完全相同（种子无法改变，多为固定座位等结构约束）
  weakest: { key: SoftMetricKey; rank: number; total: number } | null // 相对最弱的一项
}

/**
 * 评判最优方案：
 * - 哪些项达到（并列）最优；哪些项各方案完全相同（种子不影响）；
 * - 相对最差的一项及名次（1 = 最好；名次 = 严格更优的方案数 + 1，并列不算更差）；全部并列最优时为 null。
 */
export function judgeWinner(best: SweepCandidate, ranked: SweepCandidate[]): WinnerVerdict {
  const feasible = ranked.filter((c) => !c.error && c.feasible)
  const tied: SoftMetricKey[] = []
  const invariant: SoftMetricKey[] = []
  let weakest: WinnerVerdict['weakest'] = null
  for (const { key } of SOFT_METRICS) {
    const vals = feasible.map((c) => c.metrics[key])
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    if (lo === hi) {
      invariant.push(key)
    } else if (best.metrics[key] === lo) {
      tied.push(key)
    }
    // 名次：严格比它好的方案数 + 1（并列第一即第 1 名）
    const better = feasible.reduce((acc, c) => acc + (c.metrics[key] < best.metrics[key] ? 1 : 0), 0)
    const rank = better + 1
    if (!weakest || rank > weakest.rank) weakest = { key, rank, total: feasible.length }
  }
  // 没有严格更优的方案（三项均并列第一）→ 没有短板
  if (weakest && weakest.rank <= 1) weakest = null
  return { tied, invariant, weakest }
}
