# RunDock 布局修复独立复验

完整复验记录见用户输出：[rundock-layout-verification.md](/Users/junran/Documents/Codex/2026-09-14/new-chat/outputs/rundock-layout-verification.md)。

本轮在 Chrome CUA 的实际宽屏 `1512 × 767 px` 渲染中确认：无详情时 DOM 不含 inspector，主区延伸到右边界；打开详情后出现右侧 348px inspector；关闭详情后 inspector 消失、主区恢复填满。窄窗使用源码 `max-width: 1100px` 断点证据，因当前浏览器驱动不支持 viewport resize，未虚报实际窄窗截图。空列表因 preview 固定演示数据和删除确认对话框驱动超时，未取得独立截图。
