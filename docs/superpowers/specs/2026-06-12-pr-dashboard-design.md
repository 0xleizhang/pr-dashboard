# pr-dashboard 设计文档

日期：2026-06-12

## 1. 背景与问题

GitHub 的 email 通知不能真实反映“我是否参与”。因为很多仓库的 OWNER 是一个很大的
team group，团队级通知会把大量与本人无关的 PR 推到邮箱里，导致：

- 真正需要我关注的 PR 淹没在噪音里
- 必须逐个点开 PR 才能知道它的 review / CI / 是否被评论 等状态

## 2. 目标

做一个本地运行的网页 dashboard，只拉取**我真正参与**的 PR（4 种情况）：

1. 创建者（author）
2. 被指派（assignee）
3. 被提及（mention）
4. 实际评论过（commenter）

并在一个页面上一眼看清每个 PR 的关键状态，无需逐个点开：

- 我是以哪种方式参与的（可多种）
- Review 状态：是否 approve / changes requested / 有评论
- CI 状态：通过 / 失败 / 进行中
- 自上次查看后是否有新动态
- 点击标题直接跳转到 PR 详情

## 3. 非目标（YAGNI）

- 不做任何写操作（不评论、不 approve、不打标签）——纯只读 dashboard
- 不做多用户 / 登录系统——单人本机使用
- 不做持久化数据库——“已读”状态用浏览器 localStorage
- 不做 Slack / Jira 集成（已有 review-bot 负责）

## 4. 运行方式

通过 `npx pr-dashboard` 直接运行：启动一个本地 Node 服务，自动（或提示）打开
浏览器访问 `http://localhost:<port>`。

约束/已知环境：

- 用户：GitHub 用户名 `0xleizhang`，组织 `UrbanCompass`
- 企业环境存在证书拦截，浏览器直连 GitHub API 可能失败 → 因此由 Node 服务端
  代理所有 GitHub 请求，token 不进浏览器
- 已安装 `gh` CLI

### Token 获取顺序

1. 环境变量 `GITHUB_TOKEN`（若存在且非空）
2. `gh auth token` 的输出
3. 两者都拿不到 → 在终端打印清晰提示，引导用户设置 `GITHUB_TOKEN` 或
   `gh auth login`，并退出（非 0）

## 5. 技术方案

**零依赖 Node 服务 + 原生 HTML/JS。**

- `server.js`：仅用 Node 内置模块（`http`/`https`/`child_process`），无 npm 依赖、
  无构建步骤，`npx` 友好
- `index.html`：原生 JS 渲染，无前端框架

数据流单向：浏览器 → 本地服务端 → GitHub。无任何反向写操作。

## 6. 架构

```
npx pr-dashboard
   │
   ├─ server.js (Node 内置 http/https/child_process)
   │    ├─ resolveToken(): GITHUB_TOKEN env → `gh auth token` → 报错退出
   │    ├─ GET /                       → 返回 index.html
   │    └─ GET /api/prs?scope=open|all → 调 GitHub 拉取 + 合并参与标签，返回 JSON
   │
   └─ index.html (vanilla JS)
        ├─ fetch /api/prs，渲染表格
        ├─ 顶部 toggle: open / open+最近关闭(默认 open)
        ├─ localStorage 存每个 PR 上次看到的 updatedAt → 标记“新动态”
        └─ 点击行 → 标记已读 + 在新标签打开 PR
```

## 7. 数据获取

### 7.1 主数据：GitHub GraphQL（一次请求拿全）

用 GraphQL 的 `search` 一次取回 PR 列表及其状态，避免 REST 下每个 PR 多次调用：

- 查询：`search(query: "is:pr involves:0xleizhang org:UrbanCompass <scope>", type: ISSUE, first: 50)`
  - `scope=open` 时附加 `is:open`
  - `scope=all` 时不加 open 限制，但加 `updated:>=<N天前>` 限制最近关闭/合并的范围
- 每个 PR 节点取回字段：
  - `number`, `title`, `url`, `repository { nameWithOwner }`
  - `isDraft`, `state`（OPEN/CLOSED/MERGED）
  - `updatedAt`
  - `reviewDecision`（APPROVED / CHANGES_REQUESTED / REVIEW_REQUIRED / null）
  - 评论数：`comments { totalCount }` + `reviews { totalCount }`
  - CI 状态：`commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`
    （state: SUCCESS / FAILURE / PENDING / ERROR / EXPECTED / null）

