# 第一版验收记录

> 依据：[PRD.md](PRD.md) 第 10 节
> 记录日期：2026-11-13
> 运行方式：`npm run test:all`（类型检查、代码检查、138 个单元与接口测试、构建、29 个端到端测试），全部通过。

## 说明

- **端到端测试**：用 Playwright 驱动本机安装的 Microsoft Edge，连接真实的本地服务，每次使用临时数据文件夹，不碰你的真实数据。
- **AI 相关测试**：使用内置的「测试 AI」，它会给出固定的回答，用来检查整个流程。另外用一个本地模拟服务器验证了真实的通义千问客户端：请求格式、联网搜索参数、来源解析、错误处理。
- **尚未验证的部分**：还没有用真实的通义千问 Key 联调。这需要你在 Settings → AI model 里填入自己的 Key。真实模型返回的菜谱质量、来源链接是否齐全，要以联调结果为准。

## 逐条结果

| # | 验收标准（简述） | 结果 | 对应测试 |
|---|---|---|---|
| 1 | 添加后刷新，数据一致 | 通过 | `e2e/fridge.spec.ts` 数据跨浏览器配置保留；`server/test/fridge-api.test.ts` persistence |
| 2 | 关浏览器、停服务、重启后数据一致 | 通过 | `server/test/process.test.ts`：强制结束真实服务进程后重启，数据仍在 |
| 3 | 清除浏览器缓存后库存仍在 | 通过 | `e2e/fridge.spec.ts`：新浏览器配置 + 清空 localStorage、Cookie |
| 4 | 断网时各项库存操作正常 | 通过 | `e2e/ai.spec.ts` offline：添加、搜索、撤销、消耗、调料都正常 |
| 5 | 断网快速添加：正常入库、日期正确、显示 No suggestion available | 通过 | `e2e/ai.spec.ts` offline；`server/test/ai-api.test.ts` |
| 6 | 断网进入 AI cook 有清楚提示，Fridge 正常 | 通过 | `e2e/cook.spec.ts` unreachable；`server/test/cook-api.test.ts` |
| 7 | 首次引导：选够 6～8 种才能提交，只进常用区不进库存 | 通过 | `e2e/fridge.spec.ts` onboarding；`server/test/fridge-api.test.ts` |
| 8 | 搜番茄、西红柿、tomato 都找到 Tomato，salt 找到调料 | 通过 | `e2e/fridge.spec.ts`；`packages/core/test/search-favorites-servings.test.ts` |
| 9 | 首次添加弹单位选择，点一下加 1 个 / 100 g | 通过 | `e2e/fridge.spec.ts`；`server/test/fridge-api.test.ts` |
| 10 | Undo 后库存恢复 | 通过 | `e2e/fridge.spec.ts` undo；`server/test/fridge-api.test.ts` |
| 11 | 补货两次：合并显示，最早到期在最上，旧日期不变 | 通过 | `e2e/fridge.spec.ts` batches；`packages/core/test/batches.test.ts` |
| 12 | 500 g + 1 kg 显示 1.5 kg；个和克不相加 | 通过 | `e2e/fridge.spec.ts`；`packages/core/test/units.test.ts`；`server/test/fridge-api.test.ts` |
| 13 | 消耗超过库存时停在 0 | 通过 | `e2e/fridge.spec.ts` use；`packages/core/test/batches.test.ts` |
| 14 | 明天到期显示感叹号和 Eat first，提醒数 +1；昨天到期显示 Expired，记录保留 | 通过 | `e2e/fridge.spec.ts` flagged；`packages/core/test/dates.test.ts` |
| 15 | 当天显示 Just added；3 天前显示 In fridge 3 days | 通过 | `e2e/fridge.spec.ts`；`packages/core/test/dates.test.ts` |
| 16 | 联网添加后显示 AI suggestion，可查看来源和条件，手动修改优先 | 通过（测试 AI） | `e2e/ai.spec.ts`；`server/test/ai-api.test.ts`；`server/test/ai-client.test.ts` |
| 17 | 上传小票：显示结果、可修改、确认后入库 | 通过（测试 AI） | `e2e/ai.spec.ts` receipt；`server/test/ai-api.test.ts` |
| 18 | Settings 改调料包后，一键加入加的是新组合 | 通过 | `e2e/settings.spec.ts`；`e2e/fridge.spec.ts` |
| 19 | 用法 ② 优先用临期食材，1～3 道，标注耗时 | 通过（测试 AI） | `e2e/cook.spec.ts`；`server/test/cook-api.test.ts` |
| 20 | 菜谱不出现库存没有的食材或「没有」的调料 | 通过 | `packages/core/test/recipe.test.ts`；`server/test/cook-api.test.ts` 规则检查（会重试一次，仍不通过就说明做不了） |
| 21 | 用法 ① 缺食材：Buy first 进 To cook；Cook anyway 标注缺料、只扣有的 | 通过 | `e2e/cook.spec.ts`；`server/test/cook-api.test.ts` |
| 22 | 用法 ③：选材区减少但 Fridge 不变；刷新和取消后购物车仍在 | 通过 | `e2e/cook.spec.ts` pick |
| 23 | 不点 I cooked it 库存不变；确认后先扣最早到期批次，写 History，清空购物车 | 通过 | `e2e/cook.spec.ts`；`server/test/cook-api.test.ts` |
| 24 | 首次问口味，之后不问但有修改入口 | 通过 | `e2e/cook.spec.ts` |
| 25 | To cook 点 Continue：齐了出教程，还缺再给两个选择，做完自动移除 | 通过（测试 AI） | `e2e/settings.spec.ts`；`server/test/cook-api.test.ts` |
| 26 | History 每条有菜名、时间、人数、用法、扣除明细，可展开、可删除 | 通过 | `e2e/settings.spec.ts`；`server/test/cook-api.test.ts` |
| 27 | Test connection：Key 正确显示成功，错误显示原因 | 通过（模拟） | `e2e/ai.spec.ts`；`server/test/ai-client.test.ts`（401 Key 被拒）；`server/test/ai-api.test.ts` |
| 28 | 导出的备份不含 API Key | 通过 | `server/test/backup-api.test.ts`；`e2e/settings.spec.ts` |
| 29 | 导出、修改、导入后恢复，并留下导入前的自动备份；格式错误时数据不变 | 通过 | `server/test/backup-api.test.ts`；`e2e/settings.spec.ts` |
| 30 | 窗口缩到一半宽：无横向滚动条，列数减少 | 通过 | `e2e/fridge.spec.ts` half-width |
| 31 | 业务规则有独立的自动化测试且全部通过 | 通过 | `packages/core/test/*`（64 个测试） |

## 开发中补充的行为

以下几处是开发过程中按 PRD 的意思补充的，供你检查：

- **忌口强制执行**：口味里填的「Foods to avoid」不只是提示 AI，服务端会把这些食材从可用库存里去掉，含有它们的菜谱会被拒绝。
- **重复启动**：已经在运行时再双击 `start.bat`，会直接打开浏览器，不会报错。
- **图片**：目录里的 78 种食材中有 75 种有照片（71 个图片文件，相近食材共用），均为可免费使用的授权，来源见 [CREDITS.md](CREDITS.md)。四季豆（Green beans）、鱿鱼（Squid）、蛤蜊（Clams）没有找到合适的免费照片，显示分类图标。调料不显示图片。
