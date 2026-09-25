import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '../router'
import { useStore } from '../store'
import type { SwapPreview } from '../lib/fairness'
import { computeFairness, previewSwap, weekStats } from '../lib/fairness'
import { SeatGrid } from '../components/SeatGrid'
import { randomSeed } from '../lib/engine'
import { explainBest, runSeedSearch, type SearchProgress, type SeedCandidate } from '../lib/seedSearch'
import { downloadCSV, weeksCSV } from '../lib/csv'
import { AlertTriangle, CheckCircle2, Dices, Download, Play, Printer, RotateCcw, Square, Trophy, Undo2, Wand2 } from 'lucide-react'

// 运行时长格式化（进度条与预计剩余时间）
function fmtDuration(ms: number | null): string {
  if (ms === null) return '…'
  const s = Math.round(ms / 1000)
  if (s < 1) return '<1 秒'
  if (s < 60) return `${s} 秒`
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

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
  // 多种子优选
  const [seedCountDraft, setSeedCountDraft] = useState('8')
  const [searching, setSearching] = useState(false)
  const [searchProg, setSearchProg] = useState<SearchProgress | null>(null)
  const [candidates, setCandidates] = useState<SeedCandidate[] | null>(null)
  const [stopped, setStopped] = useState(false)
  const stopRef = useRef(false)
  useEffect(() => () => {
    stopRef.current = true // 离开页面时停止后台试跑
  }, [])

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

  // 各列最小值（用于在表格里高亮每项指标的最优者，方便看出取舍）
  const colMin = useMemo(() => {
    const ok = (candidates ?? []).filter((c) => c.metrics !== null)
    if (ok.length === 0) return null
    return {
      hardViolations: Math.min(...ok.map((c) => c.metrics!.hardViolations)),
      frontRange: Math.min(...ok.map((c) => c.metrics!.frontRange)),
      variance: Math.min(...ok.map((c) => c.metrics!.variance)),
      deskOver: Math.min(...ok.map((c) => c.metrics!.deskOver)),
    }
  }, [candidates])
  const bestNote = useMemo(() => (candidates ? explainBest(candidates) : null), [candidates])
  const bestCand = candidates?.find((c) => c.rank === 1) ?? null

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

  // 多种子试跑：逐种子生成 + 评估，实时刷新进度与榜单
  const runSearch = async () => {
    const count = Math.max(2, Math.min(32, Math.round(Number(seedCountDraft)) || 8))
    stopRef.current = false
    setStopped(false)
    setSearching(true)
    setCandidates(null)
    setSearchProg({ done: 0, total: count, currentSeed: null, elapsedMs: 0, etaMs: null })
    const res = await runSeedSearch(
      cls,
      count,
      randomSeed(),
      (p, ranked) => {
        setSearchProg(p)
        setCandidates(ranked)
      },
      () => stopRef.current,
    )
    setSearching(false)
    if (res.every((c) => c.metrics === null)) flash('所有种子均生成失败，请检查约束配置', 'err')
  }

  const stopSearch = () => {
    stopRef.current = true
    setStopped(true)
  }

  // 一键采用：把某套方案（含其种子）落成当前结果
  const adopt = async (cand: SeedCandidate) => {
    const assignments = cand.assignments.map((a) => ({ ...a, map: { ...a.map }, score: { ...a.score } }))
    await store.updateClass({ ...cls, seed: cand.seed, assignments })
    setSeedDraft(String(cand.seed))
    flash(`已采用种子 ${cand.seed} 的方案（${assignments.length} 周）`, 'ok')
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
            disabled={busy || searching}
            onClick={() =>
              regen('all', {
                seed: seedDraft !== null && seedDraft !== '' ? Number(seedDraft) : undefined,
                weeks: weeksDraft !== null && weeksDraft !== '' ? Number(weeksDraft) : undefined,
              })
            }
          >
            <Wand2 size={15} /> 生成 {weeksShown} 周
          </button>
          <button className="btn" data-testid="regen-week" disabled={busy || searching || !hasPlan} onClick={() => regen('week')}>
            重新生成本周
          </button>
          <button className="btn" data-testid="regen-from" disabled={busy || searching || !hasPlan} onClick={() => regen('from')}>
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

      {/* 多种子优选 */}
      <section className="card" data-testid="seed-search-panel">
        <h2>
          <Trophy size={16} /> 多种子优选
        </h2>
        <p className="muted small">
          同一份配置一次试跑多套种子，按「硬约束违反 → 前排极差 / 位置分偏差 / 同桌超次」综合排序，自动挑出最公平的一套。
        </p>
        <div className="row-flex wrap">
          <label className="inline-label">
            试跑种子数
            <input
              type="number"
              min={2}
              max={32}
              className="input input-sm"
              value={seedCountDraft}
              data-testid="seed-count-input"
              disabled={searching}
              onChange={(e) => setSeedCountDraft(e.target.value)}
            />
          </label>
          {searching ? (
            <button className="btn btn-danger" data-testid="seed-search-stop" onClick={stopSearch}>
              <Square size={14} /> 停止
            </button>
          ) : (
            <button className="btn btn-primary" data-testid="seed-search-start" disabled={busy} onClick={runSearch}>
              <Play size={15} /> 开始试跑
            </button>
          )}
          {searching && searchProg && (
            <div className="progress-wrap" data-testid="seed-search-progress">
              <div className="progress">
                <div
                  className="progress-fill"
                  style={{ width: `${searchProg.total ? (searchProg.done / searchProg.total) * 100 : 0}%` }}
                />
              </div>
              <span className="muted small">
                {searchProg.done}/{searchProg.total}
                {searchProg.currentSeed !== null && ` · 正在跑种子 ${searchProg.currentSeed}`} · 已用{' '}
                {fmtDuration(searchProg.elapsedMs)} · 预计还需 {fmtDuration(searchProg.etaMs)}
              </span>
            </div>
          )}
        </div>

        {candidates && candidates.length > 0 && (
          <>
            {stopped && (
              <p className="warn-text small" data-testid="seed-search-stopped">
                已手动停止，以下为已完成种子的结果。
              </p>
            )}
            <div className="table-wrap">
              <table className="table" data-testid="seed-results">
                <thead>
                  <tr>
                    <th>排名</th>
                    <th>种子</th>
                    <th>硬约束违反</th>
                    <th>前 {cls.constraints.frontRows} 排次数极差</th>
                    <th>位置分 Σ偏差²</th>
                    <th>同桌超 2 次的对</th>
                    <th>综合分</th>
                    <th>耗时</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) =>
                    c.metrics ? (
                      <tr key={c.seed} className={c.rank === 1 ? 'row-best' : ''} data-testid={`seed-row-${c.seed}`}>
                        <td>
                          {c.rank}
                          {c.rank === 1 && (
                            <>
                              {' '}
                              <em className="badge badge-best">推荐</em>
                            </>
                          )}
                        </td>
                        <td>{c.seed}</td>
                        <td className={colMin && c.metrics.hardViolations === colMin.hardViolations ? 'cell-best' : ''}>
                          {c.metrics.hardViolations}
                        </td>
                        <td className={colMin && c.metrics.frontRange === colMin.frontRange ? 'cell-best' : ''}>
                          {c.metrics.frontRange}
                        </td>
                        <td className={colMin && c.metrics.variance === colMin.variance ? 'cell-best' : ''}>
                          {c.metrics.variance.toFixed(1)}
                        </td>
                        <td className={colMin && c.metrics.deskOver === colMin.deskOver ? 'cell-best' : ''}>
                          {c.metrics.deskOver}
                        </td>
                        <td title="三项公平性指标归一化后的等权均值，越小越好">{c.fairScore.toFixed(2)}</td>
                        <td className="muted">{fmtDuration(c.ms)}</td>
                        <td>
                          <button
                            className={c.rank === 1 ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
                            data-testid={`seed-adopt-${c.seed}`}
                            onClick={() => adopt(c)}
                          >
                            {c.rank === 1 ? '采用最优' : '采用'}
                          </button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={c.seed} data-testid={`seed-row-${c.seed}`}>
                        <td>—</td>
                        <td>{c.seed}</td>
                        <td colSpan={5} className="bad">
                          生成失败：{c.error}
                        </td>
                        <td className="muted">{fmtDuration(c.ms)}</td>
                        <td></td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            {bestNote && bestCand && (
              <p className="small seed-best-note" data-testid="seed-best-note">
                <b>推荐种子 {bestCand.seed}</b>：{bestNote.strengths.join('；')}
                {bestNote.weakness ? `。${bestNote.weakness}` : '。'}
                绿色加粗为该项本批最优，可对比「前排更平」与「同桌重复更少」的取舍。
              </p>
            )}
          </>
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
