import type { ClassEntity, Seat, Student, StudentId } from '../types'
import { buildSeatIndex, middleColSet, positionScore } from './layout'

// ================= 公平性报告（§4.4 / §10） =================

export interface DeskmateStat {
  studentId: StudentId
  count: number
}

export interface FairnessRow {
  student: Student
  frontRowsCount: number // 前 N 排（N = constraints.frontRows）次数
  frontCount: number // 前 1/3 行次数
  middleCount: number // 中 1/3 行次数
  backCount: number // 后 1/3 行次数
  middleColCount: number // 中间列次数
  totalScore: number
  avgScore: number
  deskmates: DeskmateStat[]
  maxDeskmateRepeat: number
}

export interface FairnessViolation {
  week: number
  detail: string
}

export interface FairnessReport {
  rows: FairnessRow[]
  totalWeeks: number
  frontRowsRange: number // 「前 N 排」次数极差
  variance: number // 累计位置分方差 × 人数（Σ偏差²）
  std: number
  deskmateOverLimit: { a: string; b: string; count: number }[] // 同桌 > 2 次的对
  heightViolations: number
  hardViolations: FairnessViolation[]
}

function deskmatePairIds(cls: ClassEntity, map: Record<string, string>): [string, string][] {
  const idx = buildSeatIndex(cls.seats, cls.layout)
  const byId = idx.byId
  const out: [string, string][] = []
  for (const [seatId, studentId] of Object.entries(map)) {
    const seat = byId.get(seatId)
    if (!seat) continue
    const si = seat.row * cls.layout.cols + seat.col
    for (const nb of idx.deskmates[si]) {
      if (nb < si) continue // 去重（按座位下标）
      const nbSeat = cls.seats[nb]
      const other = map[nbSeat.id]
      if (other && other !== studentId) out.push([studentId, other])
    }
  }
  return out
}

// 某学生某周座位的个体硬约束违反描述（用于报告与手工交换校验）
export function seatViolationFor(
  cls: ClassEntity,
  student: Student,
  seat: Seat | undefined,
): string[] {
  if (!seat) return []
  const out: string[] = []
  if (student.vision === 'front_required' && seat.row >= cls.constraints.frontRows)
    out.push(`视力需前排，但被安排在第 ${seat.row + 1} 排`)
  const mc = middleColSet(cls.layout)
  if (student.vision === 'middle_required' && !mc.has(seat.col)) out.push('视力需中间，但被安排在边列')
  if (student.special?.includes('hearing') && seat.row >= Math.ceil(cls.layout.rows / 2))
    out.push('听力需前排一半，但被安排在后排')
  if (student.special?.includes('mobility')) {
    const ok = seat.tags.includes('aisle') || seat.col === 0 || seat.col === cls.layout.cols - 1
    if (!ok) out.push('行动不便需靠过道，但被安排在中间位')
  }
  if (student.fixedSeatId && student.fixedSeatId !== seat.id) out.push('未坐在固定座位')
  return out
}

// 某周座位表的全部硬约束违反（用于报告与手工交换拦截）
export function weekHardViolations(cls: ClassEntity, week: number, map: Record<string, string>): string[] {
  const out: string[] = []
  const byStudent = new Map<StudentId, Seat>()
  for (const [seatId, studentId] of Object.entries(map)) {
    const seat = cls.seats.find((s) => s.id === seatId)
    const student = cls.students.find((s) => s.id === studentId)
    if (seat && student) byStudent.set(studentId, seat)
  }
  for (const student of cls.students) {
    const seat = byStudent.get(student.id)
    for (const v of seatViolationFor(cls, student, seat)) {
      out.push(`第 ${week} 周：${student.name} ${v}`)
    }
  }
  for (const [a, b] of deskmatePairIds(cls, map)) {
    const sa = cls.students.find((s) => s.id === a)
    const sb = cls.students.find((s) => s.id === b)
    if (sa && sb && (sa.mustApartFrom.includes(b) || sb.mustApartFrom.includes(a))) {
      out.push(`第 ${week} 周：${sa.name} 与 ${sb.name} 必须分开却成为同桌`)
    }
  }
  return out
}

