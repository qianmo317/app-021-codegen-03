// 数据模型（对应需求文档 §7）
export type SeatTag =
  | 'front'      // 前排（自动：前 1/3 行）
  | 'middle'     // 中排（自动）
  | 'back'       // 后排（自动：后 1/3 行）
  | 'aisle'      // 靠过道（自动/手动）
  | 'window'     // 靠窗
  | 'door'       // 靠门
  | 'stage_side' // 讲台侧（手动标注）

export interface Seat {
  id: string
  row: number // 0 = 最靠讲台
  col: number
  group?: string
  tags: SeatTag[]
}

export type Vision = 'none' | 'front_required' | 'middle_required'
export type Special = 'hearing' | 'mobility'

export interface Student {
  id: string
  name: string
  heightCm?: number
  vision: Vision
  special?: Special[]
  tier?: 1 | 2 | 3 // 学习分层（可选，用于搭配策略）
  mustApartFrom: string[] // 必须分开的学生 id
  fixedSeatId?: string // 固定座位
  note?: string // 备注
}

export type SeatId = string
export type StudentId = string

export interface Assignment {
  week: number // 从 1 开始
  map: Record<SeatId, StudentId>
  score: { fairness: number; repeats: number }
}

export interface Constraints {
  frontRows: number // 视力需求学生必须在前 N 排
  heightRule: boolean // 高个靠后
  mixTiers: boolean // 同桌分层搭配（学习好的带一般的）
}

export interface LayoutConfig {
  rows: number
  cols: number
  aisles: number[] // 过道位于第 i 列与第 i+1 列之间（i 从 0 开始）
  mode: 'rows' | 'groups' // 行列排座 / 小组围坐
  doorSide: 'left' | 'right'
}

export interface ClassEntity {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  layout: LayoutConfig
  seats: Seat[]
  students: Student[]
  constraints: Constraints
  weeks: number
  seed: number
  assignments: Assignment[]
}

export interface GenParams {
  weeks?: number
  seed?: number
}

export class InfeasibleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InfeasibleError'
  }
}
