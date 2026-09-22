import type { ClassEntity, Student } from '../src/types'
import { buildSeats, middleColSet } from '../src/lib/layout'
import { mulberry32, shuffle } from '../src/lib/rng'

let counter = 0
export function sid(): string {
  return `s${++counter}`
}

export function makeStudent(partial: Partial<Student> & { name: string }): Student {
  return {
    id: sid(),
    vision: 'none',
    mustApartFrom: [],
    ...partial,
  }
}

export interface ClassOverrides {
  rows?: number
  cols?: number
  aisles?: number[]
  mode?: 'rows' | 'groups'
  doorSide?: 'left' | 'right'
  students?: Student[]
  frontRows?: number
  heightRule?: boolean
  mixTiers?: boolean
  weeks?: number
  seed?: number
  name?: string
}

export function makeClass(o: ClassOverrides = {}): ClassEntity {
  const layout = {
    rows: o.rows ?? 5,
    cols: o.cols ?? 8,
    aisles: o.aisles ?? [3],
    mode: o.mode ?? 'rows',
    doorSide: o.doorSide ?? 'right',
  }
  const seats = buildSeats(layout)
  return {
    id: `c${++counter}`,
    name: o.name ?? '测试班',
    createdAt: 0,
    updatedAt: 0,
    layout,
    seats,
    students: o.students ?? defaultStudents(layout.rows * layout.cols),
    constraints: {
      frontRows: o.frontRows ?? 3,
      heightRule: o.heightRule ?? true,
      mixTiers: o.mixTiers ?? true,
    },
    weeks: o.weeks ?? 20,
    seed: o.seed ?? 42,
    assignments: [],
  }
}

const NAMES = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'.split('')
export function defaultStudents(n: number): Student[] {
  const out: Student[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      id: `st${i + 1}`,
      name: `${NAMES[i % NAMES.length]}${Math.floor(i / NAMES.length) + 1}号`,
      heightCm: 140 + ((i * 7) % 30),
      vision: 'none',
      mustApartFrom: [],
    })
  }
  return out
}

// §10 验收用的随机可行配置生成器（种子确定，可复现）
export function randomClass(seed: number): ClassEntity {
  const rng = mulberry32(seed)
  const rows = 4 + Math.floor(rng() * 3) // 4~6
  const cols = 6 + Math.floor(rng() * 3) // 6~8
  const aisles = rng() < 0.7 ? [Math.floor(cols / 2) - 1] : []
  const cls = makeClass({
    rows,
    cols,
    aisles,
    students: [],
    frontRows: 2 + Math.floor(rng() * 2), // 2~3
    weeks: 20,
    seed: 1000 + seed,
    name: `随机班${seed}`,
  })
  const n = cls.seats.length
  const students: Student[] = defaultStudents(n).map((s) => ({
    ...s,
    heightCm: 135 + Math.floor(rng() * 35),
    tier: (1 + Math.floor(rng() * 3)) as 1 | 2 | 3,
  }))
  // 5 名需前排
  const frontIdx = shuffle(students.map((_, i) => i), rng).slice(0, 5)
  frontIdx.forEach((i) => (students[i].vision = 'front_required'))
  // 2 名需中间
  const midIdx = shuffle(students.map((_, i) => i).filter((i) => !frontIdx.includes(i)), rng).slice(0, 2)
  midIdx.forEach((i) => (students[i].vision = 'middle_required'))
  // 1 名听力（需前排一半）
  const rest = shuffle(students.map((_, i) => i).filter((i) => !frontIdx.includes(i) && !midIdx.includes(i)), rng)
  if (rest.length > 0) students[rest[0]].special = ['hearing']
  // 3 对必须分开
  const pool = shuffle(rest.slice(1), rng)
  for (let k = 0; k < 3; k++) {
    const a = pool[k * 2]
    const b = pool[k * 2 + 1]
    students[a].mustApartFrom = [students[b].id]
    students[b].mustApartFrom = [students[a].id]
  }
  // 10 个固定座位：从非 apart、非 hearing 的学生中选 10 个，
  // 每人分配一个满足其个体约束且未被占用的座位（保证可行）
  const mc = middleColSet({ rows, cols, aisles, mode: 'rows', doorSide: 'right' })
  const fixedCandidates = shuffle(
    students.map((_, i) => i).filter((i) => !pool.slice(0, 6).includes(i) && !rest.slice(0, 1).includes(i)),
    rng,
  )
  const usedSeats = new Set<number>()
  let fixedCount = 0
  for (const idx of fixedCandidates) {
    if (fixedCount >= 10) break
    const st = students[idx]
    const options = shuffle(
      cls.seats.filter((s) => {
        const si = s.row * cols + s.col
        if (usedSeats.has(si)) return false
        const okFront = st.vision !== 'front_required' || s.row < cls.constraints.frontRows
        const okMid = st.vision !== 'middle_required' || mc.has(s.col)
        const okHear = !st.special?.includes('hearing') || s.row < Math.ceil(rows / 2)
        const okMob =
          !st.special?.includes('mobility') || s.tags.includes('aisle') || s.col === 0 || s.col === cols - 1
        return okFront && okMid && okHear && okMob
      }),
      rng,
    )
    if (options.length === 0) continue
    const seat = options[0]
    usedSeats.add(seat.row * cols + seat.col)
    st.fixedSeatId = seat.id
    fixedCount++
  }
  cls.students = students
  return cls
}