// 单周统计（公平性 Σ偏差² 与新增同桌重复对数）
export function weekStats(cls: ClassEntity, map: Record<string, string>, excludeWeek: number) {
  const idx = buildSeatIndex(cls.seats, cls.layout)
  const scores: number[] = []
  for (const seatId of Object.keys(map)) {
    const seat = idx.byId.get(seatId)
    if (seat) scores.push(positionScore(seat, cls.layout))
  }
  const n = Math.max(1, scores.length)
  const sum = scores.reduce((a, b) => a + b, 0)
  const sum2 = scores.reduce((a, b) => a + b * b, 0)
  const fairness = Math.max(0, sum2 - (sum * sum) / n)
  // 重复：与本周以外的其他周对比
  const curPairs = new Set(deskmatePairIds(cls, map).map(([a, b]) => [a, b].sort().join('|')))
  let repeats = 0
  for (const asg of cls.assignments) {
    if (asg.week === excludeWeek) continue
    for (const [a, b] of deskmatePairIds(cls, asg.map)) {
      if (curPairs.has([a, b].sort().join('|'))) {
        repeats++
        break
      }
    }
  }
  return { fairness, repeats }
}

export function computeFairness(cls: ClassEntity): FairnessReport {
  const rows: FairnessRow[] = []
  const deskCount = new Map<string, Map<StudentId, number>>() // studentId → otherId → count
  const cumScore = new Map<StudentId, number>()
  const frontRowsCount = new Map<StudentId, number>()
  const frontCount = new Map<StudentId, number>()
  const middleCount = new Map<StudentId, number>()
  const backCount = new Map<StudentId, number>()
  const middleColCount = new Map<StudentId, number>()

  const frontThird = Math.max(1, Math.ceil(cls.layout.rows / 3))
  const mc = middleColSet(cls.layout)

  for (const s of cls.students) {
    cumScore.set(s.id, 0)
    frontRowsCount.set(s.id, 0)
    frontCount.set(s.id, 0)
    middleCount.set(s.id, 0)
    backCount.set(s.id, 0)
    middleColCount.set(s.id, 0)
    deskCount.set(s.id, new Map())
  }

  const assignments = [...cls.assignments].sort((a, b) => a.week - b.week)
  const hardViolations: FairnessViolation[] = []
  for (const asg of assignments) {
    hardViolations.push(...weekHardViolations(cls, asg.week, asg.map).map((detail) => ({ week: asg.week, detail })))
    const seatById = new Map(cls.seats.map((s) => [s.id, s]))
    for (const [seatId, studentId] of Object.entries(asg.map)) {
      const seat = seatById.get(seatId)
      if (!seat || !cumScore.has(studentId)) continue
      cumScore.set(studentId, (cumScore.get(studentId) ?? 0) + positionScore(seat, cls.layout))
      if (seat.row < cls.constraints.frontRows) frontRowsCount.set(studentId, (frontRowsCount.get(studentId) ?? 0) + 1)
      if (seat.row < frontThird) frontCount.set(studentId, (frontCount.get(studentId) ?? 0) + 1)
      else if (seat.row >= cls.layout.rows - frontThird) backCount.set(studentId, (backCount.get(studentId) ?? 0) + 1)
      else middleCount.set(studentId, (middleCount.get(studentId) ?? 0) + 1)
      if (mc.has(seat.col)) middleColCount.set(studentId, (middleColCount.get(studentId) ?? 0) + 1)
    }
    for (const [a, b] of deskmatePairIds(cls, asg.map)) {
      const ma = deskCount.get(a)
      if (ma) ma.set(b, (ma.get(b) ?? 0) + 1)
      const mb = deskCount.get(b)
      if (mb) mb.set(a, (mb.get(a) ?? 0) + 1)
    }
  }

  // 身高序违背（行列模式）
  let heightViolations = 0
  if (cls.constraints.heightRule && cls.layout.mode === 'rows') {
    const idx = buildSeatIndex(cls.seats, cls.layout)
    const heightOf = new Map(cls.students.map((s) => [s.id, s.heightCm]))
    for (const asg of assignments) {
      for (const [seatId, studentId] of Object.entries(asg.map)) {
        const seat = idx.byId.get(seatId)
        if (!seat) continue
        const down = idx.byId.get(`r${seat.row + 1}c${seat.col}`)
        if (!down) continue
        const downStudent = asg.map[down.id]
        const hUp = heightOf.get(studentId)
        const hDown = downStudent ? heightOf.get(downStudent) : undefined
        if (typeof hUp === 'number' && typeof hDown === 'number' && hUp > hDown) heightViolations++
      }
    }
  }

  const n = cls.students.length || 1
  let sum = 0
  let sum2 = 0
  for (const s of cls.students) {
    const total = cumScore.get(s.id) ?? 0
    sum += total
    sum2 += total * total
  }
  const variance = Math.max(0, sum2 - (sum * sum) / n)
  const std = Math.sqrt(variance / n)

  const frVals = cls.students.map((s) => frontRowsCount.get(s.id) ?? 0)
  const frontRowsRange = frVals.length ? Math.max(...frVals) - Math.min(...frVals) : 0

  const deskmateOverLimit: { a: string; b: string; count: number }[] = []
  const nameOf = new Map(cls.students.map((s) => [s.id, s.name]))
  const seen = new Set<string>()
  for (const [sid, others] of deskCount) {
    for (const [oid, count] of others) {
      const key = [sid, oid].sort().join('|')
      if (count > 2 && !seen.has(key)) {
        seen.add(key)
        deskmateOverLimit.push({ a: nameOf.get(sid) ?? sid, b: nameOf.get(oid) ?? oid, count })
      }
    }
  }

  for (const s of cls.students) {
    const deskmates = [...(deskCount.get(s.id)?.entries() ?? [])]
      .map(([studentId, count]) => ({ studentId, count }))
      .sort((a, b) => b.count - a.count)
    const total = cumScore.get(s.id) ?? 0
    rows.push({
      student: s,
      frontRowsCount: frontRowsCount.get(s.id) ?? 0,
      frontCount: frontCount.get(s.id) ?? 0,
      middleCount: middleCount.get(s.id) ?? 0,
      backCount: backCount.get(s.id) ?? 0,
      middleColCount: middleColCount.get(s.id) ?? 0,
      totalScore: total,
      avgScore: assignments.length ? total / assignments.length : 0,
      deskmates,
      maxDeskmateRepeat: deskmates.reduce((m, d) => Math.max(m, d.count), 0),
    })
  }

  return {
    rows,
    totalWeeks: assignments.length,
    frontRowsRange,
    variance,
    std,
    deskmateOverLimit,
    heightViolations,
    hardViolations,
  }
}

