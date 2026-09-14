# AIFISHER ComfyUI 节点编号

这个轻量前端扩展在 ComfyUI 经典画布的节点标题右侧显示 `#节点ID`，用于和
AIFISHER 通用工作流的 `NODE 32` 等参数定位信息对应。

- 不修改工作流 JSON、节点标题或连线。
- 默认开启，可在 ComfyUI 设置中搜索“AIFISHER”关闭。
- AIFISHER 画布用户可在“设置 → 本机服务”中一键安装或更新；运行中的
  ComfyUI 不会被自动重启，避免中断队列任务。
- 其他启动器也能使用：把完整的 `fisherai_node_ids` 文件夹复制到
  `ComfyUI/custom_nodes/fisherai_node_ids`，再重启 ComfyUI。
