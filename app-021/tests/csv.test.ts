import { describe, expect, it } from 'vitest'
import { fairnessCSV, toCSV, weeksCSV } from '../src/lib/csv'
import { generatePlan } from '../src/lib/engine'
import { computeFairness } from '../src/lib/fairness'
import { makeClass } from './helpers'

describe('CSV 导出', () => {
  it('带 BOM 且正确转义逗号/引号/换行', () => {
    const csv = toCSV([['姓名', '备注'], ['张三', '爱说话,需关注'], ['李"四', '多行\n备注']])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('"爱说话,需关注"')
    expect(csv).toContain('"李""四"')
    expect(csv).toContain('"多行\n备注"')
  })

  it('公平性统计表与按周座位表结构完整', () => {
    const cls = makeClass({ rows: 3, cols: 4, weeks: 4, seed: 8 })
    cls.assignments = generatePlan(cls)
    const report = computeFairness(cls)
    const f = fairnessCSV(cls, report)
    expect(f[0][0]).toContain(cls.name)
    expect(f[3]).toHaveLength(12) // 表头列数
    expect(f).toHaveLength(3 + 12 + 2) // 班级/周数/表头 + 12 行学生 + 空行 + 说明
    const w = weeksCSV(cls)
    expect(w.length).toBeGreaterThan(cls.assignments.length)
    // 每周都有 12 个座位记录
    for (let week = 1; week <= 4; week++) {
      expect(w.filter((r) => r[0] === week)).toHaveLength(12)
    }
  })
})
