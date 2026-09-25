import type { Assignment, ClassEntity } from '../types'
import { generatePlan } from './engine'
import { computeFairness } from './fairness'
import { hashSeed } from './rng'

// ================= 多种子试跑与优选 =================
// 同一份配置跑多套种子，按「硬约束违反数 → 前排极差 / 位置分偏差 / 同桌超次」综合排序。
// 运行器异步逐种子执行（种子之间让出事件循环），支持进度回调与中途停止。

export interface SeedMetrics {
  hardViolations: number // 硬约束违反数（0 为达标）
  frontRange: number // 前 N 排次数极差
  variance: number // 位置分 Σ偏差²
  deskOver: number // 同桌超 2 次的对数
}

export interface SeedCandidate {
  seed: number
  metrics: SeedMetrics | null // null = 该种子生成失败
  fairScore: number // 三项公平性指标的归一化均值（0~1，越小越好），由 rankCandidates 填入
  rank: number // 1 起；失败为 0，由 rankCandidates 填入
  assignments: Assignment[]
  ms: number // 该种子耗时
  error?: string
}

export interface SearchProgress {
  done: number
  total: number
  currentSeed: number | null
  elapsedMs: number
  etaMs: number | null // null = 样本不足，无法估计
}

/** 由基准种子确定性地派生 count 个互不相同的种子（同一基准 → 同一批种子，可复现） */
export function pickSeeds(baseSeed: number, count: number): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (let i = 0; out.length < count; i++) {
    const s = hashSeed(baseSeed, 7919 * (i + 1))
    if (!seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

/** 评估一套已生成方案的四项指标（复用公平性报告，口径与报告页一致） */
export function evaluateAssignments(cls: ClassEntity, assignments: Assignment[]): SeedMetrics {
  const rep = computeFairness({ ...cls, assignments })
  return {
    hardViolations: rep.hardViolations.length,
    frontRange: rep.frontRowsRange,
    variance: rep.variance,
    deskOver: rep.deskmateOverLimit.length,
  }
}

/**
 * 综合排序：硬约束违反数优先（少的在前），相同则比较三项公平性指标的
 * min-max 归一化均值（等权），再相同按种子号排序保证确定性。
 * 直接填入 fairScore / rank，返回排序后的新数组（失败方案排最后，rank = 0）。
 */
export function rankCandidates(cands: SeedCandidate[]): SeedCandidate[] {
  const ok = cands.filter((c) => c.metrics !== null)
  const norm = (key: 'frontRange' | 'variance' | 'deskOver', v: number): number => {
    const vals = ok.map((c) => c.metrics![key])
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    return max === min ? 0 : (v - min) / (max - min)
  }
  for (const c of ok) {
    const m = c.metrics!
    c.fairScore = (norm('frontRange', m.frontRange) + norm('variance', m.variance) + norm('deskOver', m.deskOver)) / 3
  }
  const sorted = [...cands].sort((a, b) => {
    const ma = a.metrics
    const mb = b.metrics
    if (ma && mb) {
      if (ma.hardViolations !== mb.hardViolations) return ma.hardViolations - mb.hardViolations
      if (a.fairScore !== b.fairScore) return a.fairScore - b.fairScore
      return a.seed - b.seed
    }
    if (ma) return -1
    if (mb) return 1
    return a.seed - b.seed
  })
  let r = 0
  for (const c of sorted) c.rank = c.metrics ? ++r : 0
  return sorted
}

export interface BestExplanation {
  strengths: string[] // 最优方案在哪些项上领先
  weakness: string | null // 相对短板（与最优值的归一化差距最大的一项）；null = 无短板
}

const METRIC_META = [
  { key: 'hardViolations', label: '硬约束违反', unit: ' 处', fmt: (v: number) => String(v) },
  { key: 'frontRange', label: '前排次数极差', unit: '', fmt: (v: number) => String(v) },
  { key: 'variance', label: '位置分 Σ偏差²', unit: '', fmt: (v: number) => v.toFixed(1) },
  { key: 'deskOver', label: '同桌超 2 次的对', unit: ' 对', fmt: (v: number) => String(v) },
] as const

/** 解释排名第一的方案：好在哪里（领先项）、差在哪一项（相对短板） */
export function explainBest(ranked: SeedCandidate[]): BestExplanation | null {
  const ok = ranked.filter((c) => c.metrics !== null)
  if (ok.length === 0) return null
  const bm = ok[0].metrics!
  const strengths: string[] = []
  let worstDeficit = 0
  let weakness: string | null = null
  for (const meta of METRIC_META) {
    const vals = ok.map((c) => c.metrics![meta.key])
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const v = bm[meta.key]
    if (v === min && max > min) strengths.push(`${meta.label}最小（${meta.fmt(v)}${meta.unit}）`)
    if (v > min && max > min) {
      const deficit = (v - min) / (max - min)
      if (deficit > worstDeficit) {
        worstDeficit = deficit
        weakness = `相对短板：${meta.label} ${meta.fmt(v)}${meta.unit}（本批最优为 ${meta.fmt(min)}${meta.unit}）`
      }
    }
  }
  if (bm.hardViolations === 0 && !strengths.some((s) => s.includes('硬约束'))) {
    strengths.unshift('硬约束全部满足（0 违反）')
  }
  if (strengths.length === 0 && !weakness) strengths.push('四项指标与本批其他方案持平')
  return { strengths, weakness }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * 逐种子试跑整个计划并评估。每个种子完成后回调一次进度（含 ETA），
 * shouldStop 返回 true 时在下一个种子前停止（返回已完成的部分结果）。
 */
export async function runSeedSearch(
  cls: ClassEntity,
  count: number,
  baseSeed: number,
  onProgress?: (p: SearchProgress, ranked: SeedCandidate[]) => void,
  shouldStop?: () => boolean,
): Promise<SeedCandidate[]> {
  const seeds = pickSeeds(baseSeed, count)
  const out: SeedCandidate[] = []
  const t0 = Date.now()
  const report = (currentSeed: number | null): void => {
    const elapsedMs = Date.now() - t0
    const etaMs = out.length > 0 && out.length < seeds.length ? (elapsedMs / out.length) * (seeds.length - out.length) : null
    onProgress?.(
      { done: out.length, total: seeds.length, currentSeed, elapsedMs, etaMs },
      rankCandidates(out),
    )
  }
  for (const seed of seeds) {
    if (shouldStop?.()) break
    report(seed)
    const t1 = Date.now()
    try {
      const assignments = generatePlan(cls, { seed })
      const metrics = evaluateAssignments(cls, assignments)
      out.push({ seed, metrics, fairScore: 0, rank: 0, assignments, ms: Date.now() - t1 })
    } catch (e) {
      out.push({
        seed,
        metrics: null,
        fairScore: Infinity,
        rank: 0,
        assignments: [],
        ms: Date.now() - t1,
        error: e instanceof Error ? e.message : String(e),
      })
    }
    await tick()
  }
  report(null)
  return rankCandidates(out)
}
