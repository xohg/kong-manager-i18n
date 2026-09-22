# Kong Manager OSS 3.6 中文国际化（客户端运行时注入）

给本地 Docker 里跑的 Kong Manager OSS（3.6.x）加一套**中英文切换**，无需重编译前端、
不修改 Kong 原版镜像里的任何脚本或样式。

实测环境：`kong:3.6`（Kong Manager OSS 3.6.1）· `http://127.0.0.1:8002`

---

## 1. 结论先行

| 问题 | 结论 |
|---|---|
| Kong Manager OSS 官方支持中文吗？ | **不支持**。只有英文一种语言 |
| 有官方多语言开关吗？ | **没有**。默认语言在编译期写死 |
| 能靠改配置切语言吗？ | **不能**，见 §5.2 |
| 本方案怎么做的？ | 在渲染出口做文案替换（客户端注入），零改动原版文件内容 |
| 效果怎么样？ | 侧边栏 / 列表页 / 详情页 / 表单 / 错误页 / 404 页全部中文，右上角导航栏内一键切回英文 |

**必须提醒的一点**：`/kconfig.js` **不是**可用的注入点。它是 Kong 自己的 nginx 精确匹配
location，由 Lua 动态生成，放静态文件进去永远不会被读取。详见 §5.1 —— 这是本方案从
第一版（用 kconfig.js）改为第二版（用 index.html）的直接原因。

---

## 2. 交付文件

目录：`kong-proxy-test/kong-manager-i18n/`

| 文件 | 作用 |
|---|---|
| **`i18n-zh.js`** | **核心引擎**（约 674 行）。词典 + 30 条动态模式 + 双路径翻译引擎 + 切换按钮 |
| **`apply-i18n.ps1`** | **一键部署脚本**。备份、注入、校验全自动，幂等可重跑 |
| `index.patched.html` | 带注入行的 `index.html`（由脚本从容器现文件现场生成，供 compose 挂载） |
| `index.orig.html` | 原始 `index.html` 备份（脚本首次运行时自动产生） |
| `kconfig.js` | ⚠ **仅离线沙箱用**，真机无效，见 §5.1 |
| `screenshots/` | 真实 Kong（8002）与离线沙箱的中英对照截图 |

---

## 3. 安装

### 3.1 一键（推荐）

```powershell
cd d:\dockerWork\iBus\versions\ensemble2016-test\kong-proxy-test\kong-manager-i18n
powershell -ExecutionPolicy Bypass -File .\apply-i18n.ps1
```

脚本做 5 件事，全部幂等，重复执行安全：

1. 确认容器 `kong-wsdl-test` 在运行
2. 首次运行时备份原始 `index.html` → `index.orig.html`
3. **从容器当前 `index.html` 现场生成** `index.patched.html`（在第一个
   `<script type="module">` 之前插入一行引用）
4. `docker cp` 两个文件到容器 `/usr/local/kong/gui/`
5. HTTP 校验 `/i18n-zh.js` 返回 200 且首页含注入标签

然后打开 **http://127.0.0.1:8002/** ，右上角导航栏就是切换按钮。

> 浏览器若缓存了旧版，`Ctrl+F5` 强制刷新。文件名带 `?v=4` 版本号做缓存击穿。

### 3.2 持久化（容器重建后仍生效）

`docker cp` 只写进容器可写层，`docker compose up -d` 重建容器就丢。生产用法是把
两个文件**只读挂载**进去 —— 已写进 `compose-kong.yml`：

```yaml
    volumes:
      - ./kong.yml:/etc/kong/kong.yml:ro
      # ↓ 中文国际化
      - ./kong-manager-i18n/index.patched.html:/usr/local/kong/gui/index.html:ro
      - ./kong-manager-i18n/i18n-zh.js:/usr/local/kong/gui/i18n-zh.js:ro
```

生效步骤：

```powershell
# 1) 先生成/刷新 index.patched.html（容器在跑的时候执行）
powershell -ExecutionPolicy Bypass -File .\kong-manager-i18n\apply-i18n.ps1
# 2) 让挂载生效
docker compose -f compose-kong.yml up -d
```

