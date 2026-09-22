import type { ClassEntity } from '../types'
import { middleColSet } from './layout'

// 配置校验：在生成前给出人话提示（前置校验，避免引擎抛晦涩错误）
export function validateClass(cls: ClassEntity): string[] {
  const errors: string[] = []
  const seatIds = new Set(cls.seats.map((s) => s.id))
  if (cls.students.length === 0) errors.push('还没有学生，请先添加学生名单')
  if (cls.students.length > cls.seats.length)
    errors.push(`学生数（${cls.students.length}）超过座位数（${cls.seats.length}）`)

  const fixedOwner = new Map<string, string>()
  for (const s of cls.students) {
    if (s.fixedSeatId) {
      if (!seatIds.has(s.fixedSeatId)) {
        errors.push(`学生「${s.name}」的固定座位不存在`)
      } else {
        const other = fixedOwner.get(s.fixedSeatId)
        if (other) errors.push(`固定座位冲突：「${other}」与「${s.name}」同一座位`)
        else fixedOwner.set(s.fixedSeatId, s.name)
      }
    }
    for (const oid of s.mustApartFrom) {
      if (oid === s.id) errors.push(`学生「${s.name}」不能与自己「必须分开」`)
    }
  }

  // 容量检查
  const frontRows = Math.min(cls.constraints.frontRows, cls.layout.rows)
  const frontSeats = frontRows * cls.layout.cols
  const frontNeed = cls.students.filter((s) => s.vision === 'front_required' || s.special?.includes('hearing')).length
  const hearingRows = Math.ceil(cls.layout.rows / 2)
  const hearingSeats = hearingRows * cls.layout.cols
  if (frontNeed > Math.min(frontSeats, hearingSeats) && cls.students.length > 0) {
    errors.push(`需前排的学生（含听力）共 ${frontNeed} 人，超过前排座位容量 ${Math.min(frontSeats, hearingSeats)} 个`)
  }
  const mc = middleColSet(cls.layout).size
  const middleNeed = cls.students.filter((s) => s.vision === 'middle_required').length
  if (middleNeed > mc * cls.layout.rows) {
    errors.push(`需中间列的学生 ${middleNeed} 人，超过中间列容量 ${mc * cls.layout.rows} 个`)
  }
  const aisleCap = cls.seats.filter(
    (s) => s.tags.includes('aisle') || s.col === 0 || s.col === cls.layout.cols - 1,
  ).length
  const mobilityNeed = cls.students.filter((s) => s.special?.includes('mobility')).length
  if (mobilityNeed > aisleCap) {
    errors.push(`行动不便的学生 ${mobilityNeed} 人，超过靠过道座位容量 ${aisleCap} 个`)
  }

  // 固定座位与个体约束冲突
  for (const s of cls.students) {
    if (!s.fixedSeatId || !seatIds.has(s.fixedSeatId)) continue
    const seat = cls.seats.find((x) => x.id === s.fixedSeatId)!
    if (s.vision === 'front_required' && seat.row >= frontRows)
      errors.push(`「${s.name}」视力需前排，但固定座位在第 ${seat.row + 1} 排`)
    if (s.special?.includes('mobility')) {
      const ok = seat.tags.includes('aisle') || seat.col === 0 || seat.col === cls.layout.cols - 1
      if (!ok) errors.push(`「${s.name}」行动不便需靠过道，但固定座位不靠过道`)
    }
  }
  return errors
}
