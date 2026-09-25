import { describe, expect, it } from 'vitest'
import { generatePlan } from '../src/lib/engine'
import { computeFairness, planMetrics } from '../src/lib/fairness'
import { deriveSeeds, judgeWinner, rankCandidates, runSweep, SweepToken, type SweepCandidate } from '../src/lib/sweep'
import { makeClass } from './helpers'

function mkCandidate(partial: Partial<SweepCandidate> & { seed: number; metrics: SweepCandidate['metrics'] }): SweepCandidate {
  return {
    index: 0,
    assignments: [],
    feasible: partial.metrics.hardViolations === 0,
    durationMs: 1,
    ...partial,
  }
}

describe('planMetrics：与 computeFairness 同口径', () => {
  it('四项汇总指标完全一致', () => {
    const cls = makeClass({ rows: 5, cols: 8, weeks: 12, seed: 7 })
    const assignments = generatePlan(cls)
    cls.assignments = assignments
    const m = planMetrics(cls, assignments)
    const rep = computeFairness(cls)
    expect(m.hardViolations).toBe(rep.hardViolations.length)
    expect(m.frontRowsRange).toBe(rep.frontRowsRange)
    expect(m.variance).toBeCloseTo(rep.variance, 8)
    expect(m.deskOverLimit).toBe(rep.deskmateOverLimit.length)
    expect(m.heightViolations).toBe(rep.heightViolations)
  })

  it('硬约束违反能被计数（手工塞入违反）', () => {
    const cls = makeClass({ rows: 3, cols: 4, weeks: 4, seed: 3, frontRows: 1 })
    cls.assignments = generatePlan(cls)
    // 把一个需前排学生手工换到后排
    cls.students[0].vision = 'front_required'
    const m = planMetrics(cls, cls.assignments)
    expect(m.hardViolations).toBeGreaterThan(0)
  })
})

describe('deriveSeeds：确定性', () => {
  it('同基准种子派生相同序列，且套数不同时前缀一致', () => {
    expect(deriveSeeds(42, 8)).toEqual(deriveSeeds(42, 8))
    const a = deriveSeeds(42, 8)
    const b = deriveSeeds(42, 5)
    expect(a.slice(0, 5)).toEqual(b)
  })
  it('套数内互不相同，不同基准种子不同', () => {
    const s = deriveSeeds(123, 8)
    expect(new Set(s).size).toBe(8)
    expect(deriveSeeds(123, 8)).not.toEqual(deriveSeeds(124, 8))
  })
})

describe('rankCandidates：综合排序', () => {
  it('可行方案排在有硬违反/失败之前', () => {
    const good = mkCandidate({ seed: 1, index: 0, metrics: { weeks: 4, hardViolations: 0, frontRowsRange: 2, variance: 10, std: 1, deskOverLimit: 0, deskmateOverLimit: [], heightViolations: 0 } })
    const hard = mkCandidate({ seed: 2, index: 1, metrics: { weeks: 4, hardViolations: 3, frontRowsRange: 0, variance: 0, std: 0, deskOverLimit: 0, deskmateOverLimit: [], heightViolations: 0 } })
    const fail = mkCandidate({ seed: 3, index: 2, assignments: [], feasible: false, error: '不可行', metrics: { weeks: 0, hardViolations: 0, frontRowsRange: 0, variance: 0, std: 0, deskOverLimit: 0, deskmateOverLimit: [], heightViolations: 0 } })
    const ranked = rankCandidates([fail, hard, good])
    expect(ranked.map((c) => c.seed)).toEqual([1, 2, 3])
  })

  it('软指标归一化等权：单项极好但其余差的方案不一定第一', () => {
    const bal = mkCandidate({ seed: 1, metrics: { weeks: 4, hardViolations: 0, frontRowsRange: 1, variance: 10, std: 1, deskOverLimit: 1, deskmateOverLimit: [], heightViolations: 0 } })
    const extreme = mkCandidate({ seed: 2, metrics: { weeks: 4, hardViolations: 0, frontRowsRange: 0, variance: 30, std: 1, deskOverLimit: 4, deskmateOverLimit: [], heightViolations: 0 } })
    const ranked = rankCandidates([extreme, bal])
    // bal 归一化分 = (1/1 + 0/20 + 1/4)/3 = 0.417；extreme = (0 + 1 + 1)/3 = 0.667
    expect(ranked[0].seed).toBe(1)
  })

  it('排序稳定可复现（完全相同指标按种子）', () => {
    const mk = (seed: number) =>
      mkCandidate({ seed, metrics: { weeks: 4, hardViolations: 0, frontRowsRange: 2, variance: 10, std: 1, deskOverLimit: 1, deskmateOverLimit: [], heightViolations: 0 } })
    const ranked = rankCandidates([mk(9), mk(3), mk(5)])
    expect(ranked.map((c) => c.seed)).toEqual([3, 5, 9])
  })
})

