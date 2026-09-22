import { useMemo } from 'react'
import { Link } from '../router'
import { useStore } from '../store'
import { computeFairness } from '../lib/fairness'
import { downloadCSV, fairnessCSV } from '../lib/csv'
import { AlertTriangle, ArrowLeft, BarChart3, CheckCircle2, Download } from 'lucide-react'

export function Fairness({ classId }: { classId: string }) {
  const { getClass } = useStore()
  const cls = getClass(classId)
  const report = useMemo(() => (cls ? computeFairness(cls) : null), [cls])

  if (!cls || !report) {
    return (
      <div className="page">
        <p>班级不存在。</p>
        <Link to="/">返回</Link>
      </div>
    )
  }

  const nameById = new Map(cls.students.map((s) => [s.id, s.name]))
  const maxWeeks = Math.max(1, report.totalWeeks)

  const exportCsv = () => downloadCSV(`${cls.name}-公平性统计.csv`, fairnessCSV(cls, report))

  return (
    <div className="page page-wide">
      <div className="page-head">
        <Link className="back" to="/">
          <ArrowLeft size={14} /> 班级列表
        </Link>
        <h1>{cls.name} · 公平性报告</h1>
        <nav className="tabs">
          <Link className="tab" to={`/class/${cls.id}/setup`}>
            座位与学生
          </Link>
          <Link className="tab" to={`/class/${cls.id}/rotations`}>
            轮换结果
          </Link>
          <span className="tab tab-active">公平性报告</span>
          <Link className="tab" to={`/class/${cls.id}/print`}>
            打印
          </Link>
        </nav>
      </div>

      <div className="explainer card">
        <h3>
          <BarChart3 size={16} /> 公平性依据（可向家长解释）
        </h3>
        <p>
          <b>位置分</b> = 前后排权重(0~2，越小越靠前) + 中间度权重(0~1，越小越靠中间)，<b>分数越低位置越好</b>。
          引擎在满足硬约束（视力/听力/行动不便/固定座位/必须分开）的前提下，最小化「每人累计位置分与平均分之差的平方和」，
          使<b>每个人坐好位置的机会均等</b>；同时统计每人「前 {cls.constraints.frontRows} 排」的次数，次数极差越小越公平。
        </p>
      </div>

      {report.totalWeeks === 0 ? (
        <div className="empty-hint">
          <p>还没有生成轮换结果。先到「轮换结果」页生成。</p>
          <Link className="btn btn-primary" to={`/class/${cls.id}/rotations`}>
            去生成
          </Link>
        </div>
      ) : (
        <>
          <div className="summary-cards" data-testid="summary-cards">
            <div className="card stat">
              <span className="stat-num" data-testid="fair-weeks">
                {report.totalWeeks}
              </span>
              <span className="stat-label">统计周数</span>
            </div>
            <div className="card stat">
              <span className={`stat-num ${report.hardViolations.length ? 'bad' : 'good'}`} data-testid="fair-hard">
                {report.hardViolations.length === 0 ? '0 ✓' : report.hardViolations.length}
              </span>
              <span className="stat-label">硬约束违反</span>
            </div>
            <div className="card stat">
              <span className={`stat-num ${report.frontRowsRange > 3 ? 'warn' : ''}`} data-testid="fair-range">
                {report.frontRowsRange}
              </span>
              <span className="stat-label">前 {cls.constraints.frontRows} 排次数极差（目标 ≤ 3）</span>
            </div>
            <div className="card stat">
              <span className="stat-num" data-testid="fair-variance">
                {report.variance.toFixed(1)}
              </span>
              <span className="stat-label">位置分 Σ偏差²</span>
            </div>
            <div className="card stat">
              <span className={`stat-num ${report.deskmateOverLimit.length ? 'warn' : ''}`} data-testid="fair-desk">
                {report.deskmateOverLimit.length}
              </span>
              <span className="stat-label">同桌超 2 次的对</span>
            </div>
            <div className="card stat">
              <span className="stat-num" data-testid="fair-height">
                {report.heightViolations}
              </span>
              <span className="stat-label">身高序违背{cls.constraints.heightRule ? '' : '（未启用）'}</span>
            </div>
          </div>

          {report.hardViolations.length > 0 && (
            <div className="card error-card">
              <h3>
                <AlertTriangle size={16} /> 违反明细（仅手工改动历史数据时可能出现）
              </h3>
              <ul>
                {report.hardViolations.slice(0, 10).map((v, i) => (
                  <li key={i}>{v.detail}</li>
                ))}
              </ul>
            </div>
          )}

          {report.deskmateOverLimit.length > 0 && (
            <div className="card warn-card">
              <h3>同桌超限报告（目标：任意两人 ≤ 2 次）</h3>
              <p>
                {report.deskmateOverLimit.map((d) => `${d.a}–${d.b}（${d.count} 次）`).join('、')}
              </p>
            </div>
          )}

          <section className="card">
            <h2 className="with-action">
              逐人统计（{cls.students.length} 人）
              <span className="spacer" />
              <button className="btn btn-primary" data-testid="export-csv" onClick={exportCsv}>
                <Download size={15} /> 导出 CSV（给家长看）
              </button>
            </h2>
            {report.totalWeeks > 0 && (
              <div className="bar-chart" data-testid="bar-chart">
                {report.rows.map((r) => (
                  <div key={r.student.id} className="bar-row" data-testid="bar-row">
                    <span className="bar-name">{r.student.name}</span>
                    <span className="bar-track">
                      <span className="bar-seg bar-front" style={{ width: `${(r.frontCount / maxWeeks) * 100}%` }} />
                      <span className="bar-seg bar-middle" style={{ width: `${(r.middleCount / maxWeeks) * 100}%` }} />
                      <span className="bar-seg bar-back" style={{ width: `${(r.backCount / maxWeeks) * 100}%` }} />
                    </span>
                    <span className="bar-nums">
                      前{r.frontCount} 中{r.middleCount} 后{r.backCount}
                    </span>
                  </div>
                ))}
                <div className="legend">
                  <em className="bar-front" /> 前排(1/3行)
                  <em className="bar-middle" /> 中排
                  <em className="bar-back" /> 后排(1/3行)
                </div>
              </div>
            )}
            <div className="table-wrap">
              <table className="table" data-testid="fairness-table">
                <thead>
                  <tr>
                    <th>姓名</th>
                    <th>身高</th>
                    <th>视力</th>
                    <th>前 {cls.constraints.frontRows} 排次数</th>
                    <th>前/中/后</th>
                    <th>中间列次数</th>
                    <th>平均位置分</th>
                    <th>最常同桌</th>
                    <th>同桌次数</th>
                    <th>警告</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => {
                    const top = r.deskmates[0]
                    return (
                      <tr key={r.student.id} data-testid="fairness-row">
                        <td>{r.student.name}</td>
                        <td>{r.student.heightCm ?? '—'}</td>
                        <td>{r.student.vision === 'none' ? '—' : r.student.vision === 'front_required' ? '需前排' : '需中间'}</td>
                        <td>{r.frontRowsCount}</td>
                        <td>
                          {r.frontCount}/{r.middleCount}/{r.backCount}
                        </td>
                        <td>{r.middleColCount}</td>
                        <td>{r.avgScore.toFixed(2)}</td>
                        <td>{top ? (nameById.get(top.studentId) ?? '') : '—'}</td>
                        <td>{top?.count ?? 0}</td>
                        <td>{r.maxDeskmateRepeat > 2 ? <span className="warn-text">同桌超限</span> : <CheckCircle2 size={13} className="good" />}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
