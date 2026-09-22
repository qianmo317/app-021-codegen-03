import type { Assignment, ClassEntity, Student } from '../types'
import { InfeasibleError } from '../types'
import { buildSeatIndex, middleColSet, type SeatIndex } from './layout'
import { hashSeed, mulberry32 } from './rng'

// ================= 约束求解引擎 =================
// 思路（对应需求 §8）：带种子的约束感知初始分配 + 模拟退火局部交换改善。
// 硬约束违反使用极大权重（等价于禁止）；退火后仍有违反则贪心修复，最多重试 6 次。
// 全程不使用 Math.random，同一参数与种子生成结果完全一致（可复现）。

const HARD = 1e7
const W_HEIGHT = 4 // 身高序违背权重 w4
const W_MIX = 2 // 同桌同分层惩罚（mixTiers）
const FRESH_PAIR = 0.3 // 新同桌微弱惩罚（鼓励换新同桌）
const REPEAT1 = 3 // 同桌第 2 次重复
const REPEAT2 = 60 // 第 3 次重复（超出「不超过 2 次」目标，重罚）
const REPEAT3 = 500 // 第 4 次及以上

const MAX_ATTEMPTS = 6

export interface GenOptions {
  seed?: number
}

interface Prepared {
  idx: SeatIndex
  students: Student[]
  stIdx: Map<string, number>
  n: number
  S: number
  frontRows: number
  hearingRows: number
  middleCols: Set<number>
  aisleAccess: Uint8Array
  fixedSeat: Int32Array // 每个学生的固定座位下标，-1 无
  apartSet: Set<number>
  heights: Float64Array // -1 未知
  tier: Int8Array // 0 未知
  weeks: number
  frontSeats: number
  heightRule: boolean
  mixTiers: boolean
}

function prepare(cls: ClassEntity): Prepared {
  const idx = buildSeatIndex(cls.seats, cls.layout)
  const students = cls.students
  const n = students.length
  const S = cls.seats.length
  if (n === 0) throw new InfeasibleError('请先添加学生')
  if (n > S) throw new InfeasibleError(`学生数（${n}）超过座位数（${S}）`)
  const stIdx = new Map(students.map((s, i) => [s.id, i]))

  const aisleAccess = new Uint8Array(S)
  cls.seats.forEach((seat, i) => {
    aisleAccess[i] = seat.tags.includes('aisle') || seat.col === 0 || seat.col === cls.layout.cols - 1 ? 1 : 0
  })

  const fixedSeat = new Int32Array(n).fill(-1)
  const fixedTaken = new Map<number, string>()
  students.forEach((s, i) => {
    if (!s.fixedSeatId) return
    const seat = idx.byId.get(s.fixedSeatId)
    if (!seat) throw new InfeasibleError(`学生「${s.name}」的固定座位不存在（${s.fixedSeatId}）`)
    const si = seat.row * cls.layout.cols + seat.col
    const other = fixedTaken.get(si)
    if (other) throw new InfeasibleError(`固定座位冲突：「${s.name}」与「${other}」被指定到同一座位`)
    fixedTaken.set(si, s.name)
    fixedSeat[i] = si
  })

  const apartSet = new Set<number>()
  students.forEach((s, i) => {
    for (const otherId of s.mustApartFrom) {
      const j = stIdx.get(otherId)
      if (j === undefined || j === i) continue
      apartSet.add(pairKey(i, j))
    }
  })

  const heights = new Float64Array(n).fill(-1)
  const tier = new Int8Array(n)
  students.forEach((s, i) => {
    if (typeof s.heightCm === 'number' && s.heightCm > 0) heights[i] = s.heightCm
    if (s.tier) tier[i] = s.tier
  })

  const frontRows = Math.max(1, Math.min(cls.constraints.frontRows, cls.layout.rows))
  return {
    idx,
    students,
    stIdx,
    n,
    S,
    frontRows,
    hearingRows: Math.max(1, Math.ceil(cls.layout.rows / 2)),
    middleCols: middleColSet(cls.layout),
    aisleAccess,
    fixedSeat,
    apartSet,
    heights,
    tier,
    weeks: cls.weeks,
    frontSeats: frontRows * cls.layout.cols,
    heightRule: cls.constraints.heightRule,
    mixTiers: cls.constraints.mixTiers,
  }
}

function pairKey(a: number, b: number): number {
  return a < b ? a * 4096 + b : b * 4096 + a
}

