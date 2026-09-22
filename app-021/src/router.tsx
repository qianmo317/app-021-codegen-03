import { useSyncExternalStore } from 'react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

// 极简 history 路由（不引入第三方路由库）

function subscribe(cb: () => void): () => void {
  window.addEventListener('popstate', cb)
  return () => window.removeEventListener('popstate', cb)
}

function getPath(): string {
  return window.location.pathname
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, getPath, () => '/')
}

export function navigate(to: string): void {
  if (to === window.location.pathname) return
  history.pushState({}, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string
  children: ReactNode
}

export function Link({ to, children, ...rest }: LinkProps) {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
        rest.onClick?.(e)
      }}
    >
      {children}
    </a>
  )
}
