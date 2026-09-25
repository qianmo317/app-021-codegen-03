import { expect, test, type Page } from '@playwright/test'
import { bulkAdd, generate } from './helpers'

// 多种子优选：试跑多套种子 → 进度可见 → 指标并排 → 推荐与解释 → 一键采用

async function createClass(page: Page, name: string) {
  await page.getByTestId('new-class-name').fill(name)
  await page.getByTestId('create-class').click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${name} · 配置`)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('多种子优选：跑 3 套种子 → 排名与解释 → 采用最优', async ({ page }) => {
  await createClass(page, 'E2E 种子优选班')
  await bulkAdd(page, '李一,150\n王二,158\n赵三,140\n钱四,162\n孙五,147\n周六,155\n吴七,138\n郑八,160\n冯九,153')
  await page.getByRole('link', { name: '轮换结果' }).click()

  // 先生成 4 周（让周数配置落库，试跑按 4 周评估）
  await generate(page, 4, 42)

  // 试跑 3 套种子
  await page.getByTestId('seed-count-input').fill('3')
  await page.getByTestId('seed-search-start').click()

  // 结果表出现 3 行，推荐行与解释可见
  const rows = page.locator('[data-testid^="seed-row-"]')
  await expect(rows).toHaveCount(3, { timeout: 60_000 })
  await expect(page.getByText('推荐')).toBeVisible()
  const note = page.getByTestId('seed-best-note')
  await expect(note).toBeVisible()
  await expect(note).toContainText('推荐种子')

  // 指标表头并排展示四项指标
  const table = page.getByTestId('seed-results')
  for (const col of ['硬约束违反', '次数极差', '位置分 Σ偏差²', '同桌超 2 次的对', '综合分']) {
    await expect(table).toContainText(col)
  }

  // 一键采用最优：种子回填到生成面板，结果落库
  await page.getByRole('button', { name: '采用最优' }).click()
  await expect(page.getByTestId('toast-ok')).toBeVisible()
  const note2 = await note.textContent()
  const bestSeed = /推荐种子 (\d+)/.exec(note2!)![1]
  await expect(page.getByTestId('seed-input')).toHaveValue(bestSeed)

  // 刷新后结果仍在（已持久化）
  await page.reload()
  await expect(page.getByTestId('week-tabs')).toBeVisible()
  await expect(page.getByTestId('seed-input')).toHaveValue(bestSeed)
})
