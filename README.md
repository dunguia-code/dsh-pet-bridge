# dsh-pet-bridge

**更聪明的大肥鱼对话（花token版）**

把 [DeepSeek Harness](https://www.deepseek.com/harness/) 的桌宠 `dsh-pet` 的**对话**接到你当前的会话上：你对着桌面上那只宠物说话，气泡里出现的是**本体（当前 DSH 会话里的 agent）**的回答，而不是宠物自己那套独立的小模型。

> 一句话：让宠物变成你能随身按的门铃，按下去，后面是你自己的 agent。
>
> 为什么叫"花token版"：每句话都会变成当前会话里的一轮真实对话（带上下文、带工具），比桌宠原生那条轻量链路贵。聪明是要付钱的。

## 它解决什么问题

`dsh-pet` 的对话是自成一路的：同一个模型、独立上下文、只有最近几轮记忆。宠物不知道你今天的会话在干什么，也不记得昨天。

这个补丁不改桌宠的外观和动画，只换**对话的出口**：把宠物收到的话，作为一条 user 消息投进你最近的 DSH 会话，等这一轮结束，再把 agent 的回答取出来贴回气泡。

投进去的那一刻，就是"你在跟本体说话"——它有工具、有长期记忆、有当前上下文。

## 安装

前提：已经装了 `dsh-pet`（`dsh plugin --profile desktop add dsh-pet`）。

```bash
node patch.mjs
node patch.mjs --profile=web     # 或指定别的 profile
```

然后**退出 DSH 再打开**（桌宠是宿主插件，改文件不会热更新）。

## 卸载

```bash
node patch.mjs --revert
```

它会用安装时留下的备份覆盖回去（宿主与前端两处）。备份文件在同目录：

```
node_modules/dsh-pet/lib/index.js.dsh-pet-bridge.bak
node_modules/dsh-pet/lib/client.js.dsh-pet-bridge.bak
```

重装或升级 `dsh-pet` 后补丁会丢，重新跑一次 `node patch.mjs` 即可（脚本会检测是否已打过）。

## 怎么用

1. 确认本体**空闲**（没有正在跑的回合）
2. 右键桌宠 → 对话 → 说话
3. 等这一轮结束，气泡里出现本体的回答

## 限制（请先读）

- **只有本体空闲时才转发。** 本体正在跑一轮时，补丁会自动回落到宠物自己的模型，避免把上一轮的回答错当成这一轮的。所以你可能会遇到"这次答得不像本体"的情况——看语气就能分辨。
- **气泡装不下长回答。** 补丁已把气泡最大宽度从 16f 放到 30f（约 277px → 519px），能排成方块了；但仍受桌宠窗口宽度限制（约 2× 桌宠尺寸），回答特别长时会往上顶出屏幕。想读完就回窗口看。
- **投进去的是真正的 user 消息。** 也就是说那一轮 agent 有工具权限。**不要对宠物下达危险指令**（"帮我把系统关掉"之类），它会真的去做。
- **不能带图。** 桥接走的是纯文本；宠物原来的表情包配图在这个模式下不发。
- 依赖 `dsh-pet` 的内部实现（`lib/index.js` 的 `generateChat`/`publishWorkStatus`/通知监听，`lib/client.js` 的气泡样式），**上游改结构就会失效**。脚本会在补丁点命中数不为 1 时中止，不会写坏文件。

## 调试

每次转发都会把状态写进 `~/.dsh/pet-bridge-debug.json`：

```json
{ "step": "answered", "sessionId": "session-...", "chars": 102 }
```

`step` 的取值：`chat-enter` → `sent` → `answered`，或失败分支 `no-agents` / `no-agent` / `busy` / `timeout` / `send-threw`。

## 原理

DSH 的 agent 注册表对插件开放：

```ts
interface Agent {
  followup(message: UserMessage): void
  inject(message: UserMessage): void
  steer(message: UserMessage): void
  whenIdle(): Promise<void>
}
```

于是补丁只需三处改动：

1. 在 `session/event` 监听里记住"最近活动的会话"，并在 `assistant/message` / `turn/end` 上结算回答；
2. 在 `generateChat` 入口先尝试桥接；
3. 新增一个模块负责投递、等待、超时和清理。

## 更好的做法

这是**打补丁**，不是插件，天生脆。更正统的路子有两条：

- 给 `dsh-pet` 提 issue/PR，让它原生支持「对话转发到会话」；
- 写一个独立的 cordis 插件提供 `petBridge` 服务，再让宿主支持插件注册对话后端。

如果你做了其中任一条，这个仓库就可以退休了。

## 许可

MIT。本仓库只包含**补丁脚本**，不包含 `dsh-pet` 的任何代码。

与 DeepSeek、`dsh-pet` 作者均无隶属关系。
