import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

// E2E 公共操作

export function seatLoc(page: Page, seatId: string) {
  return page.locator(`[data-seat-id="${seatId}"]`)
}

export function seatOfStudent(page: Page, name: string) {
  return page.locator(`[data-student="${name}"]`)
}

/** 读取当前座位图：seatId → 学生名（空位为空串） */
export async function readSeatMap(page: Page): Promise<Record<string, string>> {
  const seats = page.locator('[data-seat-id]')
  const n = await seats.count()
  const map: Record<string, string> = {}
  for (let i = 0; i < n; i++) {
    const el = seats.nth(i)
    map[(await el.getAttribute('data-seat-id'))!] = (await el.getAttribute('data-student')) ?? ''
  }
  return map
}

export async function namesAt(page: Page, seatIds: string[]): Promise<(string | null)[]> {
  const out: (string | null)[] = []
  for (const id of seatIds) out.push(await seatLoc(page, id).getAttribute('data-student'))
  return out
}

export interface NewStudent {
  name: string
  height?: string
  vision?: 'none' | 'front_required' | 'middle_required'
  hearing?: boolean
  mobility?: boolean
  tier?: string
}

export async function addStudent(page: Page, s: NewStudent) {
  await page.getByTestId('add-student').click()
  const modal = page.getByTestId('student-modal')
  await modal.getByTestId('student-name').fill(s.name)
  if (s.height) await modal.locator('input[type="number"]').fill(s.height)
  // 弹窗内第 1 个 select = 视力
  if (s.vision) await modal.locator('select').nth(0).selectOption(s.vision)
  if (s.tier) await modal.locator('select').nth(1).selectOption(s.tier)
  if (s.hearing) await modal.getByText('听力（需前一半排）').click()
  if (s.mobility) await modal.getByText('行动不便（需靠过道）').click()
  await modal.getByTestId('student-save').click()
  await expect(page.locator(`[data-testid="student-row"][data-name="${s.name}"]`)).toBeVisible()
}

export async function bulkAdd(page: Page, text: string) {
  await page.getByRole('button', { name: '批量粘贴' }).click()
  await page.getByTestId('bulk-text').fill(text)
  await page.getByTestId('bulk-add').click()
}

/** 生成轮换并等待完成 */
export async function generate(page: Page, weeks: number, seed: number) {
  await page.getByTestId('weeks-input').fill(String(weeks))
  await page.getByTestId('seed-input').fill(String(seed))
  await page.getByTestId('gen-all').click()
  await expect(page.getByTestId('toast-ok')).toBeVisible()
  await expect(page.getByTestId('week-tabs')).toBeVisible()
}

/** 手动鼠标拖拽（可断言拖拽中途的预览） */
export async function dragSeat(page: Page, fromSeatId: string, toSeatId: string) {
  const a = await seatLoc(page, fromSeatId).boundingBox()
  const b = await seatLoc(page, toSeatId).boundingBox()
  if (!a || !b) throw new Error(`座位不存在：${!a ? fromSeatId : toSeatId}`)
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 })
}

/** 通过 class-card 名称找到班级并进入某页 */
export async function openClass(page: Page, name: string, pageName: 'setup' | 'rotations' | 'fairness' | 'print') {
  const card = page.locator('[data-testid="class-card"]', { hasText: name })
  const label = { setup: '配置', rotations: /查看轮换|开始排座/, fairness: '', print: '' }[pageName]
  if (pageName === 'setup' || pageName === 'rotations') {
    await card.getByRole('link', { name: label }).click()
  } else {
    await card.getByRole('link', { name: /配置|查看轮换|开始排座/ }).click()
    await page.getByRole('link', { name: { setup: '座位与学生', rotations: '轮换结果', fairness: '公平性报告', print: '打印' }[pageName] }).click()
  }
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
}
