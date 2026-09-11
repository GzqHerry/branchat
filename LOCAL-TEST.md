# 本地测试

在 Windows PowerShell 中：

```powershell
cd G:\branchat
npm ci --omit=dev --ignore-scripts
$env:TREE_CODEX_EXE = "codex"
node server.mjs
```

浏览器打开 `http://127.0.0.1:47831`。也可以直接双击 `Start.cmd`。

测试路径选择：点击“新建对话”，填写要使用的绝对路径；首条消息发送后，该路径会成为本对话的默认工作目录。

测试 SSH 隔离：使用两个不同的 SSH 用户连接同一主机，分别新建对话；默认只能看到各自的历史。创建对话时选择“公开”，再用另一个用户刷新对话选择器，应看到带 `（公开）` 标记的会话。

测试完成后执行：

```powershell
Stop.cmd
```

运行数据位于 `work\tree-data`，测试时不要把其中的凭据或会话文件提交到 Git。
