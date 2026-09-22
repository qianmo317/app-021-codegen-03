# 教室座位轮换编排 · Classroom Seating Rotation

> 类型：前端 Web 应用（纯前端）｜难度：★★★★｜技术栈：**React 18 + TypeScript + Vite**（手写 CSS；运行时依赖仅 `react` / `react-dom` / `lucide-react`）

## 1. 一句话简介
按周排出整学期（默认 20 周）的座位表：近视的靠前、固定座位与「必须分开」强制满足，同时给出逐人公平性统计与每周一页的 A4 打印座位表。

## 2. 真实场景与痛点
- 班主任每两三周手工换座，40 人的班排一次要半小时，还容易把近视的学生漏到后排。
- 家长会问「为什么我家孩子老坐边上」——手工排座拿不出可解释的依据。
- 有些约束是硬的：固定座位（行动不便的学生）、两个爱说话的学生不能同桌；手工排经常顾此失彼。
- 「同桌不要老是同一个人」人工跟踪不了，一学期下来没人记得谁和谁坐过。

## 3. 目标用户
- 中小学班主任（主要用户，一人管一个 30~50 人的班）。
- 年级组长 / 教务（需要统一口径说明座位公平性）。
- 家长（查看公平性统计 CSV 作为依据）。

## 4. 核心功能（MVP）
1. **班级与座位图**：行数、列数（各 2~12）、过道位置（第 i|i+1 列之间，可多条）、门的方向（左/右，窗在另一侧）、布局模式（行列排座 / 小组围坐）；座位自动标注 `front` / `middle` / `back`（按 1/3 行）、`window`、`door`、`aisle`，小组模式额外带 `group:G{n}`。
2. **学生名单**：姓名、身高、视力（`none` / `front_required` / `middle_required`）、特殊需求（`hearing` / `mobility`）、学习分层 T1~T3、必须分开的对象列表、固定座位、备注；支持逐条弹窗编辑与「批量粘贴」（每行 `姓名,身高,备注`，逗号 / 中文逗号 / 制表符分隔，重名跳过）。
3. **配置校验**：生成前跑 `validateClass()`，把「学生多于座位」「固定座位冲突」「前排 / 中间列 / 靠过道容量不足」「固定座位与学生自身需求冲突」等以人话列在 Setup 页顶部。
4. **轮换生成**：填入周数（1~52，默认 20）与种子，一次生成第 1..N 周；同参数 + 同种子结果完全一致（可复现）。
5. **手工微调**：在某一周拖拽两个座位交换，拖拽途中实时显示「位置分偏差² 前后值 / 重复同桌对前后值 / 是否违反硬约束」；违反硬约束的交换被拒绝并给出原因；合法交换可一键撤销。
6. **增量重排**：`重新生成本周`（其余周不变）与 `从本周起重排`（早于该周的周次保持不变），两个入口都在轮换页生成面板上。
7. **公平性报告**：逐人统计前 N 排次数、前 / 中 / 后 1/3 行次数、中间列次数、平均位置分、最常同桌与同桌次数；全班汇总硬约束违反数、前 N 排次数极差、位置分 Σ偏差²、同桌超 2 次的对、身高序违背。
8. **导出与打印**：按周座位表 CSV、公平性统计 CSV（带 BOM，Excel 直接打开）；打印页按周渲染 A4 纵向座位表，含讲台方向条与标记说明页脚。

## 5. 进阶功能
- 座位特殊标记（`stage_side` 讲台侧）的界面化标注。
- 多套种子对比择优（目前只能「换种子」逐个看）。
- 学期中转入 / 转出学生的局部重排（现在改名单会清空已生成结果，需整体重新生成）。
- 打印页的缩放与「一页放不下」自动续页。

