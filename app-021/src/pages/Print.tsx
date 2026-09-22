import { useState } from 'react'
import { Link } from '../router'
import { useStore } from '../store'
import { SeatGrid } from '../components/SeatGrid'
import { ArrowLeft, Printer } from 'lucide-react'

export function Print({ classId }: { classId: string }) {
  const { getClass } = useStore()
  const cls = getClass(classId)
  const [mode, setMode] = useState<'all' | number>('all')

  if (!cls) {
    return (
      <div className="page">
        <p>班级不存在。</p>
        <Link to="/">返回</Link>
      </div>
    )
  }

  const weeks = cls.assignments.length
  const list = mode === 'all' ? Array.from({ length: weeks }, (_, i) => i + 1) : [mode]

  return (
    <div className="page page-wide">
      <div className="print-toolbar no-print">
        <Link className="back" to={`/class/${cls.id}/rotations`}>
          <ArrowLeft size={14} /> 返回轮换
        </Link>
        <h1>{cls.name} · 打印座位表</h1>
        <div className="row-flex">
          <label className="inline-label">
            打印范围
            <select
              className="input input-sm"
              value={mode === 'all' ? 'all' : String(mode)}
              onChange={(e) => setMode(e.target.value === 'all' ? 'all' : Number(e.target.value))}
            >
              <option value="all">全部周（每周一页）</option>
              {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  仅第 {w} 周
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" data-testid="do-print" onClick={() => window.print()} disabled={weeks === 0}>
            <Printer size={15} /> 打印（A4 纵向）
          </button>
        </div>
        {weeks === 0 && <p className="muted">还没有生成轮换结果，无法打印。先到「轮换结果」页生成。</p>}
      </div>

      {list.map((w) => {
        const asg = cls.assignments.find((a) => a.week === w)
        if (!asg) return null
        return (
          <div key={w} className="print-sheet" data-testid={`print-sheet-${w}`}>
            <header className="print-head">
              <h2>{cls.name} · 第 {w} 周座位表</h2>
              <span className="print-date">生成于 {new Date(cls.updatedAt).toLocaleDateString('zh-CN')}</span>
            </header>
            <SeatGrid cls={cls} assignment={asg} compact />
            <footer className="print-foot">
              <span>▲ 上方为讲台方向 · 左右按教室实际门窗方向标注</span>
              <span>
                标记说明：<b>前排</b>=近视照顾 <b>中间</b>=视力需中间 <b>听力</b>=听力照顾 <b>过道</b>=行动不便照顾 <b>T1/T2/T3</b>=学习分层
              </span>
            </footer>
          </div>
        )
      })}
    </div>
  )
}
