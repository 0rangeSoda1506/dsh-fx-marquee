# dsh-fx-marquee · 汇率跑马灯

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）Web 插件：在输入框上方常驻一条行情跑马灯，点开任一标的看走势图，另有汇率计算器与设置页。

**English** — A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) web plugin: a live FX/market ticker strip above the composer, with click-through trend charts, a frozen-rate currency calculator, and a settings page. All data sources are keyless. Runs on Windows, macOS and Linux.

> 非官方插件，与 DeepSeek 官方无关。数据仅供个人参考，不构成投资建议。
> Unofficial plugin, not affiliated with DeepSeek. Market data is for personal reference only, not investment advice.

## 功能

**跑马灯**（会话输入框上方）

- 可自选标的：货币对、A 股/指数、加密货币混排
- 每个标的显示名称、数值、涨跌幅，可选迷你走势图
- 内容放得下时静态居中、放不下才滚动
- 点击任一标的弹出明细浮层
- 新会话未开始聊天前不显示（Hero 阶段）

**走势图**（点击标的后）

- Y 轴数值刻度（最高/中间/最低）+ 虚线网格，X 轴时间两端点
- 显示该标的所属市场的**交易时段**：市场时钟（北京/纽约/UTC）、开市状态、距开盘/收盘倒计时
- **休市时曲线转灰**

**汇率计算器**（正文区上方 Tab）

- 货币对可选 **24 个**（跑马灯里的 + 内置清单），带分组
- 汇率取**打开计算器时**的值，之后不自动变化，只有点「刷新汇率」才更新
- 结果保留两位小数；支持 `⇅` 调换方向
- 换算使用「每 1 单位」汇率，`日元/人民币` 这类按 100 单位报价的会正确换算

**设置页**（设置 → 汇率跑马灯）

- 一键开/关跑马灯（关闭即停止后台轮询）
- 19 个常用货币对 + 6 个指数/加密标的勾选，支持自定义添加
- **汇率信源可选**：自动 / 新浪财经 / ECB / ER-API
- 自动更新间隔：关闭 / 5 秒 / 10 秒 / 20 秒 / 30 秒 / 1 分钟 / 5 分钟
- 走势图开关、涨跌配色（红涨绿跌 / 绿涨红跌）、实时预览

## 数据源

全部免密钥。

| 类别 | 主源 | 更新频率 | 兜底 |
|---|---|---|---|
| 货币对 | 新浪财经 `hq.sinajs.cn` 盘中即期 | 秒级（交易时段内） | ECB 每日参考价 → open.er-api.com |
| 指数 / A 股 | 东方财富 `push2.eastmoney.com` | 交易时段内实时 | 无 |
| 加密货币 | Binance `data-api.binance.vision` | 7×24 实时 | 无 |

**各源的实际新鲜度**（实测）：

- 新浪外汇：盘中秒级推进；在岸人民币在境内交易时段（09:30–23:30）结束后会冻结
- ECB / ER-API：**每日一次**，不是实时；ECB 约 30 个币种，ER-API 覆盖 166 个
- 东方财富指数：交易日 09:30–11:30、13:00–15:00 实时，收盘后为收盘价
- Binance：7×24 实时

客户端默认每 20 秒轮询一次，宿主侧另有 25 秒缓存，所以**最坏情况下屏幕上的数字比上游旧约 45 秒**。明细浮层里会显示上游报价时间与信源，可据此判断。

## 安装

```
dsh plugin --profile web add github:0rangeSoda1506/dsh-fx-marquee
```

然后**重启 dsh 进程**（新装的插件包必须真正重启：`recompose` 不会重算已启动进程的 boot manifest，客户端 UI 不会出现）。

## 兼容性

- 在 **dsh 0.1.5-rc.1** 上开发与实测
- 客户端 half 只用浏览器标准 API，宿主 half 只用 Node 标准 API，**无平台专有代码**
- Windows / macOS / Linux 通用

## 已知限制

- **新浪外汇需要 `Referer` 头**：宿主端带上，浏览器端无法直连，因此数据统一由宿主代理
- **境外访问**：新浪、东方财富在海外可能变慢或失败；外汇会自动回退到 ECB/ER-API，**指数与加密目前没有备源**
- **Binance 在部分地区受限**（如美国），受限时该标的显示 `—`
- 指数与加密**没有兜底源**，主源不可用时该格显示 `—`
- 交易时段按市场本地时区（`Asia/Beijing` / `America/New_York`）判定，与你的机器所在时区无关

## 测试

`test/` 下是本地验证脚本，需要 Node 18+：

```bash
cd test && npm install     # jsdom + react + react-dom
node test-host.mjs         # 宿主端到端（真实上游）
node test-client2.mjs      # 客户端集成（jsdom + 真实 React）
node test-sources.mjs      # 信源选择与缓存分区
node test-series.mjs       # 走势图数据与标签对齐
```

## 许可

MIT