## 6. 页面结构
```
/                          班级列表（新建 / 导入示例班级 40 人 / 删除）
/class/:id/setup           座位布局 + 硬性约束 + 学生名单（无子路径时的默认页）
/class/:id/rotations       轮换结果（生成面板、周次切换、拖拽微调、侧栏统计）
/class/:id/fairness        公平性报告（汇总卡片、占比条形图、逐人表格、导出 CSV）
/class/:id/print           打印座位表（全部周 / 单周，A4 纵向，每周一页）
```
路由是自写的 `useSyncExternalStore` + `history.pushState`（`src/router.tsx`），不引入第三方路由库；无法匹配的路径渲染「页面不存在」。

## 7. 数据模型
```ts
type SeatTag = 'front'|'middle'|'back'|'aisle'|'window'|'door'|'stage_side'
type Vision  = 'none'|'front_required'|'middle_required'
type Special = 'hearing'|'mobility'

interface Seat    { id: string /* r{row}c{col} */; row: number /* 0 = 最靠讲台 */; col: number; group?: string; tags: SeatTag[] }
interface Student { id: string; name: string; heightCm?: number; vision: Vision; special?: Special[];
                    tier?: 1|2|3; mustApartFrom: string[]; fixedSeatId?: string; note?: string }
interface Constraints  { frontRows: number; heightRule: boolean; mixTiers: boolean }
interface LayoutConfig { rows: number; cols: number; aisles: number[]; mode: 'rows'|'groups'; doorSide: 'left'|'right' }
interface Assignment   { week: number; map: Record<SeatId, StudentId>; score: { fairness: number; repeats: number } }
interface ClassEntity  { id: string; name: string; createdAt: number; updatedAt: number; layout: LayoutConfig;
                         seats: Seat[]; students: Student[]; constraints: Constraints;
                         weeks: number; seed: number; assignments: Assignment[] }
class InfeasibleError extends Error {}
```
新建班级默认值：`rows:6, cols:7, aisles:[3], mode:'rows', doorSide:'right'`，`frontRows:2, heightRule:true, mixTiers:true`，`weeks:20, seed:42`（`src/store.tsx:89-95`）。持久化用 IndexedDB（库名 `app-021-seating`、对象仓 `classes`、`keyPath:'id'`）；无 `indexedDB` 时退化为内存实现（`src/lib/storage.ts:23-24,66`）。所有业务逻辑集中在 `StoreProvider`，页面只做展示与派发（`src/store.tsx:15`）。