**Kong 镜像升级后必须重跑第 1 步**。原因：镜像升级会更换前端资源包名
（如 `index-a9568421.js` → 别的 hash），`index.html` 里的引用要跟着变。
`apply-i18n.ps1` 不硬编码任何 hash，它是读容器里**当前**的 `index.html` 再改的，
所以重跑一次即可自愈。

### 3.3 卸载

```powershell
# 方式一：还原备份
docker cp .\index.orig.html kong-wsdl-test:/usr/local/kong/gui/index.html
docker exec kong-wsdl-test rm -f /usr/local/kong/gui/i18n-zh.js
# 方式二：直接重建容器（推荐）
docker compose -f compose-kong.yml up -d --force-recreate kong
```

---

## 4. 使用

### 4.1 怎么切换

- 按钮位于**顶部导航栏右上角**，与 GitHub Star 徽章同行：中文界面显示 `EN`，英文界面显示 `中文`
- 点击 → 写入 `localStorage['km-lang']` 并刷新
- 默认语言是**中文**（首次访问即中文）

**按钮的挂载策略**（改了位置容易踩坑，说明一下）：

```
优先: 插进 header.kong-ui-app-navbar 里的 .navbar-content-right
      作为最后一个子节点 -> 视觉上就是最右上角, 且随导航栏吸顶
兜底: 导航栏还没渲染出来时, 先 position:fixed 贴右上角占位
迁移: 前 9 秒每 150ms 轮询一次, 导航栏一出现就把按钮迁进去
自愈: 之后每 2.5s 兜底一次; 路由重渲染若把导航栏摘掉,
      靠 isConnected 判定重新挂回右上角(不会产生重复节点)
```

为什么不直接 `position:fixed; top:16px; right:16px` 了事：那样会**盖住** Star 徽章，
且徽章宽度随 star 数变化（`44,157` → `45,000`+），固定偏移量迟早会重叠。
插进导航栏让它参与 flex 布局，天然避让。

### 4.2 语言直传与调试

也支持 URL 直传，便于做对比截图或分享链接：

  | URL | 效果 |
  |---|---|
  | `http://127.0.0.1:8002/` | 跟随 localStorage，默认中文 |
  | `http://127.0.0.1:8002/?km-lang=zh` | 强制中文，并写回偏好 |
  | `http://127.0.0.1:8002/?km-lang=en` | 强制英文，并写回偏好 |

浏览器控制台可用调试接口：

```js
__kmI18n.lang                    // 当前语言
__kmI18n.size                    // 词典条数
__kmI18n.translate('Upstreams')  // '上游'  —— 返回 null 表示未命中
__kmI18n.scan()                  // 手动全量重扫一遍
```

---

## 5. 工作原理

### 5.1 注入点：为什么是 `index.html`，不是 `kconfig.js`

`index.html` 里只有两个脚本引用：

```html
<script type="text/javascript" src="/__km_base__/kconfig.js"></script>
<script type="module" crossorigin src="/__km_base__/assets/index-a9568421.js"></script>
```

第一版方案想借用 `kconfig.js` 这个引用点（因为它看着一直 404）。**这条路是死的**，
实测 Kong 3.6 源码：

```nginx
# /usr/local/kong/nginx-kong-gui-include.conf
location = /kconfig.js {
    content_by_lua_block { Kong.admin_gui_kconfig_content() }
}
```

```lua
-- /usr/local/share/lua/5.1/kong/admin_gui/init.lua
function _M.generate_kconfig(kong_config)
  local configs = {
    ADMIN_GUI_URL = ..., ADMIN_GUI_PATH = ..., ADMIN_API_URL = ...,
    ADMIN_API_PORT = ..., ADMIN_API_SSL_PORT = ..., ANONYMOUS_REPORTS = ...,
  }
  -- 逐个拼成 window.K_CONFIG = { ... }
end
```

两点致命：

1. `location =` 是 nginx **精确匹配**，优先级最高 —— 往 `/usr/local/kong/gui/` 放一个
   静态 `kconfig.js`，请求会被 Lua 拦截，文件**永远不会被读取**。
2. `generate_kconfig()` 只枚举 kong.conf 的 6 个变量，**没有任何自定义注入口子**。

所以唯一可行的注入点是在 `index.html` 里插一行 `<script>`：