// 单个学生-座位的硬约束违反数（不含「必须分开」这种成对约束）
function violOf(p: Prepared, st: number, seatIdx: number): number {
  const seat = p.idx.seats[seatIdx]
  const s = p.students[st]
  let v = 0
  if (s.vision === 'front_required' && seat.row >= p.frontRows) v++
  if (s.vision === 'middle_required' && !p.middleCols.has(seat.col)) v++
  if (s.special?.includes('hearing') && seat.row >= p.hearingRows) v++
  if (s.special?.includes('mobility') && !p.aisleAccess[seatIdx]) v++
  if (p.fixedSeat[st] >= 0 && p.fixedSeat[st] !== seatIdx) v++
  return v
}

// 同桌对惩罚（含「必须分开」= 硬约束、分层搭配、重复次数）
function pairPen(p: Prepared, deskCount: Map<number, number>, key: number): number {
  if (p.apartSet.has(key)) return HARD
  const count = deskCount.get(key) ?? 0
  let pen = count === 0 ? FRESH_PAIR : count === 1 ? REPEAT1 : count === 2 ? REPEAT2 : REPEAT3
  if (p.mixTiers) {
    const ta = p.tier[Math.floor(key / 4096)]
    const tb = p.tier[key % 4096]
    if (ta > 0 && ta === tb) pen += W_MIX
  }
  return pen
}

interface History {
  cumScore: Float64Array
  cumFront: Float64Array
  deskCount: Map<number, number>
  weeksDone: number
}

// 从已有排里重建历史状态（用于「从第 N 周起重排」时保留已过周次的影响）
function buildHistory(p: Prepared, assignments: Assignment[]): History {
  const cumScore = new Float64Array(p.n)
  const cumFront = new Float64Array(p.n)
  const deskCount = new Map<number, number>()
  let weeksDone = 0
  const sorted = [...assignments].sort((a, b) => a.week - b.week)
  for (const asg of sorted) {
    const seatByStudent = new Map<number, number>()
    for (const [seatId, studentId] of Object.entries(asg.map)) {
      const st = p.stIdx.get(studentId)
      const seat = p.idx.byId.get(seatId)
      if (st === undefined || seat === undefined) continue
      const si = seat.row * p.idx.layout.cols + seat.col
      seatByStudent.set(st, si)
      cumScore[st] += p.idx.posScore[si]
      if (seat.row < p.frontRows) cumFront[st] += 1
    }
    for (const [st, si] of seatByStudent) {
      for (const nb of p.idx.deskmates[si]) {
        const other = seatByStudent.get(nb)
        if (other === undefined || other <= st) continue
        const key = pairKey(st, other)
        deskCount.set(key, (deskCount.get(key) ?? 0) + 1)
      }
    }
    weeksDone++
  }
  return { cumScore, cumFront, deskCount, weeksDone }
}

// ---------- 约束感知的初始分配：可选座位最少的学生先安置 ----------
function initPlacement(p: Prepared, rng: () => number): { occ: Int32Array; seatOf: Int32Array } {
  const occ = new Int32Array(p.S).fill(-1)
  const seatOf = new Int32Array(p.n).fill(-1)

  // 固定学生直接安置
  const free: number[] = []
  for (let st = 0; st < p.n; st++) {
    if (p.fixedSeat[st] >= 0) {
      occ[p.fixedSeat[st]] = st
      seatOf[st] = p.fixedSeat[st]
    } else {
      free.push(st)
    }
  }

  // 其余学生按「允许座位数从少到多」贪心 + 随机挑选
  const allowed = free.map((st) => {
    const list: number[] = []
    for (let si = 0; si < p.S; si++) if (violOf(p, st, si) === 0) list.push(si)
    return list
  })
  const order = free.map((_, k) => k).sort((x, y) => allowed[x].length - allowed[y].length)
  for (const k of order) {
    const st = free[k]
    const opts = allowed[k].filter((si) => occ[si] === -1)
    if (opts.length === 0) {
      const s = p.students[st]
      const why =
        s.vision === 'front_required'
          ? `前排（前 ${p.frontRows} 排）座位不足`
          : s.vision === 'middle_required'
            ? '中间列座位不足'
            : s.special?.includes('mobility')
              ? '靠过道座位不足'
              : s.special?.includes('hearing')
                ? `前 ${p.hearingRows} 排座位不足`
                : '座位不足'
      throw new InfeasibleError(`无法安置学生「${s.name}」：${why}`)
    }
    const si = opts[Math.floor(rng() * opts.length)]
    occ[si] = st
    seatOf[st] = si
  }
  return { occ, seatOf }
}