## 8. 关键算法
- **位置分**：`positionScore(seat) = rowWeight + middleWeight`，`rowWeight = row/(rows-1)*2 ∈ [0,2]`，`middleWeight = |col-(cols-1)/2| / ((cols-1)/2) ∈ [0,1]`，**分数越低位置越好**（`src/lib/layout.ts:52-57`）。中间列集合取到中轴距离不超过半宽一半的连续块（`layout.ts:61-68`）。
- **约束模型**：个体硬约束为视力需前排（`row < frontRows`）、视力需中间列、听力需前一半排（`ceil(rows/2)`）、行动不便需靠过道（座位 `aisle` 或首末列）、固定座位；成对硬约束为「必须分开」不得同桌。硬约束在代价函数中用 `HARD = 1e7` 表示，等价于禁止（`src/lib/engine.ts:11,115-138`）。
- **代价常量**：`W_HEIGHT = 4`（身高序违背）、`W_MIX = 2`（同桌同分层）、`FRESH_PAIR = 0.3`（新同桌微奖励），同桌第 1 / 2 / 3 次重复为 `REPEAT1 = 3`、`REPEAT2 = 60`、`REPEAT3 = 500`（`engine.ts:12-17`）；同桌对用 `pairKey(a,b) = a*4096+b` 编码（`engine.ts:110-112`）。
- **初始分配**：固定座位学生先落位；其余学生按「可行座位数从少到多」贪心，每人在可行座位中随机挑一个；无可行座位时抛 `InfeasibleError` 并说明是哪一类座位不足（`engine.ts:179-223`）。
- **模拟退火**：`iters = min(60000, max(15000, n*400))`，温度从 `T0 = 3.0` 按几何下降 `T = T0·(T1/T0)^(it/iters)` 到 `T1 = 0.02`；每步随机取一个非固定学生与一个随机座位做移动 / 交换，`Δ ≤ 0` 或 `rand < exp(-Δ/T)` 时接受（`engine.ts:468-492`）。退火后最多 200 轮贪心修复残余硬约束（`engine.ts:495-526`）；单周最多重试 `MAX_ATTEMPTS = 6` 次，仍不可行则抛错（`engine.ts:19,573-585`）。
- **公平性目标**：最小化每人累计位置分的偏差平方和，同时最小化每人「前 N 排」次数相对理想值 `idealF = weeks × frontSeats / n` 的偏差平方和（`engine.ts:270,324-342`）。
- **可复现与增量**：随机源为 `mulberry32` + `hashSeed(seed, week, attempt)`，生成路径不使用 `Math.random`（`src/lib/rng.ts`）；`generatePlan` / `regenerateFrom` / `regenerateSingleWeek` / `generateMissingWeeks` 通过 `buildHistory()` 复用已生成周次的累计位置分、前排计数与同桌次数，保证重排不影响目标周次之外的结果（`engine.ts:148-176,590-640`）。
- **公平性报告**：`variance = Σx² − (Σx)²/n`，`std = sqrt(variance/n)`；位置分按 `positionScore` 累计，前 N 排次数按 `row < frontRows` 计，前 / 中 / 后按 1/3 行划分；同桌重复按无向对去重统计，`count > 2` 进入超限列表（`src/lib/fairness.ts:132-253`）。手工交换前用 `previewSwap()` 复用同一套判定，违反数为 0 才允许提交（`fairness.ts:267-292`、`store.tsx:197-198`）。

## 9. 交互与视觉要点
- 座位图用 CSS Grid 渲染，过道位置插入 14px 斜纹空隙列；座位底色区分前 / 中 / 后排，靠窗用左侧内阴影、靠门用右侧内阴影，空位为虚线（`src/components/SeatGrid.tsx:22-35`、`src/styles.css:146-161`）。
- 学生徽章不单靠颜色：近视「前排」、需中间「中间」、听力、过道、T1~T3、固定座位各有图标 + 文字，图标来自 lucide-react（`SeatGrid.tsx:131-162`）。
- 拖拽用 HTML5 DnD，但拖拽源座位记录在组件内 `ref` 而非 `dataTransfer`——protected mode 下 dragover 阶段 `getData()` 返回空串，否则实时预览永远不会出现（`SeatGrid.tsx:40-42,49-74`）。
- 交换预览是固定底部的深色条：显示两人姓名、位置分偏差² 前后值与增减、重复同桌对前后值、硬约束通过与拒绝原因；被拒时变深红（`src/pages/Rotations.tsx:289-309`、`styles.css:193-199`）。
- 顶栏固定提示「数据仅保存在本机浏览器 · 不上传任何学生信息」；打印路径下隐藏顶栏（`src/App.tsx:22-30`）。
- 打印态座位图放大字号（姓名 15pt），每周带标题、讲台方向条与标记说明页脚；`@page { size: A4 portrait; margin: 8mm }`，每周 `page-break-after: always`（`styles.css:255-282`）。
- 响应式：900px 以下侧栏折到座位图下方，600px 以下压缩顶栏与座位尺寸（`styles.css:284-298`）。

