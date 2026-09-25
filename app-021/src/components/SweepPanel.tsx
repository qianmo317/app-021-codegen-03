import { useState } from 'react'
import { useStore } from '../store'
import type { ClassEntity } from '../types'
import {
  judgeWinner,
  runSweep,
  SOFT_METRICS,
  SweepToken,
  type SweepCandidate,
  type SweepProgress,
  type SweepResult,
  type SoftMetricKey,
} from '../lib/sweep'
import { Award, CheckCircle2, Crown, OctagonX, Play, Square, Trophy } from 'lucide-react'

type Phase = 'idle' | 'running' | 'done' | 'cancelled'

interface SweepState {
  phase: Phase
  total: number
  baseSeed: number
  weeks: number
  progress: SweepProgress | null
  result: SweepResult | null
  token: SweepToken | null
  adoptedSeed: number | null
}

const METRIC_LABEL: Record<SoftMetricKey, string> = {
  frontRowsRange: '前排次数极差',
  variance: '位置分偏差²',
  deskOverLimit: '同桌超次对数',
}

function fmtMetric(key: SoftMetricKey, v: number): string {
  return key === 'variance' ? v.toFixed(1) : String(v)
}

export function fmtEta(ms: number): string {
  if (ms <= 0) return '即将完成'
  const s = ms / 1000
  if (s < 10) return `约 ${Math.max(1, Math.ceil(s))} 秒`
  if (s < 60) return `约 ${Math.round(s)} 秒`
  const m = Math.floor(s / 60)
  const rest = Math.round(s % 60)
  return rest ? `约 ${m} 分 ${rest} 秒` : `约 ${m} 分钟`
}