describe('judgeWinner：好在哪 / 差在哪', () => {
  const m = (frontRowsRange: number, variance: number, deskOverLimit: number) =>
    ({ weeks: 4, hardViolations: 0, frontRowsRange, variance, std: 1, deskOverLimit, deskmateOverLimit: [], heightViolations: 0 }) as SweepCandidate['metrics']
  it('三项第一 → 无短板', () => {
    const best = mkCandidate({ seed: 1, metrics: m(0, 5, 0) })
    const other = mkCandidate({ seed: 2, metrics: m(2, 9, 1) })
    const ranked = rankCandidates([best, other])
    const v = judgeWinner(ranked[0], ranked)
    expect(v.tied).toHaveLength(3)
    expect(v.weakest).toBeNull()
  })
  it('有一项不是最优 → 指出最弱项与名次', () => {
    const best = mkCandidate({ seed: 1, metrics: m(0, 9, 0) }) // variance 排第 2
    const other = mkCandidate({ seed: 2, metrics: m(1, 5, 1) })
    const ranked = rankCandidates([best, other])
    const v = judgeWinner(ranked[0], ranked)
    expect(v.tied).toContain('frontRowsRange')
    expect(v.tied).toContain('deskOverLimit')
    expect(v.weakest?.key).toBe('variance')
    expect(v.weakest?.rank).toBe(2)
  })

  it('全部方案某项相同 → 标为 invariant（非 tied），且不产生「短板」', () => {
    const a = mkCandidate({ seed: 1, metrics: m(20, 2992, 0) })
    const b = mkCandidate({ seed: 2, metrics: m(20, 3010, 0) })
    const c = mkCandidate({ seed: 3, metrics: m(20, 3005, 0) })
    const ranked = rankCandidates([c, a, b])
    expect(ranked[0].seed).toBe(1) // variance 最小者第一
    const v = judgeWinner(ranked[0], ranked)
    expect(v.tied).toEqual(['variance'])
    expect(v.invariant.sort()).toEqual(['frontRowsRange', 'deskOverLimit'].sort())
    expect(v.weakest).toBeNull() // 唯一有差异的项它第一 → 无短板
  })

  it('并列第一时名次按「严格更优数」计（并列即第 1 名）', () => {
    const a = mkCandidate({ seed: 1, metrics: m(0, 5, 0) })
    const b = mkCandidate({ seed: 2, metrics: m(0, 5, 1) })
    const ranked = rankCandidates([a, b])
    const v = judgeWinner(ranked[0], ranked)
    // a 在 range/variance 与 b 并列最优：strictly-better = 0 → rank 1
    expect(v.weakest).toBeNull()
  })
})

describe('runSweep：端到端（真实引擎）', () => {
  it('跑 4 套全部成功，best 可行且与排序第一一致，指标与报告口径一致', async () => {
    const cls = makeClass({ rows: 4, cols: 6, weeks: 6, seed: 42 })
    const ticks: number[] = []
    const result = await runSweep(cls, 4, cls.seed, (p) => ticks.push(p.done))
    expect(result.status).toBe('done')
    expect(result.candidates).toHaveLength(4)
    expect(ticks).toEqual([0, 1, 2, 3, 4])
    expect(result.ranked).toHaveLength(4)
    expect(result.best).not.toBeNull()
    expect(result.best).toBe(result.ranked[0])
    for (const c of result.candidates) {
      expect(c.feasible).toBe(true)
      expect(c.metrics.hardViolations).toBe(0)
      expect(c.assignments).toHaveLength(6)
    }
    // 指标与 computeFairness 口径一致
    const c0 = result.candidates[0]
    const rep = computeFairness({ ...cls, assignments: c0.assignments })
    expect(c0.metrics.frontRowsRange).toBe(rep.frontRowsRange)
    expect(c0.metrics.variance).toBeCloseTo(rep.variance, 8)
  })

  it('可复现：再跑一遍，排序与种子完全一致', async () => {
    const cls = makeClass({ rows: 4, cols: 6, weeks: 4, seed: 77 })
    const r1 = await runSweep(cls, 5, cls.seed)
    const r2 = await runSweep(cls, 5, cls.seed)
    expect(r1.ranked.map((c) => c.seed)).toEqual(r2.ranked.map((c) => c.seed))
    expect(r1.best?.seed).toBe(r2.best?.seed)
  })

  it('token.cancel() 可中途停止，返回已完成部分', async () => {
    const cls = makeClass({ rows: 5, cols: 8, weeks: 20, seed: 42 })
    const token = new SweepToken()
    const seen: number[] = []
    const p = runSweep(
      cls,
      8,
      cls.seed,
      (prog) => {
        seen.push(prog.done)
        if (prog.done >= 2) token.cancel()
      },
      token,
    )
    const result = await p
    expect(result.status).toBe('cancelled')
    expect(result.candidates.length).toBeGreaterThanOrEqual(2)
    expect(result.candidates.length).toBeLessThan(8)
    // 停止后仍对已完成方案排序、给出 best
    expect(result.ranked).toHaveLength(result.candidates.length)
    expect(result.best).not.toBeNull()
  })

  it('count 被夹到 1..32', async () => {
    const cls = makeClass({ rows: 3, cols: 4, weeks: 2, seed: 1 })
    const r = await runSweep(cls, 0, cls.seed)
    expect(r.total).toBe(1)
    expect(r.candidates).toHaveLength(1)
  })
}, 60_000)