// 手工交换预览：实时显示「交换后公平性变化」（§9）
export interface SwapPreview {
  ok: boolean
  reasons: string[]
  nameA?: string
  nameB?: string
  fairnessBefore: number
  fairnessAfter: number
  repeatsBefore: number
  repeatsAfter: number
}

export function previewSwap(cls: ClassEntity, week: number, seatAId: string, seatBId: string): SwapPreview {
  const asg = cls.assignments.find((a) => a.week === week)
  if (!asg) return { ok: false, reasons: ['该周尚未生成'], fairnessBefore: 0, fairnessAfter: 0, repeatsBefore: 0, repeatsAfter: 0 }
  const map: Record<string, string> = { ...asg.map }
  const a = map[seatAId]
  const b = map[seatBId]
  if (b) map[seatAId] = b
  else delete map[seatAId]
  if (a) map[seatBId] = a

  const studentA = a ? cls.students.find((s) => s.id === a) : undefined
  const studentB = b ? cls.students.find((s) => s.id === b) : undefined
  const before = weekStats(cls, asg.map, week)
  const after = weekStats(cls, map, week)
  const violations = weekHardViolations(cls, week, map)
  return {
    ok: violations.length === 0,
    reasons: violations,
    nameA: studentA?.name,
    nameB: studentB?.name,
    fairnessBefore: before.fairness,
    fairnessAfter: after.fairness,
    repeatsBefore: before.repeats,
    repeatsAfter: after.repeats,
  }
}
