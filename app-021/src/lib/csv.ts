import type { ClassEntity } from '../types'
import type { FairnessReport } from './fairness'
import { buildSeatIndex } from './layout'

// CSV 导出（带 BOM，Excel 直接打开不乱码）
export function toCSV(rows: (string | number)[][]): string {
  const esc = (v: string | number): string => {
    const s = String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n')
}

export function downloadCSV(filename: string, rows: (string | number)[][]): void {
  const blob = new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// 全班统计表（导出给家长看）
export function fairnessCSV(cls: ClassEntity, report: FairnessReport): (string | number)[][] {
  const rows: (string | number)[][] = []
  rows.push([`班级：${cls.name}`])
  rows.push([`统计周数：${report.totalWeeks}`])
  rows.push([
    '姓名',
    '身高(cm)',
    '视力状况',
    `前${cls.constraints.frontRows}排次数`,
    '前排次数',
    '中排次数',
    '后排次数',
    '中间列次数',
    '平均位置分',
    '最常同桌',
    '同桌次数',
    '重复超限(>2次)',
  ])
  const visionText = { none: '', front_required: '需前排', middle_required: '需中间' } as const
  for (const r of report.rows) {
    const top = r.deskmates[0]
    rows.push([
      r.student.name,
      r.student.heightCm ?? '',
      visionText[r.student.vision],
      r.frontRowsCount,
      r.frontCount,
      r.middleCount,
      r.backCount,
      r.middleColCount,
      r.avgScore.toFixed(2),
      top ? (cls.students.find((s) => s.id === top.studentId)?.name ?? '') : '',
      top ? top.count : 0,
      r.maxDeskmateRepeat > 2 ? `与${r.deskmates.filter((d) => d.count > 2).length}人超限` : '',
    ])
  }
  rows.push([])
  rows.push(['位置分说明：位置分 = 前后排权重(0~2，越小越靠前) + 中间度权重(0~1，越小越靠中间)，分数越低位置越好'])
  if (report.deskmateOverLimit.length) {
    rows.push(['同桌超限对：', ...report.deskmateOverLimit.map((d) => `${d.a}-${d.b}(${d.count}次)`)])
  }
  return rows
}

// 按周座位表（每周一段）
export function weeksCSV(cls: ClassEntity): (string | number)[][] {
  const rows: (string | number)[][] = []
  rows.push([`班级：${cls.name}`])
  rows.push(['周次', '排', '列', '座位号', '学生', '标记'])
  const nameOf = new Map(cls.students.map((s) => [s.id, s.name]))
  const idx = buildSeatIndex(cls.seats, cls.layout)
  for (const asg of [...cls.assignments].sort((a, b) => a.week - b.week)) {
    for (const [seatId, studentId] of Object.entries(asg.map)) {
      const seat = idx.byId.get(seatId)
      if (!seat) continue
      const tagText = seat.tags.filter((t) => t !== 'middle').join('/')
      rows.push([asg.week, seat.row + 1, seat.col + 1, seat.id, nameOf.get(studentId) ?? studentId, tagText])
    }
  }
  return rows
}
