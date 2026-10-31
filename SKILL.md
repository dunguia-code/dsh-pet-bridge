---
name: dsh-pet-bridge
description: 让桌宠（dsh-pet）的对话接到当前 DSH 会话——更聪明的大肥鱼对话（花token版）。当用户想让桌宠说出本体 agent 的回答、而不是桌宠自己那套独立小模型时使用。Patch a local dsh-pet install so its chat routes to the live session agent.
---

# 更聪明的大肥鱼对话（花token版）

把 `dsh-pet` 桌宠的**对话出口**接到当前 DSH 会话：你对着桌面上那只宠物说话，气泡里出现的是**本体 agent** 的回答——有工具、有长期记忆、有当前上下文。

外观和动画不动，只换"谁在说话"。

## 什么时候用

- 用户希望桌宠的回答**知道当前会话**的事（"它怎么不记得我刚才说的"）。
- 用户想要一个随时能按的门铃：打游戏/看视频时不用切窗口就能跟 agent 说话。
- 用户已经在用 `dsh-pet`，并且能接受"这版更聪明但会花 token"。

不适用：想要零成本陪聊、或者不想改第三方包文件的人——用桌宠原生的对话就好。

## 代价（先说清楚）

它会**消耗 token**：每一句话都会变成当前会话里的一轮真实对话（含上下文、工具调用）。桌宠原生的对话走的是另一条轻量链路。

## 步骤

1. 确认已装桌宠：

   ```bash
   dsh plugin --profile desktop list 2>/dev/null | grep dsh-pet || dsh plugin --profile desktop add dsh-pet
   ```

2. 在本仓库目录执行补丁（默认 profile 是 `desktop`，别的 profile 用 `--profile=` 指定）：

   ```bash
   node patch.mjs
   node patch.mjs --profile=web
   ```

3. 退出 DSH 再打开（桌宠是宿主插件，改文件不会热更新；前端样式刷新页面通常就够）。

4. 验证：**确认本体空闲**，右键桌宠 → 对话 → 说话。气泡里应当是本体风格的长回答，而不是宠物自己的短句。

## 卸载

```bash
node patch.mjs --revert
```

宿主与前端两处都会用安装时的备份还原：

```
node_modules/dsh-pet/lib/index.js.dsh-pet-bridge.bak
node_modules/dsh-pet/lib/client.js.dsh-pet-bridge.bak
```

## 排错

`~/.dsh/pet-bridge-debug.json` 记录每次转发走到哪一步：

| step | 含义 |
|---|---|
| `chat-enter` | 进了对话函数（说明补丁生效） |
| `sent` | 消息已投进会话，等本轮结束 |
| `answered` | 拿到回答（`chars` 是字数） |
| `busy` | 本体正在跑一轮，本次回落到宠物自己的模型 |
| `no-agent` / `no-agents` | 找不到活动会话（先在 DSH 里开个会话再说） |
| `timeout` | 180 秒没等到回答 |

常见现象：

- **气泡被"这轮完了，验收"或结束语顶掉**：补丁里的 30 秒静默窗负责压掉这两个写者；若仍出现，说明 `dsh-pet` 版本变了，补丁点需重对。
- **回答被挤成竖条**：气泡宽度补丁没打上（`lib/client.js` 的锚点未命中）。
- **完全没反应**：先看 `step`，再看 DSH 是否是重启后的进程。

## 边界

- 只在宿主 agent **空闲**（`status === "idle"`）时转发，否则会把上一轮回答错当成这一轮。
- 投进去的是**真正的 user 消息**，那一轮 agent 具备工具权限——不要对宠物下达危险指令。
- 纯文本，不带图；宠物原来的表情包配图在此模式下不发。
- 依赖 `dsh-pet` 内部实现（`generateChat`、`publishWorkStatus`、通知监听、气泡样式），上游改结构会失效；脚本锚点不唯一时**中止而不写坏文件**。

## 更好

这是补丁，不是插件，天生脆。更正统的出路是给 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 提 PR，让它原生支持"对话后端可切换"。
