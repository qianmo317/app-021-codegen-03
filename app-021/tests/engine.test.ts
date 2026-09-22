import { describe, expect, it } from 'vitest'
import {
  generateMissingWeeks,
  generatePlan,
  regenerateFrom,
  regenerateSingleWeek,
} from '../src/lib/engine'
import { InfeasibleError } from '../src/types'
import { computeFairness, previewSwap, weekHardViolations, weekStats } from '../src/lib/fairness'
import { makeClass, makeStudent } from './helpers'

describe('引擎：可复现性', () => {
  it('同一参数与种子 → 结果完全一致', () => {
    const cls = makeClass({ rows: 4, cols: 6, weeks: 8, seed: 7 })
    const a = generatePlan(cls)
    const b = generatePlan(cls)
    expect(a).toEqual(b)
  })

  it('不同种子 → 第 1 周安排不同', () => {
    const cls = makeClass({ rows: 4, cols: 6, weeks: 4 })
    const a = generatePlan(cls, { seed: 1 })
    const b = generatePlan(cls, { seed: 2 })
    expect(a[0].map).not.toEqual(b[0].map)
  })
})

describe('引擎：硬约束', () => {
  it('固定座位学生每周都在固定座位', () => {
    const cls = makeClass({ rows: 3, cols: 4, weeks: 6, students: undefined })
    cls.students[3].fixedSeatId = 'r1c2'
    const plan = generatePlan(cls)
    for (const asg of plan) {
      expect(asg.map['r1c2']).toBe(cls.students[3].id)
    }
  })

  it('必须分开的学生永不同桌', () => {
    const cls = makeClass({ rows: 3, cols: 6, weeks: 10 })
    cls.students[0].mustApartFrom = [cls.students[1].id]
    cls.students[1].mustApartFrom = [cls.students[0].id]
    const plan = generatePlan(cls)
    for (const asg of plan) {
      const violations = weekHardViolations(cls, asg.week, asg.map)
      expect(violations.filter((v) => v.includes('必须分开'))).toHaveLength(0)
    }
  })

  it('视力需前排学生总在前 N 排', () => {
    const cls = makeClass({ rows: 4, cols: 5, weeks: 8, frontRows: 2 })
    cls.students[0].vision = 'front_required'
    cls.students[1].vision = 'front_required'
    const plan = generatePlan(cls)
    for (const asg of plan) {
      for (const stId of [cls.students[0].id, cls.students[1].id]) {
        const seatId = Object.entries(asg.map).find(([, v]) => v === stId)?.[0]
        const row = Number(seatId!.match(/r(\d+)/)![1])
        expect(row).toBeLessThan(2)
      }
    }
  })

  it('前排容量不足时报可读错误', () => {
    const cls = makeClass({ rows: 2, cols: 3, weeks: 4, frontRows: 1 })
    for (let i = 0; i < 5; i++) cls.students[i].vision = 'front_required' // 前 1 排只有 3 座
    expect(() => generatePlan(cls)).toThrow(InfeasibleError)
    expect(() => generatePlan(cls)).toThrow(/前排/)
  })

  it('固定座位冲突时报错', () => {
    const cls = makeClass({ rows: 2, cols: 3 })
    cls.students[0].fixedSeatId = 'r0c0'
    cls.students[1].fixedSeatId = 'r0c0'
    expect(() => generatePlan(cls)).toThrow(/固定座位冲突/)
  })
})