### 7.2 参与方式标签

`involves:` 一次查询覆盖 4 种参与情况，但不区分是哪一种。为得到标签，在**同一个
GraphQL 请求**里再加 4 个 aliased search（每个只取 PR 标识 `number` + repo），与
§7.1 的主 search 共 5 个 alias，一次往返完成：

- `byAuthor:`    `author:0xleizhang`
- `byAssignee:`  `assignee:0xleizhang`
- `byMention:`   `mentions:0xleizhang`
- `byCommenter:` `commenter:0xleizhang`

（均带与主 search 相同的 `org:UrbanCompass` + scope 条件。）

把这 4 个结果集与主数据按 PR 唯一标识（`repo#number`）合并，给每个 PR 打上
一个或多个标签：`author` / `assignee` / `mention` / `commenter`。主 search 用
`involves:` 仍是权威列表；4 个 label search 仅用于打标签。

> 注意分页：每个 search 取 `first: 50`。若某类参与超过 50 条会漏标签——首版
> 接受此限制（单人参与的 open PR 极少超过 50），后续可加分页。

### 7.3 错误处理

- token 缺失 → 启动即报错退出（见 §4）
- GitHub 请求失败（网络/证书/401/403/rate limit）→ `/api/prs` 返回带 `error`
  字段的 JSON，前端在页面顶部显示错误条，而不是白屏
- GraphQL 部分字段为 null（如 CI 未配置）→ 视为“未知/无”，UI 显示中性状态

## 8. 前端展示

### 8.1 每行字段

| 列 | 内容 |
|---|---|
| 参与 | 🖊 author / 👤 assignee / @ mention / 💬 commenter（可多个） |
| Review | ✅ approved / ❌ changes requested / 💬 有评论但未决 / ⚪ 无 |
| CI | 🟢 pass / 🔴 fail / 🟡 pending / ⚪ 未知 |
| 新动态 | 🔵 自上次查看后 updatedAt 有变化 |
| 标题 | 链接到 PR，前缀 `repo#number` |

排序：默认按 `updatedAt` 倒序。

### 8.2 已读 / 新动态逻辑

- localStorage 存映射：`{ "repo#number": lastSeenUpdatedAt }`
- 渲染时：若当前 `updatedAt` > 存储值（或无记录）→ 标记 🔵 新动态
- 点击某行：在新标签打开 PR，同时把该 PR 的 `updatedAt` 写入 localStorage（标记已读）
- 可选：提供“全部标记已读”按钮（把当前列表所有 PR 的 updatedAt 写入）

### 8.3 顶部控件

- scope 切换：`仅 open`（默认） / `open + 最近关闭`，切换时重新 `fetch /api/prs?scope=`
- 刷新按钮：重新拉取
- 错误条：请求失败时显示

## 9. 测试策略

- **参与标签合并逻辑**：纯函数，给定 4 个 search 结果集 + 主数据，断言每个 PR 得到
  正确的标签集合 → 单元测试
- **状态映射**：GraphQL 原始字段（reviewDecision / statusCheckRollup.state）→ UI
  状态枚举的映射函数 → 单元测试
- **token 解析顺序**：mock env 与 `gh auth token`，断言优先级与缺失时的报错 →
  单元测试
- **新动态判定**：给定 localStorage 值与 PR updatedAt，断言是否标记新动态 → 单元测试
- 端到端：用一个 mock 的 GitHub 响应启动服务，断言 `/api/prs` 返回结构正确；UI
  手动验证（启动后浏览器查看 golden path 与错误条）

## 10. 文件结构（初步）

```
pr-dashboard/
├─ package.json        # bin: pr-dashboard → server.js，无 runtime 依赖
├─ server.js           # 服务端：token 解析 + GitHub 代理 + 标签合并 + 静态服务
├─ github.js           # GitHub 查询与状态/标签映射的纯函数（便于测试）
├─ public/index.html   # 前端页面
├─ test/               # 单元测试
└─ docs/superpowers/specs/2026-06-12-pr-dashboard-design.md
```
