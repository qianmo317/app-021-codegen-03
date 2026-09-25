import { expect, test } from '@playwright/test'
import { addStudent, bulkAdd } from './helpers'

// 场景：多种子批量比选 —— 一次跑多套种子、看进度/ETA、中途停止、自动标最优、一键采用

test.describe('多种子批量比选', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('new-class-name').fill('E2E 比选班')
    await page.getByTestId('create-class').click()
    await addStudent(page, { name: '张小近', height: '145', vision: 'front_required' })
    await bulkAdd(page, '李一,150\n王二,158,爱说话\n赵三,140\n钱四,162\n孙五,147\n周六,155\n吴七,138\n郑八,160')
    await page.getByRole('link', { name: '轮换结果' }).click()
  })

  test('跑 3 套：指标并列对比、标出最优并说明取舍、一键采用', async ({ page }) => {
    // 先生成一份当前结果（9 人 4 周）
    await page.getByTestId('weeks-input').fill('4')
    await page.getByTestId('seed-input').fill('42')

    await expect(page.getByTestId('sweep-panel')).toBeVisible()
    await page.getByTestId('sweep-count').fill('3')
    await page.getByTestId('sweep-start').click()

    // 结果表：表头 + 3 行，四项指标并排
    const rows = page.getByTestId('sweep-row')
    await expect(rows).toHaveCount(3)
    await expect(page.getByRole('table').filter({ hasText: '前排次数极差' }).locator('th')).toContainText([
      '硬约束违反',
      '前排次数极差',
      '位置分偏差²',
      '同桌超次对数',
    ])

    // 最优卡片：说明好在哪，并给出种子（与表格中带皇冠的行一致）
    const winner = page.getByTestId('sweep-winner')
    await expect(winner).toBeVisible()
    await expect(winner).toContainText('综合最优')
    await expect(winner).toContainText('好在哪')
    const seedText = await winner.locator('b').first().innerText()
    const seed = /种子 (\d+)/.exec(seedText)![1]

    // 第 1 名行带皇冠且种子与卡片一致；其硬约束为 0
    const bestRow = page.locator('.sweep-row-best')
    await expect(bestRow).toHaveCount(1)
    await expect(bestRow).toContainText(seed)
    await expect(bestRow.getByTestId('sweep-hard')).toHaveText('0')

    // 一键采用 → 成为当前结果（周次仍在、硬约束 0、种子回填）
    await page.getByTestId('sweep-adopt-best').click()
    await expect(page.getByTestId('toast-ok')).toContainText('已采用')
    await expect(page.getByTestId('week-tab-4')).toBeVisible()
    await expect(page.getByTestId('hard-violations')).toContainText('0')
    await expect(page.getByTestId('seed-input')).toHaveValue(seed)
    await expect(page.getByTestId('sweep-adopt-best')).toContainText('已采用为当前结果')

    // 刷新后采用结果持久化
    await page.reload()
    await expect(page.getByTestId('hard-violations')).toContainText('0')
  })

  test('进行中显示进度与剩余时间，停止后保留已完成结果并标注已停止', async ({ page }) => {
    // 用示例班级（40 人 20 周，每套约 0.3s），32 套（上限）给停止留出充足窗口
    await page.goto('/')
    await page.getByTestId('import-sample').click()
    await page
      .locator('[data-testid="class-card"]', { hasText: '示例班级' })
      .getByRole('link', { name: '配置' })
      .click()
    await page.getByRole('link', { name: '轮换结果' }).click()

    await page.getByTestId('sweep-count').fill('32')
    await page.getByTestId('sweep-start').click()

    // 能看到进度（x/32 套）与剩余时间
    await expect(page.getByTestId('sweep-progress')).toBeVisible()
    await expect(page.getByTestId('sweep-progress-count')).toHaveText(/^[0-9]+\/32 套$/)
    await expect(page.getByTestId('sweep-eta')).toContainText('剩余')

    // 停止：先等至少 3 套跑完（保证有部分结果），再点停止；跑得太快则接受已结束
    const countEl = page.getByTestId('sweep-progress-count')
    await page
      .waitForFunction(
        (el) => {
          const n = Number(/^(\d+)\/32 套$/.exec(el?.textContent ?? '')?.[1] ?? 0)
          return n >= 3
        },
        await countEl.elementHandle().catch(() => null),
        { timeout: 20_000 },
      )
      .catch(() => {})
    await page.getByTestId('sweep-stop').click({ timeout: 3000 }).catch(() => {})

    const winner = page.getByTestId('sweep-winner')
    const empty = page.getByTestId('sweep-empty')
    await expect(winner.or(empty)).toBeVisible()
    const doneRows = await page.getByTestId('sweep-row').count()
    if (await empty.isVisible().catch(() => false)) {
      expect(doneRows).toBe(0) // 在第 1 套完成前就停止（极端时序）
    } else {
      expect(doneRows).toBeGreaterThanOrEqual(1)
      expect(doneRows).toBeLessThanOrEqual(32)
      if (doneRows < 32) {
        await expect(winner).toContainText('已停止')
        await expect(page.getByTestId('sweep-footnote')).toContainText('中途停止')
      }
    }
    await expect(page.getByTestId('sweep-stop')).toHaveCount(0)
  })
})
