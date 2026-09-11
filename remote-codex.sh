#!/usr/bin/env bash
shopt -s nullglob
tree_candidates=(
  "$HOME"/.vscode-server/extensions/openai.chatgpt-*/bin/*/codex
  "$HOME"/.vscode-server-insiders/extensions/openai.chatgpt-*/bin/*/codex
  "$HOME"/.vscode/extensions/openai.chatgpt-*/bin/*/codex
  "$HOME"/.local/share/codex/bin/codex
  "$HOME"/.nvm/versions/node/*/lib/node_modules/@openai/codex*/vendor/*/codex/codex
  "$HOME"/.nvm/versions/node/*/lib/node_modules/@openai/codex/node_modules/@openai/codex-*/vendor/*/codex/codex
  "$HOME"/.npm-global/lib/node_modules/@openai/codex*/vendor/*/codex/codex
  /usr/local/lib/node_modules/@openai/codex*/vendor/*/codex/codex
  /usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-*/vendor/*/codex/codex
  "$(command -v codex 2>/dev/null)" "$HOME"/.local/bin/codex "$HOME"/.cargo/bin/codex
)
tree_codex=''
for tree_candidate in "${tree_candidates[@]}"; do
  [ -x "$tree_candidate" ] || continue
  if "$tree_candidate" --version >/dev/null 2>&1; then tree_codex="$tree_candidate"; break; fi
done
if [ -z "$tree_codex" ]; then
  printf '%s\n' 'SSH 已连接，但没有找到可运行的 Codex。请在远程安装原生 Codex，或在 VS Code 的远程窗口安装 Codex 扩展并登录。网页无需远程 Node.js 或 Python。' >&2
  exit 1
fi
printf 'TREE_HOME=%s\nTREE_CODEX=%s\n' "$HOME" "$tree_codex"
