/* Kong Manager OSS 3.6 中文国际化(客户端运行时注入)
 * ---------------------------------------------------------------------------
 * 注入方式: 由 index.html 的 <head> 中一行 <script> 同步加载, 位置在应用主包
 *           (type="module") 之前。Kong 原版 index.html 只多这一行, 其余文件
 *           一律不动。部署见 apply-i18n.ps1。
 *
 * 为什么不走 kconfig.js(重要):
 *   /kconfig.js 被 Kong nginx 的精确匹配 location(`= /kconfig.js`)占用, 由 Lua
 *   Kong.admin_gui_kconfig_content() 动态生成, 而 generate_kconfig() 只枚举
 *   kong.conf 的 6 个变量、无自定义注入口 —— 往 gui 目录放静态 kconfig.js
 *   永远不会被读取。故只能在 index.html 上做一行插入。
 *
 * 背景(实测 Kong 3.6 打包产物):
 *   Kong Manager 采用自研 i18n(非 vue-i18n), 每个 chunk 内部以
 *   Ig("en-us", {messages}) 创建一个 formatjs createIntl 实例, locale 与
 *   messages 均编译期写死、无全局 locale 开关, 因此无法在运行时切换 locale。
 *   唯一可行通路: 在渲染出口做文案替换。
 *
 * 本脚本做两件事:
 *   1) 拦截 DOM 文本写入路径(nodeValue / data / textContent / innerText /
 *      document.title / setAttribute), 在文本落地的瞬间完成翻译 —— 同步、
 *      无闪烁、动态渲染天然覆盖;
 *   2) MutationObserver 兜底扫描(属性赋值、innerHTML 等绕过路径), 幂等安全。
 *      注: Vue 3 首屏文本走 createTextNode + appendChild, 不经过任何 setter,
 *      因此第 2 条是必需项而非优化项。
 *
 * 语言偏好存 localStorage('km-lang'), 切换即刷新; 亦支持 ?km-lang=zh|en 直传。
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var LANG_KEY = 'km-lang';
  var lang = (localStorage.getItem(LANG_KEY) || 'zh').toLowerCase();
  /* 允许用 ?km-lang=en|zh 直接指定(便于分享链接与对比截图), 并写回偏好 */
  var urlLang = (location.search.match(/[?&]km-lang=(zh|en)\b/i) || [])[1];
  if (urlLang) {
    lang = urlLang.toLowerCase();
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* 忽略 */ }
  }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

  /* ======================= 语言切换按钮 (两种语言都挂) ======================= */
  /* 优先插进顶部导航栏右侧(.navbar-content-right, 与 GitHub Star 徽章同行),
     视觉上就是"右上角", 且随导航栏一起吸顶。
     导航栏是 Vue 异步渲染的, 取不到时先固定贴在右上角, 并持续重试迁移。 */
  var NAV_SEL = '.navbar-content-right';

  function makeBtn() {
    var btn = document.createElement('button');
    btn.id = 'km-lang-toggle';
    btn.type = 'button';
    btn.textContent = lang === 'zh' ? 'EN' : '中文';
    btn.title = lang === 'zh' ? 'Switch to English' : '切换到中文';
    btn.setAttribute('data-km-i18n-skip', '1');
    btn.style.cssText = 'cursor:pointer;font-size:12px;line-height:1;font-weight:600;'
      + 'border-radius:999px;padding:5px 12px;align-self:center;'
      + 'transition:background .15s';
    btn.addEventListener('click', function () {
      try { localStorage.setItem(LANG_KEY, lang === 'zh' ? 'en' : 'zh'); } catch (e) { /* 忽略 */ }
      location.reload();
    });
    return btn;
  }

  /* 深色导航栏内: 半透明白底, 与原生 Star 徽章同一视觉语言 */
  function styleInNav(btn) {
    btn.style.position = 'static';
    btn.style.top = btn.style.right = btn.style.bottom = btn.style.zIndex = '';
    btn.style.marginLeft = '8px';
    btn.style.border = '1px solid rgba(255,255,255,.28)';
    btn.style.background = 'rgba(255,255,255,.12)';
    btn.style.color = '#fff';
    btn.onmouseenter = function () { btn.style.background = 'rgba(255,255,255,.26)'; };
    btn.onmouseleave = function () { btn.style.background = 'rgba(255,255,255,.12)'; };
  }

  /* 兜底: 导航栏尚未出现时, 固定贴右上角(白底, 在浅色内容区也看得清) */
  function styleFloating(btn) {
    btn.style.position = 'fixed';
    btn.style.top = '16px';
    btn.style.right = '16px';
    btn.style.marginLeft = '';
    btn.style.zIndex = '2147483647';
    btn.style.border = '1px solid #cbd5e1';
    btn.style.background = '#fff';
    btn.style.color = '#111';
    btn.onmouseenter = function () { btn.style.background = '#f1f5f9'; };
    btn.onmouseleave = function () { btn.style.background = '#fff'; };
  }

  /* 持有自建按钮的引用: 导航栏若被整体摘除, getElementById 会失联,
     靠引用 + isConnected 判断才能真正自愈(否则会误建一个游离的重复节点)。 */
  var toggleBtn = null;

  function mountToggle() {
    var btn = toggleBtn;
    if (!btn) { btn = toggleBtn = makeBtn(); }

    /* 已挂载在文档里吗? 注意父节点存在 != 已连接(父节点本身可能已被摘除) */
    var connected = (typeof btn.isConnected === 'boolean') ? btn.isConnected
      : (typeof document.contains === 'function' ? document.contains(btn) : true);

    var host = document.querySelector(NAV_SEL);
    if (host) {
      if (btn.parentNode !== host) { styleInNav(btn); host.appendChild(btn); }
      return;
    }
    /* 导航栏还没渲染出来(或已被摘除) —— 固定贴右上角占位, 后续轮询会迁进导航栏 */
    if (!connected) {
      styleFloating(btn);
      (document.body || document.documentElement).appendChild(btn);
    }
  }

  mountToggle();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountToggle);
  }
  /* SPA 挂载时机不可预期:
     前 9 秒每 150ms 密集重试(等导航栏出现并完成迁移),
     之后降到 2.5s 低频兜底(防路由切换使导航栏重渲染把按钮冲掉)。
     单次开销仅一次 getElementById + querySelector, 可忽略。 */
  (function () {
    var n = 0;
    var fast = setInterval(function () {
      mountToggle();
      if (++n === 60) { clearInterval(fast); setInterval(mountToggle, 2500); }
    }, 150);
  })();

  if (lang !== 'zh') return;   // 英文模式: 只保留切换按钮

  /* 中文排版修正: 部分 Kong UI 组件按英文标签宽度计算容器, 中文会被逐字断行 */
  (function () {
    var st = document.createElement('style');
    st.id = 'km-i18n-style';
    st.setAttribute('data-km-i18n-skip', '1');
    st.textContent = '.k-label,.k-input-label,label,legend,dt,th{word-break:keep-all}'
      + '.k-label,.k-input-label{overflow-wrap:normal}';
    (document.head || document.documentElement).appendChild(st);
  })();

  /* ============================== 1. 词典 ============================== */

  /* 实体名单数 -> 复数/通用中文名, 供模式匹配复用 */
  var ENT = {
    'Gateway Service': '网关服务', 'Gateway Services': '网关服务',
    'Route': '路由', 'Routes': '路由',
    'Consumer': '消费者', 'Consumers': '消费者',
    'Plugin': '插件', 'Plugins': '插件',
    'Upstream': '上游', 'Upstreams': '上游',
    'Certificate': '证书', 'Certificates': '证书',
    'CA Certificate': 'CA 证书', 'CA Certificates': 'CA 证书',
    'SNI': 'SNI', 'SNIs': 'SNI',
    'Target': '目标', 'Targets': '目标',
    'Vault': '保管库', 'Vaults': '保管库',
    'Key': '密钥', 'Keys': '密钥',
    'Key Set': '密钥集', 'Key Sets': '密钥集',
    'Consumer Group': '消费者组', 'Consumer Groups': '消费者组',
    'Credential': '凭据', 'Credentials': '凭据',
    'Workspace': '工作区', 'Workspaces': '工作区',
    'Team': '团队', 'Teams': '团队',
    'Node': '节点', 'Nodes': '节点'
  };

  /* 精确词典(大小写不敏感)。键=界面英文原文, 值=中文。 */
  var DICT = {
    /* ---- 通用按钮 / 动作 ---- */
    'Back': '返回', 'Edit': '编辑', 'Save': '保存', 'Create': '创建',
    'Cancel': '取消', 'Delete': '删除', 'Confirm': '确认', 'Close': '关闭',
    'Next': '下一步', 'Previous': '上一步', 'Submit': '提交', 'Apply': '应用',
    'Add': '添加', 'Remove': '移除', 'Update': '更新', 'View': '查看',
    'Search': '搜索', 'Reset': '重置', 'Refresh': '刷新', 'Retry': '重试',
    'Copy': '复制', 'Clear': '清空', 'Dismiss': '忽略', 'Enable': '启用',
    'Disable': '禁用', 'Install': '安装', 'Upload': '上传', 'Download': '下载',
    'Learn more': '了解更多', 'Get Started': '快速上手', 'View documentation': '查看文档',
    'View Details': '查看详情', 'View Configuration': '查看配置',
    'View Advanced Fields': '查看高级字段', 'View less': '收起',
    'Add New Rule': '新增规则', 'Add consumer': '添加消费者',
    'Add Consumers': '添加消费者', 'Add consumers to this group': '将消费者添加到此组',
    'Add group to consumer': '将组添加到消费者', 'Select an item': '选择一项',
    'Select Plugin': '选择插件', 'Select valid protocols for the plugin': '为插件选择有效的协议',
    'Install Plugin': '安装插件', 'Upload schema file to create custom plugin': '上传 schema 文件以创建自定义插件',

    /* ---- 复制 / 剪贴板 ---- */
    'Copy ID': '复制 ID', 'Copy JSON': '复制 JSON', 'Copy Key': '复制密钥',
    'Copy Secret': '复制密钥值', 'Copy Credential': '复制凭据',
    'Copy to clipboard': '复制到剪贴板',
    'Copied code!': '代码已复制！', 'Copied successfully!': '复制成功！',
    'Successfully copied to clipboard': '已成功复制到剪贴板',
    'Failed to copy': '复制失败', 'Failed to copy to clipboard': '复制到剪贴板失败',
    'Failed to copy to the clipboard': '复制到剪贴板失败',
    'Failed to copy id to clipboard': '复制 ID 到剪贴板失败',

    /* ---- 筛选 / 查询 ---- */
    'Clear all filters': '清除所有筛选条件', 'Clear query': '清空查询',
    'Filter plugins': '筛选插件', 'Filter by name': '按名称筛选',
    'Filter by exact ID': '按精确 ID 筛选',
    'Filter by exact name or ID': '按精确名称或 ID 筛选',
    'Filter by exact instance name or ID': '按精确实例名称或 ID 筛选',
    'Filter by exact username or ID': '按精确用户名或 ID 筛选',
    'Filter by:': '筛选条件：', 'Filter mode enabled': '已启用筛选模式',
    'RegExp mode enabled': '已启用正则模式',
    'Search by exact ID to find key sets not included in the list': '按精确 ID 搜索以查找列表中未包含的密钥集',

    /* ---- 空态 / 提示 ---- */
    'No results': '无结果', 'No results found': '未找到结果',
    'No Data': '无数据', 'No Plugins': '无插件', 'No Custom Plugins': '无自定义插件',
    'No plugins are available.': '没有可用的插件。',
    'There is no data to display.': '暂无数据可显示。',
    'Data cannot be displayed due to an error.': '因错误无法显示数据。',
    'Please adjust the criteria and try again.': '请调整条件后重试。',
    'No selection...': '未选择…',
    'An error has occurred, please try again': '发生错误，请重试',
    'An error occurred': '发生错误', 'An unexpected error has occurred': '发生了意外错误',
    'Unknown error': '未知错误', 'Network Error': '网络错误', 'Not Found': '未找到',
    'Are you sure you want to delete': '确定要删除吗',
    'This action cannot be reversed.': '此操作无法撤销。',

    /* ---- 分页 ---- */
    'Go to the first page': '跳到第一页', 'Go to the last page': '跳到最后一页',
    'Go to the next page': '跳到下一页', 'Go to the previous page': '跳到上一页',
    'Pagination Navigation': '分页导航',

    /* ---- 布局 / 菜单 ---- */
    'Main menu': '主菜单', 'Open Main Menu': '打开主菜单', 'Close Main Menu': '关闭主菜单',
    'Overview': '概览', 'Settings': '设置', 'Dev Portal': '开发者门户',
    'API Keys': 'API 密钥', 'Gateway Services': '网关服务',

    /* ---- 信息面板 ---- */
    'Gateway': '网关', 'Edition': '发行版', 'Version': '版本',
    'Node Details': '节点详情', 'Address': '地址', 'Host Name': '主机名',
    'Port Details': '端口详情', 'Kong Manager Port': 'Kong Manager 端口',
    'Kong Manager SSL port': 'Kong Manager SSL 端口', 'Proxy Port': '代理端口',
    'Proxy SSL Port': '代理 SSL 端口', 'Datastore': '数据存储',
    'Type': '类型', 'User': '用户', 'Host': '主机', 'Port': '端口', 'SSL': 'SSL',
    'Introduction': '简介', 'Plugin Hub': '插件中心', 'Kong Nation': 'Kong 社区',
    'A lightweight, fast, and flexible cloud-native API gateway.': '轻量、快速、灵活的云原生 API 网关。',
    'New to Kong? Get started with the basics.': '初次使用 Kong？从基础开始。',
    'Extend Kong Gateway with powerful plugins.': '用强大的插件扩展 Kong 网关。',
    'Discuss Kong with others.': '与其他用户交流 Kong。',

    /* ---- 实体: 列表标题 ---- */
    'Routes': '路由', 'Consumers': '消费者', 'Plugins': '插件', 'Upstreams': '上游',
    'Services': '服务', 'Route': '路由', 'Service': '服务',
    'Certificates': '证书', 'CA Certificates': 'CA 证书', 'SNIs': 'SNI',
    'Targets': '目标', 'Vaults': '保管库', 'Keys': '密钥', 'Key Sets': '密钥集',
    'Consumer Groups': '消费者组', 'Workspaces': '工作区', 'Teams': '团队',

    /* ---- 实体: 创建 / 编辑标题 ---- */
    'New Gateway Service': '新建网关服务', 'Edit Gateway Service': '编辑网关服务',
    'New Route': '新建路由', 'Edit Route': '编辑路由',
    'New Consumer': '新建消费者', 'Edit Consumer': '编辑消费者',
    'New Plugin': '新建插件', 'Edit Plugin': '编辑插件',
    'New Upstream': '新建上游', 'Edit Upstream': '编辑上游',
    'New Certificate': '新建证书', 'Edit Certificate': '编辑证书',
    'New CA Certificate': '新建 CA 证书', 'Edit CA Certificate': '编辑 CA 证书',
    'New SNI': '新建 SNI', 'Edit SNI': '编辑 SNI',
    'New Target': '新建目标', 'Edit Target': '编辑目标',
    'New Vault': '新建保管库', 'Edit Vault': '编辑保管库',
    'New Key': '新建密钥', 'Edit Key': '编辑密钥',
    'New Key Set': '新建密钥集', 'Edit Key Set': '编辑密钥集',
    'Create Gateway Service': '创建网关服务', 'Create Route': '创建路由',
    'Create Consumer': '创建消费者', 'Create Plugin': '创建插件',
    'Create Upstream': '创建上游', 'Create SNI': '创建 SNI',
    'Create Key Set': '创建密钥集', 'Create Consumer Credential': '创建消费者凭据',
    'Delete an SNI': '删除 SNI', 'Delete an Upstream': '删除上游',
    'Delete an ACL Credential': '删除 ACL 凭据',
    'Delete an HMAC Credential': '删除 HMAC 凭据',
    'Delete an OAuth 2.0 Credential': '删除 OAuth 2.0 凭据',
    'New ACL Credential': '新建 ACL 凭据',
    'New Basic Auth Credential': '新建 Basic Auth 凭据',
    'New HMAC Credential': '新建 HMAC 凭据',
    'New JWT Credential': '新建 JWT 凭据',
    'New Key Auth Credential': '新建 Key Auth 凭据',
    'New Key Auth Encrypted Credential': '新建 Key Auth 加密凭据',
    'New OAuth 2.0 Credential': '新建 OAuth 2.0 凭据',
    'Edit Consumer Credential': '编辑消费者凭据',

    /* ---- 实体: 说明文案 ---- */
    'Gateway Service entities are abstractions of each of your own upstream services, e.g., a data transformation microservice, a billing API.':
      '网关服务实体是您各个上游服务的抽象，例如数据转换微服务、计费 API。',
    'A Route defines rules to match client requests, and is associated with a Service.':
      '路由定义匹配客户端请求的规则，并关联到一个服务。',
    'Consumers are the end users of a service.': '消费者是服务的最终用户。',
    "Plugins allow you to extend Kong's capabilities with features like rate limiting, authentication, and logging.":
      '插件可通过限流、认证、日志等功能扩展 Kong 的能力。',
    'An Upstream represents a virtual hostname and can be used to load balance incoming requests over multiple Services.':
      '上游代表一个虚拟主机名，可用于将传入请求负载均衡到多个服务。',
    'Certificates handle SSL/TLS termination for encrypted requests.':
      '证书用于处理加密请求的 SSL/TLS 终止。',
    'CA certificates validate client or server certificates.': 'CA 证书用于校验客户端或服务端证书。',
    'An SNI object represents a many-to-one mapping of hostnames to a certificate.':
      'SNI 对象表示主机名到证书的多对一映射。',
    'Improve the security of your Kong Gateway deployment with centralized secrets.':
      '通过集中式密钥管理提升 Kong 网关部署的安全性。',
    'A Key object holds a representation of asymmetric keys in various formats.':
      '密钥对象以多种格式保存非对称密钥。',
    'A Key Set object holds a collection of asymmetric key objects.':
      '密钥集对象包含一组非对称密钥。',

    /* ---- 实体: 操作反馈 ---- */
    'Credential successfully created!': '凭据创建成功！',
    'Credential successfully updated!': '凭据更新成功！',
    'Credential successfully deleted!': '凭据删除成功！',
    'Target successfully marked as healthy!': '目标已成功标记为健康！',
    'Target successfully marked as unhealthy!': '目标已成功标记为不健康！',
    'No Plugins Enabled': '未启用任何插件',

    /* ---- 字段标签 ---- */
    'Name': '名称', 'Description': '描述', 'Tags': '标签',
    'Enabled': '已启用', 'Disabled': '已禁用', 'Protocol': '协议',
    'Path': '路径', 'Method': '方法', 'Timeout': '超时',
    'Created at': '创建时间', 'Last Updated': '最近更新', 'Instance Name': '实例名称',
    'Custom ID': '自定义 ID', 'Username': '用户名', 'Password': '密码',
    'Client ID': '客户端 ID', 'Client secret': '客户端密钥',
    'Redirect URI(s)': '重定向 URI', 'Applied To': '应用于',
    'ID': 'ID', 'Route ID': '路由 ID', 'Service ID': '服务 ID',
    'Consumer ID': '消费者 ID', 'Route Configuration': '路由配置',
    'Routing Rules': '路由规则', 'Preserve Host': '保留 Host',
    'Strip Path': '剥离路径', 'Path Handling': '路径处理',
    'Connection Timeout': '连接超时', 'Read Timeout': '读取超时', 'Write Timeout': '写入超时',
    'Enter URI': '输入 URI', 'Enter or select a host': '输入或选择主机',
    'Enter IP/hostname and port': '输入 IP/主机名和端口',
    'Full URL': '完整 URL', 'Host Header': 'Host 请求头',
    'Upstream URL': '上游 URL', 'Service Endpoint': '服务端点',
    'Load Balancing': '负载均衡', 'Round Robin': '轮询', 'Least Connections': '最少连接',
    'Consistent Hashing': '一致性哈希', 'Health Checks & Circuit Breakers': '健康检查与熔断器',
    'Active Health Checks': '主动健康检查', 'Passive Health Checks': '被动健康检查',
    'Active Health Check Type': '主动健康检查类型', 'Passive Health Check Type': '被动健康检查类型',
    'Mark Healthy': '标记为健康', 'Mark Unhealthy': '标记为不健康',
    'Target Address': '目标地址', 'Upstream Targets': '上游目标',
    'View Key Set': '查看密钥集', 'View Plugin': '查看插件', 'View Route': '查看路由',
    'View Upstream': '查看上游', 'View Consumer': '查看消费者',
    'View Gateway Service': '查看网关服务',
    'Consumer Credentials': '消费者凭据', 'Consumer Identification': '消费者标识',
    'Credential Prefix': '凭据前缀', 'Key ID': '密钥 ID', 'Key Format': '密钥格式',
    'Public Key': '公钥', 'Private Key': '私钥', 'Serial Number': '序列号',
    'Not Before': '生效时间', 'Not After': '失效时间',
    'Subject Alternative Name': '主体备用名称', 'Key Usages': '密钥用途',
    'Extended Key Usages': '扩展密钥用途', 'Signature Algorithm': '签名算法',
    'Basic Constraints': '基本约束', 'Authority Key Identifier': '颁发者密钥标识',
    'Subject Key Identifier': '主体密钥标识', 'Algorithm Identifier': '算法标识',
    'Certificate Policies': '证书策略', 'Challenge Password': '质询口令',
    'General Information': '基本信息', 'Plugin Specific Configuration': '插件专属配置',
    'Custom Plugin': '自定义插件', 'Custom Plugins': '自定义插件',
    'No custom plugins have been added to this Control Plane.': '此控制平面尚未添加自定义插件。',
    'Custom plugins will be available in this control plane only.': '自定义插件仅在此控制平面可用。',
    'Request buffering': '请求缓冲', 'Response buffering': '响应缓冲',
    'Created': '创建时间', 'Updated': '更新时间', 'Advanced': '高级',
    'Retries': '重试次数', 'Interval': '间隔', 'Concurrency': '并发数',
    'Threshold': '阈值', 'Successes': '成功次数', 'Failures': '失败次数',
    'Active': '主动', 'Passive': '被动', 'Healthchecks': '健康检查',
    'Slots': '槽位', 'Algorithms': '算法', 'Comment': '备注', 'Metadata': '元数据',
    'Connect timeout': '连接超时', 'Certificate': '证书',
    'TCP failures': 'TCP 失败次数',
    'Unauthorized': '未授权', 'This plugin is Enabled': '此插件已启用',
    'This plugin is Disabled': '此插件已禁用', 'This plugin is not available': '此插件不可用',
    'This plugin is already applied to this resource': '此插件已应用于该资源',
    'Consumer Plugins': '消费者插件', 'Gateway Service Plugins': '网关服务插件',
    'Gateway Service Routes': '网关服务路由', 'Route Plugins': '路由插件',
    'Other Plugins': '其他插件', 'Key Set Keys': '密钥集中的密钥',
    'Vault Authentication': '保管库认证', 'Vault Configuration': '保管库配置',
    'Vault Type': '保管库类型', 'Vault URI': '保管库 URI',
    'AWS Secrets Manager': 'AWS Secrets Manager', 'HashiCorp Vault': 'HashiCorp Vault',
    'Google Secrets Manager (GCP)': 'Google Secrets Manager (GCP)',
    'Environment Variable Prefix': '环境变量前缀', 'Environment Variables': '环境变量',
    'Google Cloud': 'Google Cloud', 'Amazon Web Services': 'Amazon Web Services',

    /* ---- 插件名称 ---- */
    'ACL Credential': 'ACL 凭据', 'Basic Auth Credential': 'Basic Auth 凭据',
    'Basic Authentication': 'Basic 认证', 'Bot Detection': '机器人检测',
    'Canary Release': '灰度发布', 'Correlation ID': '关联 ID',
    'File Log': '文件日志', 'Forward Proxy': '正向代理', 'gRPC Gateway': 'gRPC 网关',
    'HMAC Authentication': 'HMAC 认证', 'HMAC Credential': 'HMAC 凭据',
    'HTTP Log': 'HTTP 日志', 'IP Restriction': 'IP 限制', 'JWT Credential': 'JWT 凭据',
    'JWT Signer': 'JWT 签发器', 'Kafka Log': 'Kafka 日志', 'Kafka Upstream': 'Kafka 上游',
    'Key Authentication': 'Key 认证', 'Key Auth Credential': 'Key Auth 凭据',
    'Key Authentication Encrypted': 'Key 认证(加密)',
    'Key Auth Encrypted': 'Key Auth(加密)',
    'Key Auth Encrypted Credential': 'Key Auth 加密凭据',
    'LDAP Authentication': 'LDAP 认证', 'LDAP Authentication Advanced': 'LDAP 认证(高级)',
    'Mutual TLS Authentication': '双向 TLS 认证', 'OAS Validation': 'OAS 校验',
    'OpenID Connect': 'OpenID Connect', 'Exit Transformer': '出口转换',
    'Proxy Caching': '代理缓存', 'Proxy Caching Advanced': '代理缓存(高级)',
    'Rate Limiting': '限流', 'Rate Limiting Advanced': '限流(高级)',
    'Request Size Limiting': '请求体大小限制', 'Request Termination': '请求终止',
    'Request Transformer': '请求转换', 'Request Transformer Advanced': '请求转换(高级)',
    'Response Rate Limiting': '响应限流', 'Response Transformer': '响应转换',
    'Response Transformer Advanced': '响应转换(高级)',
    'Route Transformer Advanced': '路由转换(高级)', 'StatsD Advanced': 'StatsD(高级)',
    'TCP Log': 'TCP 日志', 'UDP Log': 'UDP 日志', 'TLS Handshake Modifier': 'TLS 握手修饰',
    'TLS Metadata Headers': 'TLS 元数据头', 'WebSocket Plugins': 'WebSocket 插件',
    'WebSocket Size Limit': 'WebSocket 大小限制', 'WebSocket Validator': 'WebSocket 校验器',
    'XML Threat Protection': 'XML 威胁防护', 'AWS Lambda': 'AWS Lambda',
    'Kong Functions (Pre-Plugins)': 'Kong 函数(插件前)',
    'Kong Functions (Post-Plugins)': 'Kong 函数(插件后)',
    'AI Proxy': 'AI 代理', 'AI Prompt Decorator': 'AI 提示词装饰器',
    'AI Prompt Guard': 'AI 提示词防护', 'AI Prompt Template': 'AI 提示词模板',
    'AI Request Transformer': 'AI 请求转换', 'AI Response Transformer': 'AI 响应转换',
    'GraphQL Proxy Caching Advanced': 'GraphQL 代理缓存(高级)',
    'GraphQL Rate Limiting Advanced': 'GraphQL 限流(高级)',
    'gRPC Web': 'gRPC Web', 'Sessions for Kong authentication': 'Kong 认证会话',
    'Azure Functions': 'Azure 函数',

    /* ---- 插件描述 ---- */
    'Add Basic Authentication to your Services': '为您的服务添加 Basic 认证',
    'Add HMAC Authentication to your Services': '为您的服务添加 HMAC 认证',
    'Add key authentication to your Services': '为您的服务添加 Key 认证',
    'Add OAuth 2.0 authentication to your Services': '为您的服务添加 OAuth 2.0 认证',
    'Access gRPC services through HTTP REST': '通过 HTTP REST 访问 gRPC 服务',
    'Allow browser clients to call gRPC services': '允许浏览器客户端调用 gRPC 服务',
    'Allow developers to make requests from the browser': '允许开发者从浏览器发起请求',
    'Cache and serve commonly requested responses in Kong': '在 Kong 中缓存并提供常用响应',
    'Block requests with bodies greater than a specific size': '拦截请求体超过指定大小的请求',
    'Control which consumers can access Services': '控制哪些消费者可以访问服务',
    'Correlate requests and responses using a unique ID': '使用唯一 ID 关联请求与响应',
    'Customize Kong exit responses sent downstream': '自定义发送给下游的 Kong 出口响应',
    'Detect and clock bots or custom clients': '检测并拦截机器人或自定义客户端',
    'Export performance metrics to Prometheus': '将性能指标导出到 Prometheus',
    'Invoke and manage AWS Lambda functions from Kong': '从 Kong 调用和管理 AWS Lambda 函数',
    'Invoke and manage OpenWhisk actions from Kong': '从 Kong 调用和管理 OpenWhisk 动作',
    'Invoke Azure functions': '调用 Azure 函数',
    'Route requests based on request headers': '基于请求头路由请求',
    'Route by Header': '按请求头路由',
    'Modify the request before hitting the upstream server': '在请求到达上游服务器前修改请求',
    'Send request and response logs to a TCP server': '将请求和响应日志发送到 TCP 服务器',
    'Send request and response logs to a UDP server': '将请求和响应日志发送到 UDP 服务器',
    'Send request and response logs to an HTTP server': '将请求和响应日志发送到 HTTP 服务器',
    'Send request and response logs to Loggly': '将请求和响应日志发送到 Loggly',
    'Send request and response logs to StatsD': '将请求和响应日志发送到 StatsD',
    'Send request and response logs to Syslog': '将请求和响应日志发送到 Syslog',
    'Send traffic and Kong performance metrics to StatsD': '将流量和 Kong 性能指标发送到 StatsD',
    'Publish request and response logs to a Kafka topic': '将请求和响应日志发布到 Kafka 主题',
    'Transform requests into Kafka messages in a topic': '将请求转换为主题中的 Kafka 消息',
    'Append request and response data to a log file on disk': '将请求和响应数据追加到磁盘日志文件',
    'Verify and authenticate JSON Web Tokens': '校验并认证 JSON Web Token',
    'Verify and (re-)sign one or two tokens in a request': '校验并(重新)签发请求中的一或两个令牌',
    'Whitelist or blacklist IPs that can make requests': '对可发起请求的 IP 进行白名单/黑名单控制',
    'Integrate Kong with a LDAP server': '将 Kong 与 LDAP 服务器集成',
    'Authorize requests against Open Policy Agent': '通过 Open Policy Agent 授权请求',
    'Validate requests before they reach their upstream Service.': '在请求到达上游服务前进行校验。',
    'Terminate all requests with a specific response': '以指定响应终止所有请求',
    'Propagate zipkin spans and report spans to a zipkin server': '传播 zipkin span 并上报到 zipkin 服务器',
    'Visualize metrics on Datadog': '在 Datadog 上可视化指标',
    'Map an existing Certificate object to hostnames': '将已有证书对象映射到主机名',
    'Methodically roll out software changes to a subset of users': '可控地向部分用户灰度发布变更',
    'Configure read, send and connect timeouts to an upstream': '为上游配置读、发送和连接超时',
    'Choose how and where to send traffic': '选择流量的发送方式与目标',
    'Gateway services are used to proxy traffic.': '网关服务用于代理流量。',
    'Plugins are used to extend Kong functionality.': '插件用于扩展 Kong 的功能。',
    'Routes proxy requests to an associated Service.': '路由将请求代理到关联的服务。',
    'Upstreams are used to load balance incoming requests.': '上游用于对传入请求进行负载均衡。',
    'SNIs are used to map hostnames to a certificate.': 'SNI 用于将主机名映射到证书。',

    /* ---- 插件配置字段 --- */
    'Access Control Group': '访问控制组', 'Asymmetric Keys': '非对称密钥',
    'CA Certificate': 'CA 证书', 'Client Certificate': '客户端证书',
    'Cookie Path': 'Cookie 路径',
    'Daos': 'DAO', 'Hash on': '哈希依据', 'Hash Fallback': '哈希回退',
    'Healthchecks Threshold': '健康检查阈值', 'HTTP Failures': 'HTTP 失败次数',
    'HTTP Path': 'HTTP 路径', 'HTTP Statuses': 'HTTP 状态码',
    'HTTPS Redirect Status Code': 'HTTPS 重定向状态码', 'HTTPS SNI': 'HTTPS SNI',
    'Query Argument': '查询参数', 'Regex Priority': '正则优先级',
    'URI Capture': 'URI 捕获组', 'Negative Time-to-Live': '负数 TTL',
    'Upstream Timeout': '上游超时', 'Upstream TLS': '上游 TLS',
    'TLS Verify': 'TLS 校验',
    'Raw Data': '原始数据', 'Signed Data': '签名数据', 'Public Certificate': '公有证书',
    'SSL Certificate ID': 'SSL 证书 ID', 'SSL Key Pair': 'SSL 密钥对',
    'If unchecked, use default system setting': '未勾选时使用系统默认设置',
    'Use default system setting': '使用系统默认设置',
    'What to use as hashing input.': '用作哈希输入的内容。',
    'Which load balancing algorithm to use.': '使用的负载均衡算法。',
    'The path to be used in request to the upstream server.': '请求上游服务器时使用的路径。',
    'The protocol used to communicate with the upstream.': '与上游通信使用的协议。',
    'The upstream server port.': '上游服务器端口。',
    'The number of retries to execute upon failure to proxy.': '代理失败时的重试次数。',
    'The name to associate with the given key': '与给定密钥关联的名称',
    'The Service name.': '服务名称。',
    'The username to use in the HMAC Signature verification.': 'HMAC 签名校验使用的用户名。',
    'The algorithm used to verify the token’s signature.': '用于校验令牌签名的算法。',
    'The arbitrary group name to associate to the consumer.': '关联到消费者的任意组名。',
    'Consumer Group ID': '消费者组 ID',
    'Enabled is FTW': '启用',
    'Configuration': '配置', 'Format:': '格式：', 'Structured': '结构化',
    'Raw': '原始', 'JSON': 'JSON', 'Code': '代码', 'Form': '表单',
    'Create New': '新建', 'Configure': '配置',
    'Generate': '生成', 'Regenerate': '重新生成',

    /* ---- 首页 / 错误页 / 杂项 ---- */
    'Resources': '资源',
    'The easiest way to get started with Kong Gateway.': '开始使用 Kong 网关的最简单方式。',
    'Kong Konnect': 'Kong Konnect', 'Konnect': 'Konnect',
    'No credit card required & free plan available': '无需信用卡，提供免费套餐',
    'We cannot find the page you were looking for. Go back to the previous page or': '我们找不到您要访问的页面。请返回上一页或',
    'return home': '返回首页', 'previous page': '上一页',
    'Go back to the previous page': '返回上一页',
    'Page Not Found': '页面未找到',
    'An error has occurred while loading this page.': '加载此页面时发生错误。',
    'Something went wrong.': '出错了。',
    'I wish this page would...': '真希望这个页面能…',
    'Never': '从不', 'None': '无',
    'Default': '默认', 'Custom': '自定义'
  };

  /* 动态文本模式: [正则, 生成函数]。仅在精确词典未命中时尝试。 */
  function entZh(s) {
    s = String(s).trim();
    if (ENT[s]) return ENT[s];
    if (ENT[s.replace(/s$/, '')]) return ENT[s.replace(/s$/, '')];
    return s;
  }
  var TOAST_VERB = { created: '创建', updated: '更新', deleted: '删除', enabled: '启用', disabled: '禁用' };

  var PATTERNS = [
    /* 详情页标题: "Gateway Service: name" / "Key Set: name" (名称未加载时冒号后可为空) */
    [/^(Gateway Services?|Routes?|Consumers?|Plugins?|Upstreams?|Certificates?|CA Certificates?|SNIs?|Targets?|Vaults?|Keys?|Key Sets?|Consumer Groups?|Credentials?|Workspaces?|Teams?)(?::|：)\s*(.*)$/,
      function (m0, t, n) { return entZh(t) + '：' + n; }],

    /* 新建 / 编辑 表单标题: "New Plugin" / "Edit Route" (未在词典中的实体) */
    [/^New\s+(.+)$/, function (m0, t) { return '新建' + entZh(t); }],
    [/^Edit\s+(.+)$/, function (m0, t) { return '编辑' + entZh(t); }],
    [/^Create:\s*(.+)$/, function (m0, t) { return '创建：' + t; }],
    [/^Edit:\s*(.+)$/, function (m0, t) { return '编辑：' + t; }],

    /* 操作成功提示: Gateway Service "foo" successfully created! */
    [/^(Gateway Services?|Routes?|Consumers?|Plugins?|Upstreams?|Certificates?|CA Certificates?|SNIs?|Targets?|Vaults?|Keys?|Key Sets?|Consumer Groups?|Credentials?)\s+"?([^"]*)"?\s+successfully\s+(created|updated|deleted|enabled|disabled)!$/,
      function (m0, t, n, v) { return entZh(t) + '「' + n + '」' + (TOAST_VERB[v] || v) + '成功！'; }],

    /* 列表拉取失败: "Plugins could not be retrieved" */
    [/^(.+?) could not be retrieved$/, function (m0, t) { return '无法获取' + entZh(t); }],
    [/^(.+?) could not be deleted at this time\.?$/, function (m0, t) { return '此时无法删除' + entZh(t) + '。'; }],
    [/^(.+?) could not be edited at this time\.?$/, function (m0, t) { return '此时无法编辑' + entZh(t) + '。'; }],
    [/^The (.+?) could not be deleted at this time\.?$/, function (m0, t) { return '此时无法删除该' + entZh(t) + '。'; }],
    [/^Unable to Delete (.+)$/, function (m0, t) { return '无法删除' + entZh(t); }],
    [/^Error loading (.+)$/, function (m0, t) { return '加载' + t + '出错'; }],
    [/^Failed to (.+)$/, function (m0, t) { return t + '失败'; }],

    /* 删除确认 */
    [/^Are you sure you want to delete this (.+)\?$/, function (m0, t) { return '确定要删除此' + entZh(t) + '吗？'; }],
    [/^Are you sure you want to delete (.+)\?$/, function (m0, t) { return '确定要删除' + entZh(t) + '吗？'; }],

    /* 计数 / 分页信息 */
    [/^([\d,]+)\s+items?$/, function (m0, n) { return n + ' 项'; }],
    [/^([\d,]+)\s+results?$/, function (m0, n) { return n + ' 条结果'; }],

    /* 浏览器标签: "Overview | Kong Manager" */
    [/^(.+?)\s*[|·-]\s*Kong Manager.*$/, function (m0, t) {
      var head = lookupCore(String(t).trim());
      return (head !== null ? head : entZh(t)) + ' | Kong Manager';
    }],

    /* 凭证空态: "Add one of the following Plugins ...: {plugins}" */
    [/^Add one of the following Plugins for the ability to add credentials to this Consumer:\s*(.+)$/,
      function (m0, p) { return '为此消费者添加以下任一插件即可创建凭据：' + p; }]
  ];

  /* ===================== 2. 索引与翻译核心 ===================== */
  var LOWER = Object.create(null);
  for (var key in DICT) {
    if (Object.prototype.hasOwnProperty.call(DICT, key)) LOWER[key.toLowerCase()] = DICT[key];
  }

  function lookupCore(core) {
    var hit = LOWER[core.toLowerCase()];
    if (hit !== undefined) return hit;
    for (var i = 0; i < PATTERNS.length; i++) {
      var m = PATTERNS[i][0].exec(core);
      if (m) {
        try { return PATTERNS[i][1].apply(null, m); } catch (e) { return null; }
      }
    }
    return null;
  }

  /* 返回翻译结果, 原样保留首尾空白; 无命中返回 null */
  function tr(s) {
    if (!s || typeof s !== 'string') return null;
    var first = 0, last = s.length;
    while (first < last && s.charCodeAt(first) <= 32) first++;
    while (last > first && s.charCodeAt(last - 1) <= 32) last--;
    if (first === last) return null;
    var core = s.slice(first, last);
    var out = lookupCore(core);
    if (out === null || out === core) return null;
    return s.slice(0, first) + out + s.slice(last);
  }

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, CODE: 1, PRE: 1, TEXTAREA: 1, NOSCRIPT: 1 };

  function skipped(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS[el.tagName]) return true;
    return !!(el.closest && el.closest('[data-km-i18n-skip]'));
  }

  /* ===================== 3. 写入路径拦截(同步, 无闪烁) ===================== */

  /* 3.1 文本节点值: nodeValue / data */
  function patchNodeValue(proto, prop) {
    var d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || typeof d.set !== 'function' || !d.configurable) return false;
    Object.defineProperty(proto, prop, {
      get: d.get,
      set: function (v) {
        if (typeof v === 'string' && (this.nodeType === 3 /* TEXT */)) {
          var t = tr(v);
          if (t !== null) v = t;
        }
        d.set.call(this, v);
      },
      configurable: true,
      enumerable: d.enumerable
    });
    return true;
  }
  patchNodeValue(Node.prototype, 'nodeValue');
  if (window.CharacterData) patchNodeValue(CharacterData.prototype, 'data');

  /* 3.2 元素文本: textContent / innerText */
  function patchElementText(proto, prop) {
    var d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || typeof d.set !== 'function' || !d.configurable) return false;
    Object.defineProperty(proto, prop, {
      get: d.get,
      set: function (v) {
        if (typeof v === 'string' && this.nodeType === 1 && !skipped(this)) {
          var t = tr(v);
          if (t !== null) v = t;
        }
        d.set.call(this, v);
      },
      configurable: true,
      enumerable: d.enumerable
    });
    return true;
  }
  patchElementText(Node.prototype, 'textContent');
  if (window.HTMLElement) patchElementText(HTMLElement.prototype, 'innerText');

  /* 3.3 setAttribute: placeholder / title / aria-label / alt */
  var ATTRS = { 'placeholder': 1, 'title': 1, 'aria-label': 1, 'alt': 1 };
  var RAW_SET_ATTR = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (typeof value === 'string' && ATTRS[String(name).toLowerCase()] && !skipped(this)) {
      var t = tr(value);
      if (t !== null) value = t;
    }
    return RAW_SET_ATTR.call(this, name, value);
  };

  /* 3.4 document.title (兼容部分实现对 HTMLDocument.prototype 的重定义) */
  try {
    var titleProtos = [Document.prototype];
    if (window.HTMLDocument && window.HTMLDocument.prototype &&
      window.HTMLDocument.prototype !== Document.prototype) {
      titleProtos.push(window.HTMLDocument.prototype);
    }
    for (var ti = 0; ti < titleProtos.length; ti++) {
      var dt = Object.getOwnPropertyDescriptor(titleProtos[ti], 'title');
      if (!dt || typeof dt.set !== 'function' || !dt.configurable) continue;
      Object.defineProperty(titleProtos[ti], 'title', {
        get: dt.get,
        set: (function (orig) {
          return function (v) { var t = tr(v); orig.call(this, t !== null ? t : v); };
        })(dt.set),
        configurable: true,
        enumerable: dt.enumerable
      });
    }
  } catch (e) { /* 忽略 */ }

  /* ===================== 4. Observer 兜底 + 首屏扫描 ===================== */

  function fixTextNode(node) {
    var v = node.nodeValue;
    if (typeof v !== 'string') return;
    var t = tr(v);
    if (t !== null) node.nodeValue = t;   // 已翻译内容再查为 null, 天然幂等
  }

  function fixAttrs(el) {
    if (!el.attributes || skipped(el)) return;
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (!ATTRS[a.name.toLowerCase()]) continue;
      var t = tr(a.value);
      if (t !== null) RAW_SET_ATTR.call(el, a.name, t);
    }
  }

  function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) { fixTextNode(node); return; }
    if (node.nodeType !== 1) return;
    if (skipped(node)) return;
    fixAttrs(node);
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) walk(kids[i]);
  }

  var pending = null;
  var obs = new MutationObserver(function (records) {
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'childList') {
        for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
      } else if (r.type === 'characterData') {
        fixTextNode(r.target);
      } else if (r.type === 'attributes') {
        var el = r.target, n = r.attributeName;
        if (ATTRS[String(n).toLowerCase()] && !skipped(el)) {
          var a = el.getAttribute && el.getAttribute(n);
          if (typeof a === 'string') {
            var t = tr(a);
            if (t !== null) RAW_SET_ATTR.call(el, n, t);
          }
        }
      }
    }
  });

  function startObserve() {
    obs.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label', 'alt']
    });
    walk(document.body || document.documentElement);
  }
  if (document.body) startObserve();
  else document.addEventListener('DOMContentLoaded', startObserve);

  /* ===================== 5. 调试接口 ===================== */
  window.__kmI18n = {
    lang: lang,
    dict: DICT,
    entities: ENT,
    patterns: PATTERNS,
    translate: tr,
    size: Object.keys(DICT).length,
    scan: function () { walk(document.body); return 'scanned'; },
    mount: function () { mountToggle(); return document.getElementById('km-lang-toggle'); }
  };
})();