interface MoveParts {
  dHard: number // 个体硬约束违反变化
  dApart: number // 「必须分开」成对违反变化
  dFair: number // 位置分累计方差变化
  dFront: number // 前排次数累计偏差变化
  dDesk: number // 同桌对惩罚变化（含 apart 的 HARD）
  dHeight: number // 身高序违背变化
  dA: number
  dB: number // a/b 的位置分增量
  fA: number
  fB: number // a/b 的前排计数增量
  dS2: number // Σx² 增量
  dFront2: number // Σ(cumFront−ideal)² 增量
}

const EMPTY_PARTS: MoveParts = {
  dHard: 0, dApart: 0, dFair: 0, dFront: 0, dDesk: 0, dHeight: 0, dA: 0, dB: 0, fA: 0, fB: 0, dS2: 0, dFront2: 0,
}

class WeekState {
  p: Prepared
  hist: History
  occ: Int32Array // seatIdx → studentIdx（-1 空）
  seatOf: Int32Array // studentIdx → seatIdx
  weekScore: Float64Array
  weekFront: Float64Array
  sumX = 0
  sumX2 = 0
  sumDevF2 = 0
  deskPen = 0
  heightV = 0
  hardV = 0
  idealF: number
  // 复用 scratch，避免热路径分配
  private kb: number[] = []
  private ka: number[] = []
  private hp: number[] = []

  constructor(p: Prepared, hist: History, occ: Int32Array, seatOf: Int32Array) {
    this.p = p
    this.hist = hist
    this.occ = occ
    this.seatOf = seatOf
    this.weekScore = new Float64Array(p.n)
    this.weekFront = new Float64Array(p.n)
    this.idealF = (p.weeks * p.frontSeats) / p.n
    for (let st = 0; st < p.n; st++) {
      const si = seatOf[st]
      // 关键：以初始座位的分值/前排计数作为周内基线，之后在其上累加移动增量，
      // 这样 finalize 时 hist 累计值 = 真实累计（初始 + 所有移动）
      this.weekScore[st] = p.idx.posScore[si]
      this.weekFront[st] = p.idx.seats[si].row < p.frontRows ? 1 : 0
      const x = hist.cumScore[st] + this.weekScore[st]
      this.sumX += x
      this.sumX2 += x * x
      const f = hist.cumFront[st] + this.weekFront[st]
      const d = f - this.idealF
      this.sumDevF2 += d * d
      this.hardV += violOf(p, st, si)
    }
    for (let si = 0; si < p.S; si++) {
      const a = occ[si]
      if (a < 0) continue
      for (const nb of p.idx.deskmates[si]) {
        if (nb <= si) continue
        const b = occ[nb]
        if (b < 0) continue
        this.deskPen += pairPen(p, hist.deskCount, pairKey(a, b))
      }
      const up = p.idx.vertical[si].up
      if (up >= 0 && occ[up] >= 0 && this.hPairOcc(up, si) === 1) this.heightV++
    }
  }

  private hPairOcc(upSi: number, downSi: number): 0 | 1 {
    const hu = this.occ[upSi]
    const hd = this.occ[downSi]
    if (hu < 0 || hd < 0) return 0
    const a = this.p.heights[hu]
    const b = this.p.heights[hd]
    if (a < 0 || b < 0) return 0
    return a > b ? 1 : 0
  }

