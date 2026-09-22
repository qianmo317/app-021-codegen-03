import { Link, usePath } from './router'
import { ClassList } from './pages/ClassList'
import { Setup } from './pages/Setup'
import { Rotations } from './pages/Rotations'
import { Fairness } from './pages/Fairness'
import { Print } from './pages/Print'
import { useStore } from './store'
import { Armchair } from 'lucide-react'

export function App() {
  const path = usePath()
  const { ready } = useStore()

  if (!ready) {
    return <div className="loading">加载本地数据中…</div>
  }

  const printMode = /^\/class\/[^/]+\/print$/.test(path)

  return (
    <div className={printMode ? 'app app-print' : 'app'}>
      {!printMode && (
        <header className="topbar">
          <Link to="/" className="brand">
            <Armchair size={20} />
            <span>教室座位轮换编排</span>
          </Link>
          <span className="topbar-note">数据仅保存在本机浏览器 · 不上传任何学生信息</span>
        </header>
      )}
      <main className={printMode ? 'main main-print' : 'main'}>
        <Route path={path} />
      </main>
    </div>
  )
}

function Route({ path }: { path: string }) {
  if (path === '/' || path === '') return <ClassList />
  const m = path.match(/^\/class\/([^/]+)(\/(setup|rotations|fairness|print))?$/)
  if (m) {
    const id = decodeURIComponent(m[1])
    switch (m[3]) {
      case 'setup':
        return <Setup classId={id} />
      case 'rotations':
        return <Rotations classId={id} />
      case 'fairness':
        return <Fairness classId={id} />
      case 'print':
        return <Print classId={id} />
      default:
        return <Setup classId={id} />
    }
  }
  return (
    <div className="page">
      <h2>页面不存在</h2>
      <Link to="/">返回班级列表</Link>
    </div>
  )
}
