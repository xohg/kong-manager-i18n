// ⚠ 本文件仅用于【离线验证沙箱】(mock_server.js)，真实 Kong 上无效。请勿部署到容器。
// ---------------------------------------------------------------------------
// 为什么真机无效(实测 Kong 3.6 源码):
//   index.html 引用的 /__km_base__/kconfig.js 并不是一个"缺失的静态文件", 而是被
//   Kong 自己的 nginx 精确匹配 location 占用, 由 Lua 动态生成:
//
//     location = /kconfig.js {
//         content_by_lua_block { Kong.admin_gui_kconfig_content() }
//     }
//
//   而 admin_gui.generate_kconfig() 只枚举 kong.conf 的 6 个变量后拼接返回:
//
//     ADMIN_GUI_URL / ADMIN_GUI_PATH / ADMIN_API_URL
//     ADMIN_API_PORT / ADMIN_API_SSL_PORT / ANONYMOUS_REPORTS
//
//   ——没有任何自定义注入口子。nginx 精确匹配 `=` 优先级最高, 因此往
//   /usr/local/kong/gui/ 里放一个 kconfig.js 【永远不会被读取】。
//
// 真机请改用 index.html 注入: 见 deploy/apply-i18n.sh 或 apply-i18n.ps1
// ---------------------------------------------------------------------------
document.write('<script src="/__km_base__/i18n-zh.js?v=3"><\/script>');
