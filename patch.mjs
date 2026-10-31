#!/usr/bin/env node
/**
 * dsh-pet-bridge —— 把 dsh-pet 桌宠的对话接到你当前的 DSH 会话上。
 *
 * 用法：
 *   node patch.mjs                 # 给 desktop profile 打补丁
 *   node patch.mjs --profile=web   # 指定 profile
 *   node patch.mjs --revert        # 还原（用备份覆盖）
 *
 * 它改两个文件：
 *   lib/index.js（宿主）—— 3 处桥接 + 2 处静默窗
 *     1. 插入一个桥接模块（投递消息、等待回合结束、取回文字）
 *     2. 在 generateChat 入口先走桥接，失败自动回落到桌宠自己的模型
 *     3. 在 session/event 监听里记住最近活动的会话，并在 assistant/message / turn/end 上结算
 *     4/5. 桥接答过的回合压掉 success 状态与完成通知，否则它们会顶掉聊天气泡
 *   lib/client.js（前端）—— 1 处加宽聊天气泡（16f → 30f），否则长回答被挤成竖条
 *
 * 设计约束：桌宠只在「本体空闲」时才转发，避免把上一轮的回答错当成这一轮的。
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const profile = (argv.find((a) => a.startsWith('--profile=')) || '--profile=desktop').split('=')[1];
const revert = argv.includes('--revert');

const target = join(homedir(), '.dsh', 'profiles', profile, 'node_modules', 'dsh-pet', 'lib', 'index.js');
const backup = `${target}.dsh-pet-bridge.bak`;
const clientTarget = join(homedir(), '.dsh', 'profiles', profile, 'node_modules', 'dsh-pet', 'lib', 'client.js');
const clientBackup = `${clientTarget}.dsh-pet-bridge.bak`;

if (!existsSync(target)) {
  console.error(`找不到 dsh-pet：${target}`);
  console.error('请先安装桌宠：dsh plugin --profile ' + profile + ' add dsh-pet');
  process.exit(1);
}

if (revert) {
  let restored = 0;
  for (const [file, bak] of [[target, backup], [clientTarget, clientBackup]]) {
    if (existsSync(bak)) {
      copyFileSync(bak, file);
      console.log(`已还原：${file}`);
      restored += 1;
    }
  }
  if (restored === 0) {
    console.error('没有备份可还原（先从没打过补丁的 dsh-pet 装起才会有备份）。');
    process.exit(1);
  }
  console.log('重启 DSH 后生效。');
  process.exit(0);
}

const BRIDGE = `//#region pet-bridge: 把桌宠对话转发给当前会话里的本体
const PET_BRIDGE_TIMEOUT_MS = 180000;
let petBridgeSessionId = null;
/** 桥接刚答过的静默窗口：这段时间内不弹状态文案、不发完成通知，避免顶掉聊天气泡 */
let petBridgeQuietUntil = 0;
const petBridgeWaiters = new Map();
function petBridgeLog(data) {
\ttry {
\t\tconst dir = join(homedir(), ".dsh");
\t\tmkdirSync(dir, { recursive: true });
\t\twriteFileSync(join(dir, "pet-bridge-debug.json"), JSON.stringify({ at: new Date().toISOString(), ...data }, null, 2), "utf8");
\t} catch (e) { /* 调试写盘失败不影响对话 */ }
}
function petBridgeText(content) {
\tif (!Array.isArray(content)) return "";
\treturn content.filter((p) => p && p.type === "text").map((p) => String(p.text ?? "")).join("\\n").trim();
}
function petBridgeRemember(session) {
\tconst id = String(session?.header?.id ?? session?.id ?? "");
\tif (id) petBridgeSessionId = id;
}
function petBridgeResolve(sessionId, event, type) {
\tconst waiter = petBridgeWaiters.get(sessionId);
\tif (!waiter) return;
\tif (type === "assistant/message") {
\t\tconst text = petBridgeText(event?.data?.message?.content) || "";
\t\tif (text) waiter.last = text;
\t\treturn;
\t}
\tpetBridgeWaiters.delete(sessionId);
\tif (waiter.last) petBridgeQuietUntil = Date.now() + 30000;
\twaiter.finish(waiter.last || "");
}
function petBridgeAsk(ctx, text) {
\treturn new Promise((resolve) => {
\t\tconst agents = ctx.get ? ctx.get("agents") : ctx.agents;
\t\tconst sessionId = petBridgeSessionId;
\t\tif (!agents || !sessionId || typeof agents.get !== "function") {
\t\t\tpetBridgeLog({ step: "no-agents", hasAgents: !!agents, sessionId });
\t\t\treturn resolve(null);
\t\t}
\t\tconst agent = agents.get(sessionId);
\t\tif (!agent || typeof agent.followup !== "function") {
\t\t\tpetBridgeLog({ step: "no-agent", sessionId });
\t\t\treturn resolve(null);
\t\t}
\t\tif (agent.status !== "idle") {
\t\t\tpetBridgeLog({ step: "busy", sessionId, status: agent.status });
\t\t\treturn resolve(null);
\t\t}
\t\tconst timer = setTimeout(() => {
\t\t\tpetBridgeWaiters.delete(sessionId);
\t\t\tpetBridgeLog({ step: "timeout", sessionId });
\t\t\tresolve(null);
\t\t}, PET_BRIDGE_TIMEOUT_MS);
\t\tpetBridgeLog({ step: "sent", sessionId });
\t\tpetBridgeWaiters.set(sessionId, {
\t\t\tlast: "",
\t\t\tfinish: (t) => {
\t\t\t\tclearTimeout(timer);
\t\t\t\tpetBridgeLog({ step: "answered", sessionId, chars: (t || "").length });
\t\t\t\tresolve(t || null);
\t\t\t}
\t\t});
\t\ttry {
\t\t\tagent.followup(createUserMessage({
\t\t\t\tcontent: [{ type: "text", text }],
\t\t\t\tsource: { kind: "pet" }
\t\t\t}));
\t\t} catch (e) {
\t\t\tclearTimeout(timer);
\t\t\tpetBridgeWaiters.delete(sessionId);
\t\t\tpetBridgeLog({ step: "send-threw", sessionId, message: e instanceof Error ? e.message : String(e) });
\t\t\tresolve(null);
\t\t}
\t});
}
//#endregion
`;

const EDITS = [
  {
    label: '插入桥接模块',
    find: '//#region src/host/chat.ts',
    replace: BRIDGE + '//#region src/host/chat.ts',
  },
  {
    label: 'generateChat 先走桥接',
    find: 'async function generateChat(ctx, system, history, userText, pool = [], preferred) {',
    replace: `async function generateChat(ctx, system, history, userText, pool = [], preferred) {
\tpetBridgeLog({ step: "chat-enter", pool: (pool?.length ?? 0) });
\ttry {
\t\tconst bridged = await petBridgeAsk(ctx, userText);
\t\tif (bridged) return { ok: true, text: bridged };
\t} catch (e) {
\t\tpetBridgeLog({ step: "chat-bridge-threw", message: e instanceof Error ? e.message : String(e) });
\t}`,
  },
  {
    label: '会话事件里记住会话 + 收回答',
    find: `\t\t\tconst type = event?.type;
\t\t\tif (!type) return;
\t\t\tconst sessionId = String(session?.header?.id ?? session?.id ?? "unknown");`,
    replace: `\t\t\tconst type = event?.type;
\t\t\tif (!type) return;
\t\t\tconst sessionId = String(session?.header?.id ?? session?.id ?? "unknown");
\t\t\tpetBridgeRemember(session);
\t\t\tif (type === "assistant/message" || type === "turn/end") petBridgeResolve(sessionId, event, type);`,
  },
  {
    label: '桥接答过的那一轮不发 success（否则「这轮完了」会顶掉聊天气泡）',
    find: `\tconst publishWorkStatus = () => {
\t\tconst snap = workStatus.snapshot();`,
    replace: `\tconst publishWorkStatus = () => {
\t\tconst snap = workStatus.snapshot();
\t\tif (snap.state === "success" && Date.now() < petBridgeQuietUntil) {
\t\t\tpublishedWork = "null\\0" + String(snap.task);
\t\t\tpublishedState = null;
\t\t\tpublishedTask = snap.task;
\t\t\tpublishedWorkAt = Date.now();
\t\t\tstate.writeSection("workStatus", { state: null, task: snap.task });
\t\t\treturn;
\t\t}`,
  },
  {
    label: '桥接答过的那一轮不发完成通知（否则结束语会顶掉聊天气泡）',
    find: `\t\t\t\tif (!shouldNotifySession(session)) return;
\t\t\t\tif (isCompletionTurnEnd(event)) {`,
    replace: `\t\t\t\tif (!shouldNotifySession(session)) return;
\t\t\t\tif (Date.now() < petBridgeQuietUntil) return;
\t\t\t\tif (isCompletionTurnEnd(event)) {`,
  },
];

let source = readFileSync(target, 'utf8');

if (source.includes('petBridgeAsk')) {
  console.log('宿主补丁已存在，跳过。');
} else {
  for (const edit of EDITS) {
    const hits = source.split(edit.find).length - 1;
    if (hits !== 1) {
      console.error(`✗ 补丁点「${edit.label}」命中 ${hits} 次（应为 1）。`);
      console.error('  说明你的 dsh-pet 版本与这个补丁不匹配，已中止，文件未被修改。');
      process.exit(1);
    }
    source = source.replace(edit.find, edit.replace);
  }

  if (!existsSync(backup)) {
    copyFileSync(target, backup);
    console.log(`已备份 → ${backup}`);
  }

  writeFileSync(target, source, 'utf8');
  console.log(`✓ 宿主补丁完成：${target}`);
}

// ---- 前端：加宽聊天气泡（否则长回答被挤成一根竖条） ----
if (existsSync(clientTarget)) {
  const OLD = 'max-width:min(calc(var(--f)*16),100%)';
  const NEW = 'max-width:min(calc(var(--f)*30),100%)';
  const client = readFileSync(clientTarget, 'utf8');
  if (client.includes(NEW)) {
    console.log('气泡宽度已是 30f，跳过。');
  } else if (client.split(OLD).length - 1 === 1) {
    if (!existsSync(clientBackup)) copyFileSync(clientTarget, clientBackup);
    writeFileSync(clientTarget, client.replace(OLD, NEW), 'utf8');
    console.log('✓ 气泡加宽完成：16f → 30f（约 277px → 519px）');
  } else {
    console.error('✗ 客户端气泡样式锚点未命中（版本不同），已跳过。宿主补丁不受影响。');
  }
} else {
  console.log('没有 client.js，跳过气泡加宽。');
}

console.log('重启 DSH 后生效（前端改动按 Ctrl+R 刷新页面通常就够）。');
console.log('调试信息写在 ~/.dsh/pet-bridge-debug.json。');