## 10. 验收标准
- **硬约束**：100 组随机配置（4~6 排 × 6~8 列、5 名需前排、2 名需中间、1 名听力、3 对必须分开、10 个固定座位，种子 1~100）× 20 周，`weekHardViolations` 总数必须为 0（`tests/acceptance.test.ts:8-25`）。
- **公平性**：40 人 5×8、前 3 排、种子 42、20 周，前 3 排次数极差 ≤ 3 且硬约束违反为 0（`tests/acceptance.test.ts:27-37`）。
- **同桌重复**：同配置 20 周，同桌超 2 次的对必须为 0（`tests/acceptance.test.ts:39-47`）。
- **边界容量**：30 人坐 40 座（含空位）生成 8 周，每周映射恰好 30 条且硬约束违反为 0（`tests/acceptance.test.ts:49-59`）。
- **可复现与性能**：同种子结果完全一致、不同种子第 1 周不同（`tests/engine.test.ts:12-26`）；40 人 × 20 周生成耗时 < 1000ms（`tests/engine.test.ts:153-163`）。
- **测试规模**：vitest 30 个用例（acceptance 4 / engine 15 / layout 5 / rng 3 / csv 2 / storage 1），Playwright 13 个用例（journey 6 / sample 7）；E2E 针对 `vite preview`（4173）运行（`vitest.config.ts`、`playwright.config.ts`）。
- **E2E 关键断言**：示例班级 40 人、5×8；生成 20 周后硬约束显示 0；固定座位学生被拖走时预览提示「违反硬约束」且座位不变；合法交换后硬约束仍为 0 且可撤销；刷新后 20 周结果与座位图完全一致（IndexedDB 持久化）；重复导入示例班级生成「副本」而非覆盖（`e2e/sample.spec.ts`）。

## 11. 边界（刻意不做）
不做排课表与教师课务、不做成绩录入与查询、不做考勤点名、不做家长端应用与消息推送、不做账号体系与云同步——核心只做**座位编排 + 公平性统计 + 导出打印**，全部数据留在本机浏览器。

### 已知实现边界（README 声称 vs 代码实现）
- README 功能 §3 把「身高排序（高个靠后）」列入硬性约束并称「违反数为 0」，实际代码里它是**软惩罚**：`W_HEIGHT = 4` 只进入退火代价（`engine.ts:12,429`），不参与 `HARD` 判定，公平性报告另算 `heightViolations`（`fairness.ts:178-195`、`Fairness.tsx:99-104`），因此可能大于 0。
- README 算法节写「任意两人同桌 ≤ 2 次」，实际是软目标：第 3 / 4 次同桌的惩罚为 `REPEAT2 = 60` / `REPEAT3 = 500`（`engine.ts:16-17`），不是禁止级；示例班级配置下验收为 0（`tests/acceptance.test.ts:45`），但不构成数学保证。
- README 算法节称「均衡每人前 N 排次数，极差 ≤ 3」：该断言只在**无固定座位**的用例中被断言（`tests/acceptance.test.ts:29-34`）；示例班级含 10 个固定座位时 E2E 只校验数值如实渲染，测试注释也写明固定座位会把极差拉大（`e2e/sample.spec.ts:24-27`）。
- `generateMissingWeeks()`（周数调大后补齐缺失周次）在引擎与 store 中已实现，`RegenMode` 也含 `'missing'`（`store.tsx:17,178-180`），但轮换页的 `regen()` 只暴露 `all` / `from` / `week` 三种模式（`Rotations.tsx:45`），UI 无补齐入口。
- `SeatTag` 的 `stage_side` 在 `buildSeats()` 中从不生成，`Seat.group` 字段也从不写入（分组信息实际放在 `tags` 的 `group:G{n}` 里）；Setup 页只在说明文字里提到「讲台侧等特殊座位标记可在需求中补充说明」（`layout.ts:10-29`、`Setup.tsx:208-212`）。
- 「撤销上次交换」是**单级**的：`undoRef` 只保留最近一次交换（`store.tsx:57,207,220-237`），连续交换两次只能撤销最后一次。
- README 隐私节称「没有任何网络请求」：唯一请求是同源静态读取 `GET /samples/demo-class.json`（`store.tsx:106`），不发送任何学生数据，但并非零请求。
- `engine.ts` 顶注称「全程不使用 Math.random」，同文件的 `randomSeed()` 确实调用了 `Math.random`（`engine.ts:642-645`）；它只服务于「换种子」按钮，不进入生成路径，不影响可复现性。
- 打印「每周一页」依赖 CSS 分页（`styles.css:272-282`），没有内容溢出时的自动缩放或续页处理；行 × 列取到 12×12 时单页可能放不下。
- README 的镜像体积（约 22MB）无法从仓库静态核验，本次未做实测。