export function SweepPanel({ cls, disabled, onAdopted }: { cls: ClassEntity; disabled: boolean; onAdopted: () => void }) {
  const store = useStore()
  const [countDraft, setCountDraft] = useState('8')
  const [state, setState] = useState<SweepState>({
    phase: 'idle',
    total: 0,
    baseSeed: cls.seed,
    weeks: cls.weeks,
    progress: null,
    result: null,
    token: null,
    adoptedSeed: null,
  })

  const count = Math.max(1, Math.min(32, Math.floor(Number(countDraft)) || 1))
  const running = state.phase === 'running'
  const noStudents = cls.students.length === 0

  const start = async () => {
    const token = new SweepToken()
    const baseSeed = cls.seed
    const weeks = cls.weeks
    const initial: SweepProgress = {
      done: 0,
      total: count,
      currentSeed: 0,
      candidates: [],
      elapsedMs: 0,
      avgMs: 0,
      etaMs: 0,
    }
    setState({ phase: 'running', total: count, baseSeed, weeks, progress: initial, result: null, token, adoptedSeed: state.adoptedSeed })
    const result = await runSweep(
      cls,
      count,
      baseSeed,
      (p) => setState((s) => (s.phase === 'running' ? { ...s, progress: p } : s)),
      token,
    )
    setState((s) => ({
      ...s,
      phase: result.status === 'cancelled' ? 'cancelled' : 'done',
      progress: null,
      result,
      token: null,
    }))
  }

  const stop = () => {
    state.token?.cancel()
  }

  const adopt = async (cand: SweepCandidate) => {
    const res = await store.applyPlan(cls.id, cand.seed, state.weeks, cand.assignments)
    if (!res.ok) return
    setState((s) => ({ ...s, adoptedSeed: cand.seed }))
    onAdopted()
  }

  const result = state.result
  const ranked = result?.ranked ?? []
  const best = result?.best ?? null
  const verdict = result && best ? judgeWinner(best, ranked) : null
  // 进行中：按完成顺序展示；结束：按综合排序
  const shown: SweepCandidate[] = state.phase === 'running' ? state.progress?.candidates ?? [] : ranked
  const feasibleRanked = ranked.filter((c) => !c.error && c.feasible)
  const colBest = (key: SoftMetricKey): number =>
    feasibleRanked.length ? Math.min(...feasibleRanked.map((c) => c.metrics[key])) : 0
  const bestFront = colBest('frontRowsRange')
  const bestVar = colBest('variance')
  const bestDesk = colBest('deskOverLimit')
  const pct = state.progress ? Math.round((state.progress.done / state.progress.total) * 100) : 0
  // 采用后 cls.seed 会变成该套种子，属预期；只有用户又手工改了种子/周数才提示旧结果
  const adopted = state.adoptedSeed !== null && cls.seed === state.adoptedSeed && cls.weeks === state.weeks
  const configChanged = result !== null && !adopted && (state.baseSeed !== cls.seed || state.weeks !== cls.weeks)

  return (
    <section className="card sweep-panel" data-testid="sweep-panel">
      <div className="sweep-head">
        <h3>
          <Trophy size={16} /> 多种子批量比选
        </h3>
        <p className="muted small">
          同一份配置一次跑多套种子，按「硬约束违反 → 前排极差 → 位置分偏差² → 同桌超次对」综合排序，自动标出最优方案。
        </p>
      </div>

      <div className="row-flex wrap">
        <label className="inline-label">
          跑几套种子
          <input
            type="number"
            min={1}
            max={32}
            className="input input-sm"
            value={countDraft}
            data-testid="sweep-count"
            disabled={running}
            onChange={(e) => setCountDraft(e.target.value)}
          />
        </label>
        <span className="muted small">基准种子 {cls.seed}（确定性派生，结果可复现）</span>
        {!running ? (
          <button
            className="btn btn-primary"
            data-testid="sweep-start"
            disabled={disabled || noStudents}
            title={noStudents ? '请先添加学生' : undefined}
            onClick={start}
          >
            <Play size={15} /> 开始比选 {count} 套
          </button>
        ) : (
          <button className="btn btn-danger" data-testid="sweep-stop" onClick={stop}>
            <Square size={13} /> 停止
          </button>
        )}
        {configChanged && <span className="warn small">种子/周数已修改，结果为旧配置，建议重新比选</span>}
      </div>

      {running && (
        <div className="sweep-progress" data-testid="sweep-progress">
          <div className="sweep-progress-bar">
            <span className="sweep-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          {state.progress && (
            <div className="row-flex wrap sweep-progress-text">
              <b data-testid="sweep-progress-count">
                {state.progress.done}/{state.progress.total} 套
              </b>
              <span className="muted small">
                {state.progress.currentSeed ? `正在跑种子 ${state.progress.currentSeed}` : '正在准备第 1 套…'}
              </span>
              <span className="spacer" />
              {state.progress.done > 0 && (
                <>
                  <span className="muted small">平均每套 {(state.progress.avgMs / 1000).toFixed(1)} 秒</span>
                  <span className="muted small" data-testid="sweep-eta">
                    剩余 {fmtEta(state.progress.etaMs)}
                  </span>
                </>
              )}
              {state.progress.done === 0 && (
                <span className="muted small" data-testid="sweep-eta">
                  剩余时间估算中…
                </span>
              )}
            </div>
          )}
          {!state.progress && <p className="muted small">正在准备第 1 套…</p>}
        </div>
      )}

      {result && best && verdict && (
        <div className="winner-card" data-testid="sweep-winner">
          <div className="winner-title">
            <Crown size={17} />
            <b>
              综合最优：种子 {best.seed}（{feasibleRanked.length} 套可行方案中第 1 名
              {result.status === 'cancelled' ? `，已停止于 ${result.candidates.length}/${result.total} 套` : ''}）
            </b>
          </div>
          <ul className="winner-points">
            <li className="good">
              <CheckCircle2 size={14} />
              <span>
                <b>好在哪：</b>
                {verdict.tied.length > 0
                  ? `${verdict.tied.map((k) => METRIC_LABEL[k]).join('、')}在 ${feasibleRanked.length} 套中最优；`
                  : '与其他方案各有所长；'}
                硬约束违反 {best.metrics.hardViolations}。
                {verdict.invariant.length > 0 && (
                  <span className="muted">
                    {' '}
                    （{verdict.invariant.map((k) => METRIC_LABEL[k]).join('、')}各套种子都一样，受固定座位等配置约束，换种子无法改变）
                  </span>
                )}
              </span>
            </li>
            {verdict.weakest ? (
              <li className="warn">
                <Award size={14} />
                <span>
                  <b>差在哪：</b>
                  {METRIC_LABEL[verdict.weakest.key]}相对最弱（{fmtMetric(verdict.weakest.key, best.metrics[verdict.weakest.key])}
                  ，{feasibleRanked.length} 套中排第 {verdict.weakest.rank} 名，并列按第 1 名计）——这是它用其他更优项换来的取舍。
                </span>
              </li>
            ) : (
              <li className="good">
                <CheckCircle2 size={14} />
                <span>
                  {verdict.tied.length === 0 && verdict.invariant.length === SOFT_METRICS.length
                    ? '三项指标各套种子完全相同，任选其一即可（本结果按种子次序选取）。'
                    : '可比的软指标全部并列第一，没有明显短板。'}
                </span>
              </li>
            )}
          </ul>
          <div className="winner-actions">
            <button
              className="btn btn-primary"
              data-testid="sweep-adopt-best"
              disabled={state.adoptedSeed === best.seed}
              onClick={() => adopt(best)}
            >
              <CheckCircle2 size={15} />
              {state.adoptedSeed === best.seed ? '已采用为当前结果' : '一键采用这套'}
            </button>
            {state.adoptedSeed !== null && state.adoptedSeed !== best.seed && (
              <span className="muted small">当前采用的是种子 {state.adoptedSeed} 那套</span>
            )}
          </div>
        </div>
      )}

      {result && result.candidates.length === 0 && (
        <div className="sweep-warn" data-testid="sweep-empty">
          <OctagonX size={15} />
          已在第 1 套完成前停止，没有可展示的方案；再次点击「开始比选」即可。
        </div>
      )}

      {result && !best && result.candidates.length > 0 && (
        <div className="sweep-warn" data-testid="sweep-no-best">
          <OctagonX size={15} />
          {result.candidates.some((c) => c.error)
            ? '已完成的方案均未能成功生成，请检查座位图与硬约束配置（容量是否足够）。'
            : '已完成的方案都存在硬约束违反，没有可采用的可行方案，请放宽约束后再试。'}
        </div>
      )}

      {shown.length > 0 && (
        <div className="table-wrap sweep-table-wrap">
          <table className="table sweep-table" data-testid="sweep-table">
            <thead>
              <tr>
                <th>名次</th>
                <th>种子</th>
                <th className="num">硬约束违反</th>
                <th className="num">前排次数极差</th>
                <th className="num">位置分偏差²</th>
                <th className="num">同桌超次对数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c, i) => {
                const isBest = state.phase !== 'running' && best === c
                const rank = state.phase === 'running' ? '…' : i + 1
                if (c.error) {
                  return (
                    <tr key={c.seed} className="sweep-row-failed" data-testid="sweep-row">
                      <td>{rank}</td>
                      <td>{c.seed}</td>
                      <td colSpan={4} className="bad">
                        生成失败：{c.error}
                      </td>
                      <td>
                        <span className="muted small">不可采用</span>
                      </td>
                    </tr>
                  )
                }
                const m = c.metrics
                return (
                  <tr
                    key={c.seed}
                    className={isBest ? 'sweep-row-best' : !c.feasible ? 'sweep-row-hard' : ''}
                    data-testid="sweep-row"
                    data-seed={c.seed}
                  >
                    <td>
                      {isBest ? (
                        <span className="rank-crown">
                          <Crown size={13} /> {rank}
                        </span>
                      ) : (
                        rank
                      )}
                    </td>
                    <td className="sweep-seed">{c.seed}</td>
                    <td className={`num ${m.hardViolations === 0 ? 'good' : 'bad'}`} data-testid="sweep-hard">
                      {m.hardViolations === 0 ? '0' : m.hardViolations}
                    </td>
                    <td className={`num ${c.feasible && m.frontRowsRange === bestFront ? 'cell-best' : ''}`}>
                      {m.frontRowsRange}
                    </td>
                    <td className={`num ${c.feasible && Math.abs(m.variance - bestVar) < 1e-9 ? 'cell-best' : ''}`}>
                      {m.variance.toFixed(1)}
                    </td>
                    <td className={`num ${c.feasible && m.deskOverLimit === bestDesk ? 'cell-best' : ''}`}>
                      {m.deskOverLimit}
                    </td>
                    <td>
                      {state.phase === 'running' ? (
                        <span className="muted small">—</span>
                      ) : (
                        <button
                          className="btn btn-sm"
                          data-testid="sweep-adopt"
                          disabled={!c.feasible || state.adoptedSeed === c.seed}
                          onClick={() => adopt(c)}
                        >
                          {state.adoptedSeed === c.seed ? '已采用' : '采用'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {shown.length > 0 && state.phase !== 'running' && (
        <p className="muted small sweep-footnote" data-testid="sweep-footnote">
          高亮格 = 该列全场最优值：可横向对比出某套是「前排更平」还是「同桌重复更少」的取舍；
          {result?.status === 'cancelled' ? '本次为中途停止后的部分结果。' : '名次相同口径下可复现。'}
        </p>
      )}
    </section>
  )
}
