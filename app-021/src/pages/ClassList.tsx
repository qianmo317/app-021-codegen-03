import { useState } from 'react'
import { Link, navigate } from '../router'
import { useStore } from '../store'
import { Download, Plus, Trash2, Users, FileJson } from 'lucide-react'

export function ClassList() {
  const { classes, createClass, importSample, deleteClass } = useStore()
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const onCreate = async () => {
    if (!name.trim()) {
      setError('请输入班级名称')
      return
    }
    setError('')
    const cls = await createClass(name)
    setName('')
    navigate(`/class/${cls.id}/setup`)
  }

  const onImport = async () => {
    const cls = await importSample()
    if (!cls) setError('导入失败，请确认 public/samples/demo-class.json 存在')
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>班级列表</h1>
        <p className="muted">按周自动轮换学生座位：近视靠前、个高靠后、同桌不重复、人人有机会坐中间。</p>
      </div>

      <div className="card">
        <h2>新建班级</h2>
        <div className="row-flex">
          <input
            className="input"
            placeholder="例如：三年级 2 班"
            value={name}
            data-testid="new-class-name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onCreate()}
          />
          <button className="btn btn-primary" data-testid="create-class" onClick={onCreate}>
            <Plus size={16} /> 创建
          </button>
          <button className="btn" data-testid="import-sample" onClick={onImport}>
            <FileJson size={16} /> 导入示例班级（40 人）
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>

      {classes.length === 0 ? (
        <div className="empty-hint">
          <Users size={40} />
          <p>还没有班级。先创建一个，或导入示例班级体验完整流程。</p>
        </div>
      ) : (
        <div className="class-grid">
          {classes.map((c) => (
            <div key={c.id} className="card class-card" data-testid="class-card">
              <div className="class-card-head">
                <h3>{c.name}</h3>
                <button
                  className="icon-btn"
                  title="删除班级"
                  aria-label={`删除${c.name}`}
                  onClick={() => {
                    if (window.confirm(`确定删除「${c.name}」？该操作不可恢复。`)) deleteClass(c.id)
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <dl className="class-meta">
                <div>
                  <dt>学生</dt>
                  <dd>{c.students.length} 人</dd>
                </div>
                <div>
                  <dt>座位</dt>
                  <dd>
                    {c.layout.rows} × {c.layout.cols}
                  </dd>
                </div>
                <div>
                  <dt>轮换</dt>
                  <dd>{c.assignments.length ? `已生成 ${c.assignments.length}/${c.weeks} 周` : '未生成'}</dd>
                </div>
              </dl>
              <div className="class-card-actions">
                <Link className="btn" to={`/class/${c.id}/setup`}>
                  配置
                </Link>
                <Link className="btn btn-primary" to={`/class/${c.id}/rotations`}>
                  {c.assignments.length ? (
                    <>
                      <Download size={14} style={{ display: 'none' }} /> 查看轮换
                    </>
                  ) : (
                    '开始排座'
                  )}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card privacy-note">
        <h2>隐私承诺</h2>
        <p>
          所有学生数据只保存在你自己的浏览器（IndexedDB）中，<strong>不上传任何服务器</strong>。
          清除浏览器数据会删除名单，请谨慎操作；导出的文件请自行妥善保管。
        </p>
      </div>
    </div>
  )
}