## 12. 容器化与构建（Docker）

- **Dockerfile**：多阶段，`node:20-alpine` 中先拷 `package.json` + `package-lock.json` 跑 `npm ci`，再 `COPY . .` 执行 `npm run build`；运行阶段 `nginx:1.27-alpine`，只拷 `dist/`（`Dockerfile:8-17,53`）。
- **nginx 配置**：因 `.dockerignore` 排除了仓库根的 `nginx.conf`，运行时配置由 Dockerfile 内嵌 heredoc 写入 `/etc/nginx/conf.d/default.conf`，两处内容一致、修改需同步（`Dockerfile:3-4,21-52`、`nginx.conf:2-3`）。
- **docker-compose.yml**：服务名与容器名 `app-021`，镜像 `app-021-classroom-seating-rotation`，端口 **`8101:80`**，`restart: unless-stopped`；`healthcheck` 每 30s 请求 `http://127.0.0.1/healthz`，超时 3s、`start_period` 5s、重试 3 次（`docker-compose.yml:1-14`）。
- **健康检查路径**：`location = /healthz` 返回 `200 'ok\n'` 且 `access_log off`（`nginx.conf:14-19`、`Dockerfile:33-38`）；镜像内 `HEALTHCHECK` 用 `wget -qO-` 做同样探测（`Dockerfile:55-57`）。
- **静态策略**：`/assets/` 哈希资源 `Cache-Control: public, max-age=31536000, immutable` 且缺失即 404；其余路径 `no-cache` + `try_files $uri $uri/ /index.html` 做 SPA 回退；gzip 级别 6、最小 1024 字节，覆盖 `text/plain text/css application/javascript application/json image/svg+xml`（`nginx.conf:9-31`）。
- **无外部依赖**：字体走系统字体栈（PingFang SC / Microsoft YaHei 等，`styles.css:21-23`），无外网 CDN；无后端，断网可用。

```bash
cd app-021
docker compose up -d --build
curl http://localhost:8101/healthz        # → ok
# 浏览器验收：http://localhost:8101
docker compose down
```

- 本地开发与测试：`npm run dev`（5173）、`npm run build`（`tsc --noEmit && vite build`）、`npm run preview`（4173）、`npm test`（vitest）、`npm run test:e2e`（Playwright，首次需 `npx playwright install chromium`）。
- **容器验收**：`http://localhost:8101` 完成「新建班级 → 录学生与约束 → 生成 20 周 → 拖拽微调 → 看公平性报告 → 打印」；刷新后数据仍在（IndexedDB）。

### 忽略文件（.dockerignore / .gitignore）

- **`.dockerignore`**：`node_modules`、`dist`、`.git`、`.gitignore`、`.env`、`.env.*`、`*.log`、`coverage`、`.vscode`、`.idea`、`Dockerfile`、`nginx.conf`、`README.md`、`e2e`、`tests`、`playwright.config.ts`、`vitest.config.ts`、`test-results`、`playwright-report`；**保留** `package-lock.json` 与 `public/samples/demo-class.json`（示例数据随镜像发布，E2E 依赖它）。
- **`.gitignore`**：`node_modules/`、`dist/`、`.env`、`.env.*`、`*.log`、`coverage/`、`.DS_Store`、`.vscode/`、`.idea/`，另排真实学生名单与导出文件 `classes/`、`exports/`、`*.xlsx`（未成年人信息绝不入库）。
- **自检**：构建上下文 < 5MB；`git status` 不出现 `.env`、`dist/`、学生名单与导出的 CSV。