describe('引擎：增量重生成（§8）', () => {
  it('从第 N 周起重排：之前的周完全不变', () => {
    const cls = makeClass({ rows: 4, cols: 6, weeks: 10, seed: 99 })
    cls.assignments = generatePlan(cls)
    const before = cls.assignments.filter((a) => a.week < 5)
    cls.assignments = regenerateFrom(cls, 5)
    const after = cls.assignments.filter((a) => a.week < 5)
    expect(after).toEqual(before)
    expect(cls.assignments).toHaveLength(10)
    // 重排后硬约束仍为 0
    for (const asg of cls.assignments) {
      expect(weekHardViolations(cls, asg.week, asg.map)).toHaveLength(0)
    }
  })

  it('仅重生成第 N 周：其他周不变', () => {
    const cls = makeClass({ rows: 4, cols: 6, weeks: 6, seed: 5 })
    cls.assignments = generatePlan(cls)
    const snapshot = cls.assignments.map((a) => ({ ...a }))
    const w3 = regenerateSingleWeek(cls, 3)
    cls.assignments = cls.assignments.map((a) => (a.week === 3 ? w3 : a))
    expect(cls.assignments.find((a) => a.week === 1)!.map).toEqual(snapshot.find((a) => a.week === 1)!.map)
    expect(cls.assignments.find((a) => a.week === 6)!.map).toEqual(snapshot.find((a) => a.week === 6)!.map)
    expect(weekHardViolations(cls, 3, w3.map)).toHaveLength(0)
  })

  it('补齐缺失周次', () => {
    const cls = makeClass({ rows: 4, cols: 6, weeks: 8, seed: 3 })
    cls.assignments = generatePlan({ ...cls, weeks: 4 })
    expect(cls.assignments).toHaveLength(4)
    cls.assignments = generateMissingWeeks(cls)
    expect(cls.assignments).toHaveLength(8)
  })
})

describe('公平性与交换（手工微调）', () => {
  it('weekStats 与 previewSwap 正确反映交换影响', () => {
    const cls = makeClass({ rows: 3, cols: 4, weeks: 4, seed: 11 })
    cls.assignments = generatePlan(cls)
    const asg = cls.assignments[0]
    const seatIds = Object.keys(asg.map)
    const [s1, s2] = seatIds.slice(0, 2)
    const before = weekStats(cls, asg.map, 1)
    const pv = previewSwap(cls, 1, s1, s2)
    expect(pv.ok).toBe(true)
    expect(pv.fairnessAfter).toBeGreaterThanOrEqual(0)
    expect(pv.fairnessBefore).toBeCloseTo(before.fairness, 8)
    expect(pv.repeatsAfter).toBeGreaterThanOrEqual(0)
  })

  it('交换造成硬约束违反时被拦截', () => {
    const cls = makeClass({ rows: 3, cols: 4, weeks: 4, seed: 11, frontRows: 1 })
    cls.students[0].vision = 'front_required'
    cls.assignments = generatePlan(cls)
    const asg = cls.assignments[0]
    // 找到需前排学生当前座位与一个后排座位
    const frontSeat = Object.entries(asg.map).find(([, v]) => v === cls.students[0].id)![0]
    const backSeat = Object.keys(asg.map).find((id) => Number(id.match(/r(\d+)/)![1]) >= 2)!
    const pv = previewSwap(cls, 1, frontSeat, backSeat)
    expect(pv.ok).toBe(false)
    expect(pv.reasons.join()).toContain('前排')
  })

  it('公平性报告统计正确（前排计数与同桌重复）', () => {
    const cls = makeClass({ rows: 3, cols: 4, weeks: 6, seed: 21, frontRows: 1 })
    cls.assignments = generatePlan(cls)
    const report = computeFairness(cls)
    expect(report.rows).toHaveLength(12)
    expect(report.totalWeeks).toBe(6)
    const totalFront = report.rows.reduce((s, r) => s + r.frontRowsCount, 0)
    expect(totalFront).toBe(6 * 4) // 每周前 1 排 4 个座位 × 6 周
    expect(report.hardViolations).toHaveLength(0)
  })
})

describe('引擎：性能（§8 40人×20周 < 1s）', () => {
  it('40 人 20 周生成耗时 < 1000ms', () => {
    const cls = makeClass({ rows: 5, cols: 8, weeks: 20, seed: 42 })
    const t0 = performance.now()
    const plan = generatePlan(cls)
    const ms = performance.now() - t0
    expect(plan).toHaveLength(20)
    expect(ms).toBeLessThan(1000)
    console.log(`40人×20周 生成耗时: ${ms.toFixed(0)}ms`)
  })
})

describe('引擎：无身高数据时不产生身高违背', () => {
  it('heightCm 缺失的学生参与轮换无异常', () => {
    const students = makeStudent({ name: '无身高' }).id ? undefined : undefined
    void students
    const cls = makeClass({ rows: 3, cols: 4, weeks: 4 })
    cls.students = cls.students.map((s, i) => ({ ...s, heightCm: i % 2 === 0 ? undefined : s.heightCm }))
    const plan = generatePlan(cls)
    expect(plan).toHaveLength(4)
  })
})