  // 交换/移动 a（现于 seatA）到 seatB（ seatB 上原有 b，-1 表示空位）
  // 计算全部代价分量变化；不修改状态
  moveDelta(a: number, seatA: number, b: number, seatB: number): MoveParts {
    const p = this.p
    const parts: MoveParts = { ...EMPTY_PARTS }

    // 1) 个体硬约束
    parts.dHard = violOf(p, a, seatB) - violOf(p, a, seatA)
    if (b >= 0) parts.dHard += violOf(p, b, seatA) - violOf(p, b, seatB)

    // 2) 位置分公平性
    const psA = p.idx.posScore[seatA]
    const psB = p.idx.posScore[seatB]
    parts.dA = psB - psA
    parts.dB = b >= 0 ? psA - psB : 0
    const cumA = this.hist.cumScore[a] + this.weekScore[a]
    const cumB = b >= 0 ? this.hist.cumScore[b] + this.weekScore[b] : 0
    const newSumX = this.sumX + parts.dA + parts.dB
    const newSumX2 =
      this.sumX2 + (cumA + parts.dA) ** 2 - cumA * cumA + (b >= 0 ? (cumB + parts.dB) ** 2 - cumB * cumB : 0)
    const n = p.n
    parts.dS2 = newSumX2 - this.sumX2
    parts.dFair = newSumX2 - (newSumX * newSumX) / n - (this.sumX2 - (this.sumX * this.sumX) / n)

    // 3) 前排次数公平性
    const isF = (si: number) => (p.idx.seats[si].row < p.frontRows ? 1 : 0)
    parts.fA = isF(seatB) - isF(seatA)
    parts.fB = b >= 0 ? isF(seatA) - isF(seatB) : 0
    const cfA = this.hist.cumFront[a] + this.weekFront[a]
    const cfB = b >= 0 ? this.hist.cumFront[b] + this.weekFront[b] : 0
    const I = this.idealF
    parts.dFront2 =
      (cfA + parts.fA - I) ** 2 - (cfA - I) ** 2 + (b >= 0 ? (cfB + parts.fB - I) ** 2 - (cfB - I) ** 2 : 0)
    parts.dFront = parts.dFront2

    // 4) 同桌对（去重收集 before/after 的 key）
    const kb = this.kb
    const ka = this.ka
    kb.length = 0
    ka.length = 0
    const push = (arr: number[], key: number) => {
      if (!arr.includes(key)) arr.push(key)
    }
    // before：a 在 seatA，b 在 seatB（原状态）
    for (const nb of p.idx.deskmates[seatA]) {
      const o = this.occ[nb]
      if (o < 0 || o === a) continue
      push(kb, pairKey(a, o))
    }
    if (b >= 0) {
      for (const nb of p.idx.deskmates[seatB]) {
        const o = this.occ[nb]
        if (o < 0 || o === b) continue
        push(kb, pairKey(b, o))
      }
    }
    // after：a 在 seatB，b 在 seatA
    for (const nb of p.idx.deskmates[seatB]) {
      const o = nb === seatA ? b : nb === seatB ? a : this.occ[nb]
      if (o < 0 || o === a) continue
      push(ka, pairKey(a, o))
    }
    if (b >= 0) {
      for (const nb of p.idx.deskmates[seatA]) {
        const o = nb === seatB ? a : nb === seatA ? b : this.occ[nb]
        if (o < 0 || o === b) continue
        push(ka, pairKey(b, o))
      }
    }
    let penBefore = 0
    let apartBefore = 0
    for (const key of kb) {
      if (p.apartSet.has(key)) apartBefore++
      penBefore += pairPen(p, this.hist.deskCount, key)
    }
    let penAfter = 0
    let apartAfter = 0
    for (const key of ka) {
      if (p.apartSet.has(key)) apartAfter++
      penAfter += pairPen(p, this.hist.deskCount, key)
    }
    parts.dDesk = penAfter - penBefore
    parts.dApart = apartAfter - apartBefore

    // 5) 身高序（仅行列模式 + 开启身高规则）
    parts.dHeight = 0
    if (p.heightRule && p.idx.layout.mode === 'rows') {
      const v = p.idx.vertical
      const hp = this.hp
      hp.length = 0
      const add = (u: number, d: number) => {
        if (u < 0 || d < 0) return
        const code = u * 8192 + d
        if (!hp.includes(code)) hp.push(code)
      }
      add(v[seatA].up, seatA)
      add(seatA, v[seatA].down)
      add(v[seatB].up, seatB)
      add(seatB, v[seatB].down)
      for (const code of hp) {
        const u = Math.floor(code / 8192)
        const d = code % 8192
        const occAt = (si: number) => (si === seatA ? (b >= 0 ? b : -1) : si === seatB ? a : this.occ[si])
        const hu = occAt(u)
        const hd = occAt(d)
        const before =
          this.occ[u] >= 0 && this.occ[d] >= 0 && p.heights[this.occ[u]] >= 0 && p.heights[this.occ[d]] >= 0
            ? p.heights[this.occ[u]] > p.heights[this.occ[d]]
              ? 1
              : 0
            : 0
        const after =
          hu >= 0 && hd >= 0 && p.heights[hu] >= 0 && p.heights[hd] >= 0 ? (p.heights[hu] > p.heights[hd] ? 1 : 0) : 0
        parts.dHeight += after - before
      }
    }
    return parts
  }

