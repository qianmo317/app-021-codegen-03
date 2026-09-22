import { describe, expect, it } from 'vitest'
import { generatePlan } from '../src/lib/engine'
import { computeFairness, weekHardViolations } from '../src/lib/fairness'
import { defaultStudents, makeClass, randomClass } from './helpers'

// ================= §10 验收标准（有断言） =================

describe('验收① 硬约束：100 组随机配置 × 20 周，违反数必须为 0', () => {
  it('随机 100 组配置（5 名需前排、3 对必须分开、10 个固定座位）', () => {
    let totalViolations = 0
    for (let seed = 1; seed <= 100; seed++) {
      const cls = randomClass(seed)
      const plan = generatePlan(cls)
      expect(plan).toHaveLength(20)
      for (const asg of plan) {
        const violations = weekHardViolations(cls, asg.week, asg.map)
        if (violations.length > 0) {
          console.error(`seed=${seed} week=${asg.week}`, violations)
        }
        totalViolations += violations.length
      }
    }
    expect(totalViolations).toBe(0)
  }, 600_000)
})

describe('验收② 公平性：40 人 20 周，每人「前 3 排」次数极差 ≤ 3', () => {
  it('前 3 排次数极差 ≤ 3（断言，可调阈值）', () => {
    const cls = makeClass({ rows: 5, cols: 8, weeks: 20, seed: 42, frontRows: 3 })
    cls.assignments = generatePlan(cls)
    const report = computeFairness(cls)
    console.log('前3排次数分布:', report.rows.map((r) => r.frontRowsCount).join(','))
    console.log(`极差=${report.frontRowsRange}, 位置分Σ偏差²=${report.variance.toFixed(1)}`)
    expect(report.frontRowsRange).toBeLessThanOrEqual(3)
    expect(report.hardViolations).toHaveLength(0)
  })
})

describe('验收③ 同桌重复：任意两人同桌次数 ≤ 2', () => {
  it('40 人 20 周无超限对（默认目标）', () => {
    const cls = makeClass({ rows: 5, cols: 8, weeks: 20, seed: 42 })
    cls.assignments = generatePlan(cls)
    const report = computeFairness(cls)
    console.log('同桌超限对:', report.deskmateOverLimit)
    expect(report.deskmateOverLimit).toHaveLength(0)
  })
})

describe('验收④ 小规模边界：学生数少于座位数（含空位）', () => {
  it('30 人坐 40 座正常生成', () => {
    const cls = makeClass({ rows: 5, cols: 8, weeks: 8, seed: 9 })
    cls.students = defaultStudents(30)
    const plan = generatePlan(cls)
    expect(plan).toHaveLength(8)
    for (const asg of plan) {
      expect(Object.keys(asg.map)).toHaveLength(30)
      expect(weekHardViolations(cls, asg.week, asg.map)).toHaveLength(0)
    }
  })
})
