import { describe, expect, it } from 'vitest'
import { generatePlan } from '../src/lib/engine'
import { computeFairness } from '../src/lib/fairness'
import {
  evaluateAssignments,
  explainBest,
  pickSeeds,
  rankCandidates,
  runSeedSearch,
  type SeedCandidate,
} from '../src/lib/seedSearch'
import { makeClass } from './helpers'

function cand(
  seed: number,
  m: { hard: number; front: number; variance: number; desk: number } | null,
): SeedCandidate {
  return {
    seed,
    metrics: m ? { hardViolations: m.hard, frontRange: m.front, variance: m.variance, deskOver: m.desk } : null,
    fairScore: 0,
    rank: 0,
    assignments: [],
    ms: 1,
  }
}

describe('多种子优选：种子派生', () => {
  it('同一基准种子派生出相同且互不相同的种子序列', () => {
    const a = pickSeeds(123, 8)
    const b = pickSeeds(123, 8)
    expect(a).toEqual(b)
    expect(a).toHaveLength(8)
    expect(new Set(a).size).toBe(8)
    const c = pickSeeds(456, 8)
    expect(c).not.toEqual(a)
  })
})

describe('多种子优选：指标评估', () => {
  it('evaluateAssignments 与公平性报告口径一致', () => {
    const cls = makeClass({ rows: 4, cols: 6, weeks: 6 })
    const assignments = generatePlan(cls)
    const m = evaluateAssignments(cls, assignments)
    const rep = computeFairness({ ...cls, assignments })
    expect(m.hardViolations).toBe(rep.hardViolations.length)
    expect(m.frontRange).toBe(rep.frontRowsRange)
    expect(m.variance).toBe(rep.variance)
    expect(m.deskOver).toBe(rep.deskmateOverLimit.length)
    expect(m.hardViolations).toBe(0)
  })
})

describe('多种子优选：综合排序', () => {
  it('硬约束违反数优先于公平性', () => {
    const ranked = rankCandidates([
      cand(1, { hard: 1, front: 0, variance: 1, desk: 0 }), // 公平性极好但有硬违反
      cand(2, { hard: 0, front: 3, variance: 50, desk: 2 }),
    ])
    expect(ranked[0].seed).toBe(2)
    expect(ranked[0].rank).toBe(1)
    expect(ranked[1].rank).toBe(2)
  })

  it('硬约束相同时按三项公平性归一化综合分排序', () => {
    const ranked = rankCandidates([
      cand(1, { hard: 0, front: 0, variance: 100, desk: 3 }), // 前排最平但同桌/位置分差
      cand(2, { hard: 0, front: 1, variance: 50, desk: 1 }), // 各项都还行
      cand(3, { hard: 0, front: 2, variance: 200, desk: 5 }), // 全面最差
    ])
    expect(ranked.map((c) => c.seed)).toEqual([2, 1, 3])
    expect(ranked[0].fairScore).toBeLessThan(ranked[1].fairScore)
  })

  it('生成失败的方案排在最后且不参与排名', () => {
    const ranked = rankCandidates([cand(9, null), cand(1, { hard: 0, front: 2, variance: 10, desk: 1 })])
    expect(ranked[0].seed).toBe(1)
    expect(ranked[1].seed).toBe(9)
    expect(ranked[1].rank).toBe(0)
  })
})

describe('多种子优选：最优解释', () => {
  it('指出领先项与相对短板', () => {
    const ranked = rankCandidates([
      cand(1, { hard: 0, front: 1, variance: 10, desk: 2 }), // 前排/位置分最优，同桌是短板
      cand(2, { hard: 0, front: 3, variance: 40, desk: 0 }),
      cand(3, { hard: 0, front: 2, variance: 25, desk: 1 }),
    ])
    const note = explainBest(ranked)!
    expect(note.strengths.join()).toContain('前排次数极差')
    expect(note.strengths.join()).toContain('位置分')
    expect(note.weakness).toContain('同桌超 2 次的对')
    expect(note.weakness).toContain('本批最优为 0')
  })

  it('四项全优时没有短板', () => {
    const ranked = rankCandidates([
      cand(1, { hard: 0, front: 1, variance: 10, desk: 0 }),
      cand(2, { hard: 1, front: 3, variance: 40, desk: 2 }),
    ])
    const note = explainBest(ranked)!
    expect(note.weakness).toBeNull()
    expect(note.strengths.length).toBeGreaterThanOrEqual(3)
  })
})

describe('多种子优选：试跑执行器', () => {
  it('跑完全部种子并回报进度（含 ETA），结果已排序', async () => {
    const cls = makeClass({ rows: 3, cols: 4, weeks: 3 })
    const progress: number[] = []
    const res = await runSeedSearch(cls, 3, 777, (p) => progress.push(p.done))
    expect(res).toHaveLength(3)
    expect(res.every((c) => c.metrics !== null)).toBe(true)
    expect(res.every((c) => c.assignments.length === 3)).toBe(true)
    expect(res.every((c) => c.metrics!.hardViolations === 0)).toBe(true)
    // 排名连续且按硬约束 → 综合分升序
    expect(res.map((c) => c.rank)).toEqual([1, 2, 3])
    for (let i = 1; i < res.length; i++) {
      expect(res[i - 1].fairScore).toBeLessThanOrEqual(res[i].fairScore)
    }
    // 进度单调递增，最后一次 done = total
    expect(progress[progress.length - 1]).toBe(3)
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1])
    }
  })

  it('中途停止：shouldStop 生效后返回部分结果', async () => {
    const cls = makeClass({ rows: 3, cols: 4, weeks: 3 })
    let calls = 0
    const res = await runSeedSearch(cls, 6, 777, undefined, () => {
      calls++
      return calls > 2 // 跑完 2 个种子后停止
    })
    expect(res).toHaveLength(2)
  })

  it('同一基准种子两批试跑结果一致（可复现）', async () => {
    const cls = makeClass({ rows: 3, cols: 4, weeks: 2 })
    const a = await runSeedSearch(cls, 2, 99)
    const b = await runSeedSearch(cls, 2, 99)
    expect(a.map((c) => c.seed)).toEqual(b.map((c) => c.seed))
    expect(a.map((c) => c.assignments)).toEqual(b.map((c) => c.assignments))
  })
})
