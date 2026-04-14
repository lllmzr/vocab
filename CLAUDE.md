# 单词背诵应用

本地运行的英语单词背诵工具，基于 SM-2 间隔重复算法。

## 启动方式

```bash
cd D:/codexproject/vocab
node server.js
# 访问 http://localhost:4000
```

## 技术栈

- 后端：Node.js + Express（`server.js`）
- 前端：原生 HTML/CSS/JS（`public/`），无框架
- 数据：JSON 文件，无数据库

## 目录结构

```
vocab/
  server.js              # Express 服务器，端口 4000
  import_dicts.js        # 从 qwerty-learner 下载并导入词库（含音标）
  public/
    index.html
    app.js               # 所有前端逻辑（SM-2、localStorage、fetch）
    styles.css
    data/
      cet6.json          # CET-6 词库（2345 词，含音标 phonetic 字段）
      ielts.json         # 雅思 IELTS 词库（5475 词，含音标 phonetic 字段）
      words.json         # 自定义词库
  progress/              # 服务端进度持久化（不在 public/ 内）
    prog_cet6.json       # CET-6 复习进度
    prog_ielts.json      # 雅思复习进度
    streak.json          # 连续打卡天数
    daily.json           # 每日复习记录（含单词、音标、例句、选择）
    dict_cache.json      # dictionaryapi.dev 例句缓存
```

## 已完成的改动

### 1. 修复前端启动崩溃（app.js）

**问题**：工具函数 `$`、`show`、`hide`、`esc`、`norm`、`shuffle` 定义在文件末尾（第 277 行），但在第 135 行就被调用。`const` 不会提升，导致脚本启动即抛 `ReferenceError`，页面一直显示"加载中"，按钮无响应。

**修复**：将这 6 个工具函数移到文件最顶部。

### 2. 添加服务端进度持久化（server.js + app.js）

**问题**：所有学习进度只存在 localStorage，清除浏览器数据或换浏览器后全部丢失。

**新增 API 端点（server.js）**：

| 端点 | 说明 |
|------|------|
| `GET  /api/progress/:deckId` | 读取词库进度，不存在返回 `{}` |
| `POST /api/progress/:deckId` | 原子写入词库进度（tmp→rename） |
| `GET  /api/streak` | 读取连续打卡天数 |
| `POST /api/streak` | 写入连续打卡天数 |

**前端改动（app.js）**：
- `loadProg()` 改为 async，启动时从服务器拉取进度与 localStorage 合并（服务器优先）
- `saveProg()` 每次复习后 fire-and-forget POST 到服务器（不阻塞 UI）
- `bumpStreak()` 打卡后同步写入服务器
- `switchDeck()` 改为 `await loadProg()`
- 新增 `loadStreakFromServer()`，init 时优先恢复服务端打卡记录

**迁移**：零摩擦，首次复习时自动将 localStorage 旧数据写入服务器。

### 3. 每日复习计数与历史日历

**新增 API 端点**：

| 端点 | 说明 |
|------|------|
| `GET  /api/daily` | 读取每日复习记录 |
| `POST /api/daily` | 写入每日复习记录 |

**数据结构（daily.json）**：
```json
{
  "2026-04-14": {
    "count": 15,
    "words": [
      { "word": "cancel", "trans": "取消", "phonetic": "'kænsl", "example": "...", "choice": "认识" }
    ]
  }
}
```

**前端改动（app.js）**：
- `bumpDaily(word, choiceLabel)` 每次提交打字后记录单词详情（含音标、例句、选择）
- `todayCount()` 读取今日累计数，显示在开始界面和完成界面
- 新增「日历」tab，按日期倒序展示每天复习的所有单词详情

### 4. 音标与例句

**音标来源**：qwerty-learner 词库的 `usphone` 字段，通过 `node import_dicts.js` 重跑写入各词库 JSON（保留原有 ID，不影响进度）。

**例句来源**：`GET /api/word-detail/:word` 端点按需从 [dictionaryapi.dev](https://api.dictionaryapi.dev) 抓取，结果缓存到 `progress/dict_cache.json`，避免重复请求。

**显示位置**：
- 复习揭示卡片：单词下方显示音标，例句区域自动补全
- 日历历史：每条记录显示音标 + 例句 + 翻译 + 选择标签

**import_dicts.js 改动**：导入时同时写入 `phonetic` 字段；已有单词只补全缺失字段，不重建 ID。

### 5. 提示音

**复习提示音（前端）**：每次新单词出现需要选择时，用 Web Audio API 播放两音节提示音（880Hz → 660Hz，`playTone()`，`app.js` 顶部）。

**系统提示音（Claude Code 全局 hooks，`~/.claude/settings.json`）**：

| 事件 | 音效 | 说明 |
|------|------|------|
| `Stop` | Asterisk | Claude 完成回复时 |
| `PermissionRequest` | Exclamation | Claude 需要权限确认时 |

## 注意事项

- 服务器重启后需要重新 `node server.js`（无守护进程）
- `progress/` 目录不在 `public/` 内，浏览器无法直接访问
- 词库导入：`node import_dicts.js`（需要服务器已在运行）
- 音标补全：重跑 `node import_dicts.js` 可为已有单词补充音标（不修改 ID）
- 例句缓存：`progress/dict_cache.json` 存储已抓取的例句，可手动清空以强制刷新
