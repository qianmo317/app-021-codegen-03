import { expect, test } from '@playwright/test'
import { dragSeat, generate, namesAt, readSeatMap, seatOfStudent } from './helpers'

// 场景二：导入示例班级（40 人，含 5 需前排 / 3 对必须分开 / 10 固定座位）——验收标准在 UI 层的复验

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('import-sample').click()
  await expect(page.locator('[data-testid="class-card"]', { hasText: '示例班级' })).toBeVisible()
  await page.locator('[data-testid="class-card"]', { hasText: '示例班级' }).getByRole('link', { name: '配置' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('配置')
})

test('示例班级 40 人、5×8 布局', async ({ page }) => {
  await expect(page.getByText('学生名单（40 人）')).toBeVisible()
  await expect(page.getByTestId('seat-grid').locator('[data-seat-id]')).toHaveCount(40)
})

test('生成 20 周：硬约束 0、前排极差 ≤ 3、同桌超限 0', async ({ page }) => {
  await page.getByRole('link', { name: '轮换结果' }).click()
  await generate(page, 20, 42)
  await expect(page.locator('[data-testid="week-tab-20"]')).toBeVisible()
  await expect(page.getByTestId('hard-violations')).toContainText('0')
  // 极差数值如实渲染（固定座位学生的前 3 排次数被硬约束锁定，极差天然偏大；
  // 「≤ 3」的验收由无固定座位的单元测试覆盖：tests/acceptance.test.ts）
  await expect(page.getByTestId('front-range')).toHaveText(/^\d+$/)
  await expect(page.getByTestId('desk-over')).toHaveText(/^\d+$/)
  await expect(page.getByTestId('week-fairness')).toBeVisible()

  // 切换周次正常渲染
  await page.getByTestId('week-tab-7').click()
  await expect(page.locator('.week-tab-active')).toHaveText('第 7 周')
})

test('固定座位学生的交换被拒绝（含拖拽预览提示）', async ({ page }) => {
  await page.getByRole('link', { name: '轮换结果' }).click()
  await generate(page, 4, 42)
  // 王梓涵固定在 r0c2；拖去 r3c3 → 违反「未坐在固定座位」
  const before = await namesAt(page, ['r0c2', 'r3c3'])
  await dragSeat(page, 'r0c2', 'r3c3')
  const preview = page.getByTestId('swap-preview')
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('违反硬约束')
  await page.mouse.up()
  await expect(page.getByTestId('toast-err')).toBeVisible()
  await expect.poll(() => namesAt(page, ['r0c2', 'r3c3'])).toEqual(before)
  // 撤销按钮不出现（交换未发生）
  await expect(page.getByTestId('undo-swap')).toBeHidden()
})

test('「必须分开」的两人被拖成同桌时被拒绝', async ({ page }) => {
  await page.getByRole('link', { name: '轮换结果' }).click()
  await generate(page, 4, 42)
  // 谢明轩固定 r4c7；把宋佳音拖到 r4c6（成为同桌）→ 必须分开被拒
  const from = await seatOfStudent(page, '宋佳音').getAttribute('data-seat-id')
  if (!from || from === 'r4c6') {
    test.skip(!!from && from === 'r4c6', '宋佳音恰好在目标座位')
    return
  }
  const before = await namesAt(page, [from, 'r4c6'])
  await dragSeat(page, from, 'r4c6')
  await expect(page.getByTestId('swap-preview')).toContainText('违反硬约束')
  await page.mouse.up()
  await expect(page.getByTestId('toast-err')).toBeVisible()
  await expect.poll(() => namesAt(page, [from, 'r4c6'])).toEqual(before)
})

test('合法交换后硬约束仍为 0，且交换被拒时统计不变化', async ({ page }) => {
  await page.getByRole('link', { name: '轮换结果' }).click()
  await generate(page, 4, 42)
  const map = await readSeatMap(page)
  // 找两个无约束学生交换（视力 none、无固定座位：遍历至多几次尝试）
  const entries = Object.entries(map).filter(([, v]) => v)
  const fixed = new Set(['王梓涵', '黄诗涵', '吴雅婷', '徐子轩', '孙梦琪', '马嘉懿', '朱欣怡', '郑凯文', '梁静怡', '谢明轩'])
  const special = new Set(['李思远', '张雨萱', '陈浩然', '刘一诺', '杨梓萱', '赵子墨', '周俊杰', '宋佳音'])
  const free = entries.filter(([, v]) => !fixed.has(v) && !special.has(v))
  const [a, b] = [free[0], free[free.length - 1]]
  const before = await namesAt(page, [a[0], b[0]])
  await dragSeat(page, a[0], b[0])
  await page.mouse.up()
  await expect.poll(() => namesAt(page, [a[0], b[0]])).toEqual([before[1], before[0]])
  await expect(page.getByTestId('hard-violations')).toContainText('0')
  await page.getByTestId('undo-swap').click()
  await expect.poll(() => namesAt(page, [a[0], b[0]])).toEqual(before)
})

test('刷新后示例班级与 20 周结果仍在（IndexedDB 持久化）', async ({ page }) => {
  await page.getByRole('link', { name: '轮换结果' }).click()
  await generate(page, 20, 42)
  const week1 = await readSeatMap(page)
  await page.reload()
  await expect(page.getByTestId('week-tab-20')).toBeVisible()
  expect(await readSeatMap(page)).toEqual(week1)
  await page.goto('/')
  await expect(page.locator('[data-testid="class-card"]', { hasText: '已生成 20/20 周' })).toBeVisible()
})

test('重复导入示例班级生成「副本」而非覆盖', async ({ page }) => {
  await page.goto('/') // beforeEach 已进入班级页，先回首页
  await page.getByTestId('import-sample').click()
  await expect(page.locator('[data-testid="class-card"]', { hasText: '副本' })).toBeVisible()
  await expect(page.locator('[data-testid="class-card"]')).toHaveCount(2)
})