  totalCost(parts: MoveParts): number {
    return HARD * parts.dHard + HARD * parts.dApart + parts.dFair + parts.dFront + parts.dDesk + W_HEIGHT * parts.dHeight
  }

  hardCount(): number {
    return this.hardV + this.deskHardV()
  }

  deskHardV(): number {
    let v = 0
    for (let si = 0; si < this.p.S; si++) {
      const a = this.occ[si]
      if (a < 0) continue
      for (const nb of this.p.idx.deskmates[si]) {
        if (nb <= si) continue
        const b = this.occ[nb]
        if (b < 0) continue
        if (this.p.apartSet.has(pairKey(a, b))) v++
      }
    }
    return v
  }

  commitMove(a: number, seatA: number, b: number, seatB: number, parts: MoveParts): void {
    this.occ[seatA] = b >= 0 ? b : -1
    this.occ[seatB] = a
    this.seatOf[a] = seatB
    if (b >= 0) this.seatOf[b] = seatA
    this.weekScore[a] += parts.dA
    if (b >= 0) this.weekScore[b] += parts.dB
    this.weekFront[a] += parts.fA
    if (b >= 0) this.weekFront[b] += parts.fB
    this.sumX += parts.dA + parts.dB
    this.sumX2 += parts.dS2
    this.sumDevF2 += parts.dFront2
    this.hardV += parts.dHard
    this.deskPen += parts.dDesk
    this.heightV += parts.dHeight
  }

  anneal(rng: () => number): void {
    const p = this.p
    const iters = Math.min(60000, Math.max(15000, p.n * 400))
    const T0 = 3.0
    const T1 = 0.02
    const movable: number[] = []
    for (let st = 0; st < p.n; st++) if (p.fixedSeat[st] < 0) movable.push(st)
    if (movable.length <= 1) return

    for (let it = 0; it < iters; it++) {
      const T = T0 * Math.pow(T1 / T0, it / iters)
      const a = movable[Math.floor(rng() * movable.length)]
      const seatA = this.seatOf[a]
      let seatB = Math.floor(rng() * p.S)
      if (seatB === seatA) seatB = (seatB + 1) % p.S
      const b = this.occ[seatB]
      if (b >= 0 && p.fixedSeat[b] >= 0) continue

      const parts = this.moveDelta(a, seatA, b, seatB)
      const d = this.totalCost(parts)
      if (d <= 0 || rng() < Math.exp(-d / T)) {
        this.commitMove(a, seatA, b, seatB, parts)
      }
    }
  }

  // 贪心修复残余硬约束（个体违反 + 「必须分开」成对违反）
  repair(): void {
    const p = this.p
    for (let round = 0; round < 200; round++) {
      if (this.hardCount() === 0) return
      let improved = false
      for (let a = 0; a < p.n; a++) {
        if (p.fixedSeat[a] >= 0) continue
        const seatA = this.seatOf[a]
        const cur = this.hardCount()
        let bestParts: MoveParts | null = null
        let bestSeatB = -1
        let bestB = -1
        for (let seatB = 0; seatB < p.S; seatB++) {
          if (seatB === seatA) continue
          const b = this.occ[seatB]
          if (b >= 0 && p.fixedSeat[b] >= 0) continue
          const parts = this.moveDelta(a, seatA, b, seatB)
          const after = this.hardV + parts.dHard + this.deskHardV() + parts.dApart
          if (after < cur && (bestParts === null || after < this.hardV + bestParts.dHard + this.deskHardV() + bestParts.dApart)) {
            bestParts = parts
            bestSeatB = seatB
            bestB = b
          }
        }
        if (bestParts && bestSeatB >= 0) {
          this.commitMove(a, seatA, bestB, bestSeatB, bestParts)
          improved = true
        }
      }
      if (!improved) return
    }
  }