```html
<script type="text/javascript" src="/__km_base__/i18n-zh.js?v=4"></script>
```

插在 `<script type="module">` **之前**。经典脚本会在解析时同步执行，而 module 脚本是
deferred 的，所以 i18n 引擎一定先于应用主包就绪。

路径写 `/__km_base__/` 前缀是刻意的：Kong 的 nginx 对所有响应都开了

```nginx
sub_filter '/__km_base__/' '/';   # 实际值是 ADMIN_GUI_PATH
sub_filter_types *;
```

也就是 Kong 会**动态**把 `__km_base__` 改写成你配置的 `admin_gui_path`。因此这一行
不写死路径，无论 `ADMIN_GUI_PATH` 配成 `/` 还是 `/kong`，挂载都不用改。

`sub_filter_types *` 还有一个副作用（对我们有利）：`/i18n-zh.js` 也是走
`location ~* ^(?<path>/.*\.(js))$` 从 `gui` 根目录发出的，所以把文件放进
`/usr/local/kong/gui/` 就能通过 `/i18n-zh.js` 访问到。

### 5.2 为什么不能切 locale

挖开主包 `assets/index-a9568421.js`（1.03 MB）后发现，Kong Manager **确实有一套 i18n
层，但是自研的**，不是 `vue-i18n`：

- 用的是打包进来的 `@formatjs/intl` 的 `createIntl`
- 每个 chunk 内部以 `Ig("en-us", { messages })` 创建**自己的 intl 实例**
- `locale` 和 `messages` 都是**编译期写死的模块内常量**，实例活在模块闭包里
- 没有任何全局 locale 钩子，也没有 `window` 上的 i18n 句柄

所以运行时改 locale 不可行。但这条线索有个**巨大收益**：消息表是结构化的
`"service.list.title": "Gateway Services"` 形式，可以直接从包里原样提取出来当词典源，
比对着界面猜文案靠谱得多。最终词典的骨架就是这么来的。

顺带更正一个常见误解：Kong Manager 读的全局配置变量是 `window.K_CONFIG`，
**不是** `KONG_CONFIG`。

### 5.3 两条翻译路径

纯文本替换最大的问题是**时序**：DOM 更新可能发生在任何时刻，替换晚了会闪一下英文。
所以做了双保险：

**路径 A — 写入拦截（同步，不闪）**

直接替换以下入口的 setter，在文本落地的**那一刻**就翻译好：

```
Node.prototype.nodeValue
CharacterData.prototype.data
Node.prototype.textContent
HTMLElement.prototype.innerText
Element.prototype.setAttribute   （只对白名单属性生效）
Document.prototype.title
```

**路径 B — MutationObserver 兜底（补齐来不及拦的）**

`subtree: true` 观察 `documentElement`，处理三类记录：

| 记录类型 | 处理 |
|---|---|
| `childList` | 递归 walk 新增节点，翻译文本节点与属性 |
| `characterData` | 翻译该文本节点 |
| `attributes` | 对 `placeholder` / `title` / `aria-label` / `alt` 白名单属性翻译 |

**为什么 B 是必需品、不是优化项**：Vue 3 首次挂载文本走的是
`document.createTextNode()`，通过 `appendChild` 入树，**完全不经过任何 setter**。
只做路径 A 会漏掉相当大一部分首屏文案。

### 5.4 为什么不会死循环

翻译动作本身也会触发 MutationObserver。靠两条性质自然收敛：

- 词典是单向的（`英文 → 中文`），中文结果再查一次返回 `null` → 不再写回
- 所有写入都走原始 setter（`RAW_*`），不走被 patch 的版本

配合 `data-km-i18n-skip` 属性标记跳过自建节点（切换按钮本身）。

### 5.5 不误伤数据

只翻译**文本节点**与白名单属性，绝不碰：

- 表单 `value`（用户输入、服务名、ID、路径会被原样保留）
- 任何非白名单属性
- 代码块、JSON 编辑区（`skip` 标记）

### 5.6 动态文案的处理

运行期拼接的文案（带变量、带插值）无法用静态词典覆盖，用 30 条**正则模式**处理。例如：

