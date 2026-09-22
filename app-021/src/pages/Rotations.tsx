import { useMemo, useState } from 'react'
import { Link } from '../router'
import { useStore } from '../store'
import type { SwapPreview } from '../lib/fairness'
import { computeFairness, previewSwap, weekStats } from '../lib/fairness'
import { SeatGrid } from '../components/SeatGrid'
import { randomSeed } from '../lib/engine'
import { downloadCSV, weeksCSV } from '../lib/csv'
import { AlertTriangle, CheckCircle2, Dices, Download, Printer, RotateCcw, Undo2, Wand2 } from 'lucide-react'

export function Rotations({ classId }: { classId: string }) {
  const store = useStore()
  const cls = store.getClass(classId)
  const [week, setWeek] = useState(1)
  const [preview, setPreview] = useState<SwapPreview | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const [seedDraft, setSeedDraft] = useState<string | null>(null)
  const [weeksDraft, setWeeksDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const assignment = useMemo(() => cls?.assignments.find((a) => a.week === week), [cls, week])
  const hasPlan = !!cls && cls.assignments.length > 0
  const report = useMemo(() => (cls ? computeFairness(cls) : null), [cls])
  const weekStat = useMemo(
    () => (cls && assignment ? weekStats(cls, assignment.map, assignment.week) : null),
    [cls, assignment],
  )

  if (!cls) {
    return (
      <div className="page">
        <p>班级不存在。</p>
        <Link to="/">返回</Link>
      </div>
    )
  }
  const rep = report ?? computeFairness(cls)

  const flash = (text: string, kind: 'ok' | 'err') => {
    setToast({ text, kind })
    window.setTimeout(() => setToast(null), 3200)
  }

  const regen = async (mode: 'all' | 'from' | 'week', opts?: { seed?: number; weeks?: number }) => {
    setBusy(true)
    const res = await store.regenerate(cls.id, mode, { week, seed: opts?.seed, weeks: opts?.weeks })
    setBusy(false)
    if (!res.ok) flash(res.error ?? '生成失败', 'err')
    else {
      flash(
        mode === 'all'
          ? `已生成 ${opts?.weeks ?? cls.weeks} 周座位表`
          : mode === 'week'
            ? `已重新生成第 ${week} 周`
            : `已从第 ${week} 周起重排`,
        'ok',
      )
    }
  }

  const onDropSwap = async (from: string, to: string) => {
    setDragging(null)
    setPreview(null)
    const res = await store.swapStudents(cls.id, week, from, to)
    if (!res.ok) flash(res.error ?? '交换被拒绝', 'err')
  }

  const exportWeeks = () => {
    downloadCSV(`${cls.name}-按周座位表.csv`, weeksCSV(cls))
  }

  const seedShown = seedDraft ?? String(cls.seed)
  const weeksShown = weeksDraft ?? String(cls.weeks)

  return (
    <div className="page page-wide">
      <div className="page-head">
        <Link className="back" to="/">
          <RotateCcw size={14} /> 班级列表
        </Link>
        <h1>{cls.name} · 轮换结果</h1>
        <nav className="tabs">
          <Link className="tab" to={`/class/${cls.id}/setup`}>
            座位与学生
          </Link>
          <span className="tab tab-active">轮换结果</span>
          <Link className="tab" to={`/class/${cls.id}/fairness`}>
            公平性报告
          </Link>
          <Link className="tab" to={`/class/${cls.id}/print`}>
            打印
          </Link>
        </nav>
      </div>

      {/* 生成面板 */}
      <section className="card gen-panel" data-testid="gen-panel">
        <div className="row-flex wrap">
          <label className="inline-label">
            周数
            <input
              type="number"
              min={1}
              max={52}
              className="input input-sm"
              value={weeksShown}
              data-testid="weeks-input"
              onChange={(e) => setWeeksDraft(e.target.value)}
            />
          </label>
          <label className="inline-label">
            种子（同参数+同种子 = 结果可复现）
            <input
              type="number"
              className="input input-sm"
              value={seedShown}
              data-testid="seed-input"
              onChange={(e) => setSeedDraft(e.target.value)}
            />
          </label>
          <button
            className="btn btn-primary"
            data-testid="gen-all"
            disabled={busy}
            onClick={() =>
              regen('all', {
                seed: seedDraft !== null && seedDraft !== '' ? Number(seedDraft) : undefined,
                weeks: weeksDraft !== null && weeksDraft !== '' ? Number(weeksDraft) : undefined,
              })
            }
          >
            <Wand2 size={15} /> 生成 {weeksShown} 周
          </button>
          <button className="btn" data-testid="regen-week" disabled={busy || !hasPlan} onClick={() => regen('week')}>
            重新生成本周
          </button>
          <button className="btn" data-testid="regen-from" disabled={busy || !hasPlan} onClick={() => regen('from')}>
            从本周起重排
          </button>
          <button
            className="btn"
            title="换一个种子"
            onClick={() => {
              const s = randomSeed()
              setSeedDraft(String(s))
            }}
          >
            <Dices size={15} /> 换种子
          </button>
          <span className="spacer" />
          <button className="btn" onClick={exportWeeks}>
            <Download size={15} /> 导出 CSV
          </button>
          <Link className="btn" to={`/class/${cls.id}/print`}>
            <Printer size={15} /> 打印
          </Link>
        </div>
        {!hasPlan && (
          <p className="muted small" data-testid="no-plan-hint">
            还没有生成轮换。点击「生成 {weeksShown} 周」开始（硬约束违反数必须为 0，否则会提示原因）。
          </p>
        )}
      </section>

      {/* 周次选择 */}
      {hasPlan && (
        <div className="week-tabs" role="tablist" data-testid="week-tabs">
          {Array.from({ length: cls.assignments.length }, (_, i) => i + 1).map((w) => (
            <button
              key={w}
              role="tab"
              aria-selected={w === week}
              className={w === week ? 'week-tab week-tab-active' : 'week-tab'}
              data-testid={`week-tab-${w}`}
              onClick={() => {
                setWeek(w)
                setPreview(null)
              }}
            >
              第 {w} 周
            </button>
          ))}
        </div>
      )}

      <div className="rotations-body">
        <div className="seatmap-holder">
          {hasPlan && assignment ? (
            <div
              onDragEnd={() => {
                setDragging(null)
                setPreview(null)
              }}
            >
              <SeatGrid
                cls={cls}
                assignment={assignment}
                draggable
                onSwapPreview={(from, to) => {
                  setDragging(from || null)
                  if (!from || !to) {
                    setPreview(null)
                    return
                  }
                  setPreview(previewSwap(cls, week, from, to))
                }}
                onDropSwap={onDropSwap}
              />
            </div>
          ) : (
            <div className="empty-hint">
              <p>该周尚未生成座位表。</p>
            </div>
          )}
        </div>

        {/* 统计侧栏 */}
        <aside className="side-stats">
          <div className="card stat-card">
            <h3>第 {week} 周概览</h3>
            {weekStat ? (
              <dl>
                <div>
                  <dt>本周位置分偏差²</dt>
                  <dd data-testid="week-fairness">{weekStat.fairness.toFixed(1)}</dd>
                </div>
                <div>
                  <dt>本周与往期重复同桌对</dt>
                  <dd data-testid="week-repeats">{weekStat.repeats}</dd>
                </div>
              </dl>
            ) : (
              <p className="muted">未生成</p>
            )}
          </div>
          <div className="card stat-card">
            <h3>全计划统计（{rep.totalWeeks} 周）</h3>
            <dl>
              <div>
                <dt>硬约束违反</dt>
                <dd className={rep.hardViolations.length ? 'bad' : 'good'} data-testid="hard-violations">
                  {rep.hardViolations.length === 0 ? (
                    <>
                      <CheckCircle2 size={14} /> 0
                    </>
                  ) : (
                    <>
                      <AlertTriangle size={14} /> {rep.hardViolations.length}
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt>前 {cls.constraints.frontRows} 排次数极差</dt>
                <dd data-testid="front-range">{rep.frontRowsRange}</dd>
              </div>
              <div>
                <dt>位置分 Σ偏差²</dt>
                <dd>{rep.variance.toFixed(1)}</dd>
              </div>
              <div>
                <dt>同桌超 2 次的对</dt>
                <dd className={rep.deskmateOverLimit.length ? 'warn' : ''} data-testid="desk-over">
                  {rep.deskmateOverLimit.length}
                </dd>
              </div>
              <div>
                <dt>身高序违背</dt>
                <dd data-testid="height-violations">{rep.heightViolations}</dd>
              </div>
            </dl>
            <Link className="btn btn-sm" to={`/class/${cls.id}/fairness`}>
              查看完整报告 →
            </Link>
          </div>
          <div className="card stat-card muted small">
            <p>拖拽两个座位即可交换（违反硬约束的交换会被拒绝）；悬停时下方实时显示交换影响。</p>
            {store.canUndo(cls.id) && (
              <button className="btn" data-testid="undo-swap" onClick={() => store.undoSwap(cls.id)}>
                <Undo2 size={14} /> 撤销上次交换
              </button>
            )}
          </div>
        </aside>
      </div>

      {/* 拖拽预览 */}
      {preview && (
        <div className={`swap-preview ${preview.ok ? '' : 'swap-preview-bad'}`} data-testid="swap-preview">
          <b>
            {preview.nameA ?? '空位'} ⇄ {preview.nameB ?? '空位'}
          </b>
          <span>
            位置分偏差²：{preview.fairnessBefore.toFixed(1)} → {preview.fairnessAfter.toFixed(1)}(
            {(preview.fairnessAfter - preview.fairnessBefore >= 0 ? '+' : '') +
              (preview.fairnessAfter - preview.fairnessBefore).toFixed(1)}
            )
          </span>
          <span>
            重复同桌对：{preview.repeatsBefore} → {preview.repeatsAfter}
          </span>
          {preview.ok ? (
            <span className="good">硬约束：通过（松开鼠标完成交换）</span>
          ) : (
            <span className="bad">违反硬约束：{preview.reasons[0]}（将被拒绝）</span>
          )}
        </div>
      )}

      {toast && (
        <div className={`toast ${toast.kind}`} data-testid={toast.kind === 'err' ? 'toast-err' : 'toast-ok'}>
          {toast.text}
        </div>
      )}
      {dragging && !preview && <div className="drag-hint">拖到目标座位上可预览交换影响</div>}
    </div>
  )
}