  finalize(week: number): Assignment {
    const p = this.p
    const map: Record<string, string> = {}
    for (let si = 0; si < p.S; si++) {
      const st = this.occ[si]
      if (st >= 0) map[p.idx.seats[si].id] = p.students[st].id
    }
    for (let st = 0; st < p.n; st++) {
      this.hist.cumScore[st] += this.weekScore[st]
      this.hist.cumFront[st] += this.weekFront[st]
    }
    for (let si = 0; si < p.S; si++) {
      const a = this.occ[si]
      if (a < 0) continue
      for (const nb of p.idx.deskmates[si]) {
        if (nb <= si) continue
        const b = this.occ[nb]
        if (b < 0) continue
        const key = pairKey(a, b)
        this.hist.deskCount.set(key, (this.hist.deskCount.get(key) ?? 0) + 1)
      }
    }
    this.hist.weeksDone++
    let sum = 0
    let sum2 = 0
    for (let st = 0; st < p.n; st++) {
      sum += this.weekScore[st]
      sum2 += this.weekScore[st] * this.weekScore[st]
    }
    const fairness = Math.max(0, sum2 - (sum * sum) / p.n)
    let repeats = 0
    for (let si = 0; si < p.S; si++) {
      const a = this.occ[si]
      if (a < 0) continue
      for (const nb of p.idx.deskmates[si]) {
        if (nb <= si) continue
        const b = this.occ[nb]
        if (b < 0) continue
        if ((this.hist.deskCount.get(pairKey(a, b)) ?? 0) > 1) repeats++
      }
    }
    return { week, map, score: { fairness, repeats } }
  }
}

function generateOneWeek(p: Prepared, hist: History, week: number, seed: number): Assignment {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rng = mulberry32(hashSeed(seed, week, attempt))
    const { occ, seatOf } = initPlacement(p, rng)
    const st = new WeekState(p, hist, occ, seatOf)
    st.anneal(rng)
    st.repair()
    if (st.hardCount() === 0) return st.finalize(week)
  }
  throw new InfeasibleError(
    `第 ${week} 周无法生成满足硬约束的座位表（已尝试 ${MAX_ATTEMPTS} 次），请检查约束配置是否可行`,
  )
}

// ---------- 对外 API ----------

/** 生成完整计划（第 1..weeks 周） */
export function generatePlan(cls: ClassEntity, opts?: GenOptions): Assignment[] {
  const seed = opts?.seed ?? cls.seed
  const p = prepare(cls)
  const hist: History = {
    cumScore: new Float64Array(p.n),
    cumFront: new Float64Array(p.n),
    deskCount: new Map(),
    weeksDone: 0,
  }
  const out: Assignment[] = []
  for (let week = 1; week <= cls.weeks; week++) {
    out.push(generateOneWeek(p, hist, week, seed))
  }
  return out
}

/** 从第 fromWeek 周起重排（保留 1..fromWeek-1 周不变） */
export function regenerateFrom(cls: ClassEntity, fromWeek: number, opts?: GenOptions): Assignment[] {
  const seed = opts?.seed ?? cls.seed
  const p = prepare(cls)
  const kept = cls.assignments.filter((a) => a.week < fromWeek)
  const hist = buildHistory(p, kept)
  const out = kept.map((a) => ({ ...a, map: { ...a.map }, score: { ...a.score } }))
  for (let week = Math.max(1, fromWeek); week <= cls.weeks; week++) {
    out.push(generateOneWeek(p, hist, week, seed))
  }
  return out
}

/** 仅重新生成第 week 周（其余周保持不变） */
export function regenerateSingleWeek(cls: ClassEntity, week: number, opts?: GenOptions): Assignment {
  const seed = opts?.seed ?? cls.seed
  const p = prepare(cls)
  const kept = cls.assignments.filter((a) => a.week !== week && a.week < week)
  const hist = buildHistory(p, kept)
  return generateOneWeek(p, hist, week, seed)
}

/** 生成缺失的周次（如 weeks 从 16 调到 20） */
export function generateMissingWeeks(cls: ClassEntity, opts?: GenOptions): Assignment[] {
  const existing = cls.assignments.length
  if (existing >= cls.weeks) return cls.assignments
  const seed = opts?.seed ?? cls.seed
  const p = prepare(cls)
  const hist = buildHistory(p, cls.assignments)
  const out = cls.assignments.map((a) => ({ ...a, map: { ...a.map }, score: { ...a.score } }))
  for (let week = existing + 1; week <= cls.weeks; week++) {
    out.push(generateOneWeek(p, hist, week, seed))
  }
  return out
}

/** 随机一个新种子（仅 UI 使用，不参与引擎确定性） */
export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31)
}
