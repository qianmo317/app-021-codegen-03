import type { Assignment, ClassEntity, Seat, Student } from '../types'
import { useMemo, useRef } from 'react'
import { Glasses, Focus, Ear, Accessibility, Pin, GraduationCap } from 'lucide-react'

// ============ 座位图（共用组件）：Rotations 拖拽模式 / Print 打印模式 ============

interface SeatGridProps {
  cls: ClassEntity
  assignment?: Assignment
  draggable?: boolean
  onSwapPreview?: (from: string, to: string | null) => void
  onDropSwap?: (from: string, to: string) => void
  compact?: boolean
}

interface GridMeta {
  template: string
  vCol: (col: number) => number
  spacerCols: number[]
}

function gridMeta(cls: ClassEntity): GridMeta {
  const { cols, aisles } = cls.layout
  const spacerCols = aisles.map((a) => a + 2) // 1-based 网格线位置
  const parts: string[] = []
  for (let c = 0; c < cols; c++) {
    if (aisles.includes(c - 1)) parts.push('14px')
    parts.push(c === cols - 1 ? '1.1fr' : '1fr')
  }
  return {
    template: parts.join(' '),
    vCol: (col: number) => col + 1 + aisles.filter((a) => a < col).length,
    spacerCols,
  }
}

export function SeatGrid({ cls, assignment, draggable, onSwapPreview, onDropSwap, compact }: SeatGridProps) {
  const meta = useMemo(() => gridMeta(cls), [cls])
  const studentById = useMemo(() => new Map(cls.students.map((s) => [s.id, s])), [cls.students])
  // 拖拽源座位：dragover 阶段 dataTransfer.getData() 受 protected mode 限制（返回空串），
  // 必须用组件内 ref 记录来源，否则实时预览永远不出现
  const dragFrom = useRef<string | null>(null)
  const map = assignment?.map ?? {}
  const occupantOf = (seat: Seat): Student | undefined => {
    const id = map[seat.id]
    return id ? studentById.get(id) : undefined
  }

  const handleDragStart = (e: React.DragEvent, seat: Seat) => {
    if (!draggable) return
    dragFrom.current = seat.id
    e.dataTransfer.setData('text/plain', seat.id)
    e.dataTransfer.effectAllowed = 'move'
    onSwapPreview?.(seat.id, null)
  }

  const handleDragOver = (e: React.DragEvent, seat: Seat) => {
    if (!draggable) return
    const from = dragFrom.current
    if (!from || from === seat.id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    onSwapPreview?.(from, seat.id)
  }

  const handleDrop = (e: React.DragEvent, seat: Seat) => {
    if (!draggable) return
    e.preventDefault()
    const from = dragFrom.current ?? e.dataTransfer.getData('text/plain')
    dragFrom.current = null
    onSwapPreview?.(from || '', null)
    if (!from || from === seat.id) return
    onDropSwap?.(from, seat.id)
  }

  const { rows } = cls.layout

  return (
    <div className={compact ? 'seatmap seatmap-print' : 'seatmap'} data-testid="seat-grid">
      <div className="stage-bar" aria-label="讲台方向">
        <span>▲ 讲台</span>
      </div>
      <div className="seat-canvas" style={{ gridTemplateColumns: meta.template, gridTemplateRows: `repeat(${rows}, auto)` }}>
        {meta.spacerCols.map((c) => (
          <div key={`sp-${c}`} className="aisle-spacer" style={{ gridColumn: c, gridRow: `1 / span ${rows}` }} />
        ))}
        {cls.seats.map((seat) => {
          const st = occupantOf(seat)
          const tags = seat.tags
          const cls2 = [
            'seat',
            st ? 'seat-occupied' : 'seat-empty',
            tags.includes('front') ? 'tag-front' : tags.includes('back') ? 'tag-back' : 'tag-middle',
            tags.includes('window') ? 'tag-window' : '',
            tags.includes('door') ? 'tag-door' : '',
            tags.includes('aisle') ? 'tag-aisle' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div
              key={seat.id}
              className={cls2}
              style={{ gridColumn: meta.vCol(seat.col), gridRow: seat.row + 1 }}
              data-seat-id={seat.id}
              data-row={seat.row}
              data-col={seat.col}
              data-student={st?.name ?? ''}
              draggable={draggable && !!st}
              onDragStart={(e) => handleDragStart(e, seat)}
              onDragEnter={(e) => handleDragOver(e, seat)}
              onDragOver={(e) => handleDragOver(e, seat)}
              onDrop={(e) => handleDrop(e, seat)}
              onDragLeave={(e) => {
                // 移到本座位的子元素（姓名/徽章）上时 relatedTarget 仍在座位内，不算离开
                const next = e.relatedTarget as Node | null
                if (next && e.currentTarget.contains(next)) return
                onSwapPreview?.('', null)
              }}
              title={
                st
                  ? `${st.name}${st.heightCm ? ` · ${st.heightCm}cm` : ''}${
                      st.vision !== 'none' ? ' · ' + (st.vision === 'front_required' ? '近视·需前排' : '需中间') : ''
                    }`
                  : '空位'
              }
            >
              {st ? (
                <>
                  <span className="seat-name">{st.name}</span>
                  <span className="seat-badges">
                    {st.vision === 'front_required' && (
                      <em className="badge badge-vision-front" title="近视·需前排">
                        <Glasses size={compact ? 10 : 12} /> 前排
                      </em>
                    )}
                    {st.vision === 'middle_required' && (
                      <em className="badge badge-vision-middle" title="视力需中间">
                        <Focus size={compact ? 10 : 12} /> 中间
                      </em>
                    )}
                    {st.special?.includes('hearing') && (
                      <em className="badge badge-hearing" title="听力需前排">
                        <Ear size={compact ? 10 : 12} /> 听力
                      </em>
                    )}
                    {st.special?.includes('mobility') && (
                      <em className="badge badge-mobility" title="行动不便需靠过道">
                        <Accessibility size={compact ? 10 : 12} /> 过道
                      </em>
                    )}
                    {st.tier && (
                      <em className="badge badge-tier" title={`学习分层 T${st.tier}`}>
                        <GraduationCap size={compact ? 10 : 12} /> T{st.tier}
                      </em>
                    )}
                    {st.fixedSeatId === seat.id && (
                      <em className="badge badge-fixed" title="固定座位">
                        <Pin size={compact ? 10 : 12} />
                      </em>
                    )}
                  </span>
                </>
              ) : (
                <span className="seat-name seat-name-empty">空</span>
              )}
            </div>
          )
        })}
      </div>
      <div className="seatmap-footer">
        <span>第 1 排在最上方（讲台侧）· 左侧为靠窗</span>
      </div>
    </div>
  )
}