```js
// 详情页标题: "Gateway Service: wsdl-order-service"
[/^(Gateway Services?|Routes?|...)(?::|：)\s*(.+)$/,
  function (m0, t, n) { return entZh(t) + '：' + n; }],

// 浏览器标签: "Overview | Kong Manager"
[/^(.+?)\s*[|·-]\s*Kong Manager.*$/, function (m0, t) { return entZh(t) + ' | Kong Manager'; }]
```

排除了「冒号后必须有内容」这种陷阱 —— 实体无名称时标题是裸的 `Gateway Service:`
（冒号后为空），早期版本会漏翻。

另外加了一小段中文排版修正 CSS，解决 `格式：` 这类短标签被逐字换行的问题
（CJK 默认允许任意字间断行）：

```css
label.k-label, .k-label { word-break: keep-all; white-space: nowrap; }
```

---

## 6. 验证情况

### 6.1 自动化测试

| 测试 | 用例数 | 结果 |
|---|---|---|
| 词典 + 模式匹配单测 | 43 | 43 / 43 |
| jsdom DOM 层（四条渲染路径 + Observer + 按钮挂载/迁移/自愈） | 30 | 30 / 30 |
| 幂等性断言 | 506 | 0 违例 |
| 词典重复键检测 | 510 条 | 0 重复 |

### 6.2 真实渲染

两轮都做了：

**离线沙箱**（`mock_server.js`：静态服务 8090 + mock Admin API 8001）
—— 好处是可以随时造数据、跑无限次

**真实 Kong 8002** —— 最终验收，截图见 `screenshots/real-8002-*.png`

| 页面 | 核验点 |
|---|---|
| `/?km-lang=zh` | 侧边栏 12 项、网关/节点详情/端口详情/数据存储/资源卡片全中文，导航栏右上角 EN 按钮就位 |
| `/?km-lang=en` | 全部还原英文，按钮变「中文」 |
| `/services?km-lang=zh` | 表头 名称/协议/主机/端口/路径/已启用/标签，真实数据 3 条服务正常渲染 |
| `/plugins` | 列表与表头中文 |
| 详情页 / 404 页 / 错误态 | 字段、错误提示、404 正文全中文 |

---

## 7. 扩充词典

在 `i18n-zh.js` 的 `DICT` 对象里加一行即可：

```js
'Load Balancing': '负载均衡',
```

**先确认命中**，别猜文案 —— 在页面控制台执行：

```js
__kmI18n.translate('Load Balancing')   // 返回 null 就说明界面上的实际文本不是这个
```

如果界面上明明显示英文、但 `translate` 返回 `null`，通常是这两种情况：

1. **文本被拆成了多个节点**（`I18nT` 组件按 `{}` 占位拆段渲染）。例如 404 页正文
   实际是 `"We cannot find the page "` + `"you were looking for."` 两段，
   这时词典要按**片段**写，不能按整句写。
2. 文案来自 Admin API 的插件 schema 描述，不在前端包里。

用 `__kmI18n.scan()` 可手动全量重扫。

---

## 8. 已知限制

1. **插件 schema 的描述文字仍是英文**。这部分由 Admin API 在运行时返回，
   不在前端打包产物里，静态词典覆盖不到。
2. **词典是穷举式**。510 条覆盖了全部导航、列表、详情、表单、错误态，
   但冷门插件的配置项可能有遗漏 —— 遇到补一行即可，成本很低。
3. **挂载方式下镜像升级需要重跑 `apply-i18n.ps1`**，原因见 §3.2。
4. **只对 Kong OSS 验证过**。Kong Enterprise（Konnect）的 Manager 是另一套前端，
   本方案不适用。
5. **`localStorage` 是按 origin 隔离的**。换端口或换域名访问，语言偏好不共享。

---

## 9. 给后来者的两个坑

1. **`/kconfig.js` 是 Lua 端点，不是静态文件**。任何"往 gui 目录丢 kconfig.js"的
   方案在真实 Kong 上都是静默失效的 —— 本地 mock 若自己实现了静态服务会把它测成绿的，
   真机验证不可省。
2. **同一条消息里并行对同一个文件发多个 Edit 会互相覆盖**。工具全返回 success，
   mtime 也变了，但只有一个改动真正落地。改同一文件一律串行，并且改完要
   **重新读文件核对**，别只看工具返回。
