<script setup>
import { ref, nextTick, onMounted } from "vue";
import { marked } from "marked";

// --- State ---
const messages = ref([]);
const input = ref("");
const isLoading = ref(false);
const apiConfigured = ref(null);

const model = ref("deepseek-chat");
const models = [
  { id: "deepseek-chat", label: "DeepSeek-V3" },
  { id: "deepseek-reasoner", label: "DeepSeek-R1" },
];

const systemPrompt = ref("");
const chatEl = ref(null);
const weatherStatus = ref(null); // { status, city }
let abortController = null; // 用于中断 fetch 请求

// --- Check API status on mount ---
onMounted(async () => {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    apiConfigured.value = data.api_configured;
  } catch {
    apiConfigured.value = false;
  }
});

// --- Send message ---
async function sendMessage() {
  const text = input.value.trim();
  if (!text || isLoading.value) return;

  messages.value.push({ role: "user", content: text });
  input.value = "";
  weatherStatus.value = null;

  const assistantMsg = { role: "assistant", content: "" };
  messages.value.push(assistantMsg);
  isLoading.value = true;

  // 创建新的 AbortController，用于中断本次请求
  abortController = new AbortController();

  await nextTick();
  scrollToBottom();

  // 天气类问题且用户未显式带城市时，尝试前端定位城市并随请求带上
  let userCity = undefined;
  if (isWeatherQuery(text)) {
    userCity = await getUserCity();
  }

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages.value
          .filter((m) => m.content !== "")
          .map((m) => ({ role: m.role, content: m.content })),
        model: model.value,
        max_tokens: 4096,
        system: systemPrompt.value || undefined,
        userCity,
      }),
      signal: abortController.signal, // 关联中断信号
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === "delta") {
              assistantMsg.content += data.text;
            } else if (data.type === "error") {
              assistantMsg.content = `Error: ${data.message}`;
            } else if (data.type === "weather_status") {
              weatherStatus.value = { status: data.status, city: data.city };
            }
          } catch {
            // skip parse errors
          }
        }
      }
    }
  } catch (err) {
    // AbortError 是用户主动停止，不需要显示错误
    if (err.name !== "AbortError") {
      assistantMsg.content = `Connection error: ${err.message}`;
    }
  } finally {
    isLoading.value = false;
    abortController = null;
    await nextTick();
    scrollToBottom();
  }
}

function scrollToBottom() {
  if (chatEl.value) {
    chatEl.value.scrollTop = chatEl.value.scrollHeight;
  }
}

// 天气相关触发关键词（与后端保持一致）
const WEATHER_KEYWORDS = [
  "天气", "气温", "温度", "多少度", "几度", "下雨", "降雨", "下雪",
  "阴", "晴", "多云", "台风", "暴雨", "大风", "雾霾", "湿度", "体感",
  "气象", "冷不冷", "热不热", "穿什么", "紫外线", "雷阵雨", "冰雹",
];

// 判断文本是否像天气类问题
function isWeatherQuery(text) {
  return WEATHER_KEYWORDS.some((kw) => text.includes(kw));
}

// 前端浏览器定位：拿到经纬度后用 Open-Meteo 反向地理编码得到中文城市名
async function getUserCity() {
  if (!("geolocation" in navigator)) return null;
  try {
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 5000,
        maximumAge: 600000,
      })
    );
    const { latitude, longitude } = pos.coords;
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?latitude=${latitude}&longitude=${longitude}&count=1&language=zh`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const city = data?.results?.[0]?.name;
    return city || null;
  } catch {
    return null;
  }
}

function clearChat() {
  messages.value = [];
}

function handleKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function stopGenerating(){
  // 中断 fetch 请求，这会触发 AbortError，同时后端也能感知到连接断开
  if (abortController) {
    abortController.abort();
  }
  isLoading.value = false;
}

function renderMarkdown(content) {
  return content ? marked.parse(content) : "";
}
</script>

<template>
  <div class="app">
    <!-- Header -->
    <header class="header">
      <h1>DeepSeek Chat</h1>
      <div class="header-controls">
        <select v-model="model" class="model-select">
          <option v-for="m in models" :key="m.id" :value="m.id">
            {{ m.label }}
          </option>
        </select>
        <button class="btn-clear" :disabled="messages.length === 0" @click="clearChat">
          清空消息
        </button>
      </div>
    </header>

    <!-- API warning -->
    <div v-if="apiConfigured === false" class="banner banner-warn">
      ⚠ 请检查您的API Key 是否配置<code>.env</code> and set
      <code>DEEPSEEK_API_KEY</code>, then restart.
    </div>

    <!-- 天气查询状态提示 -->
    <div v-if="weatherStatus" class="banner banner-info">
      <span v-if="weatherStatus.status === 'fetching'">
        🌤 正在查询{{ weatherStatus.city }}天气...
      </span>
      <span v-else-if="weatherStatus.status === 'done'">
        ✅ 已获取{{ weatherStatus.city }}实时天气，正在生成回答...
      </span>
      <span v-else-if="weatherStatus.status === 'failed'">
        ⚠ {{ weatherStatus.city }}天气查询失败，将直接回答
      </span>
    </div>

    <!-- System prompt -->
    <details class="system-prompt-section">
      <summary>系统提示词（可选）</summary>
      <textarea
        v-model="systemPrompt"
        class="system-input"
        placeholder="快来设置系统提示词来控制DeepSeek的回答"
        rows="3"
      />
    </details>

    <!-- Chat area -->
    <main ref="chatEl" class="chat">
      <div v-if="messages.length === 0" class="empty-state">
        <div class="empty-icon">💬</div>
        <p>快和DeepSeek开启对话~</p>
      </div>

      <div
        v-for="(msg, i) in messages"
        :key="i"
        :class="['message', msg.role === 'user' ? 'message-user' : 'message-assistant']"
      >
        <div class="message-role">{{ msg.role === "user" ? "You" : "DeepSeek" }}</div>
        <!-- <div class="message-content">{{ msg.content || "..." }}</div> -->
         <div class="message-content" v-html="renderMarkdown(msg.content)"></div>
      </div>

      <div v-if="isLoading && messages[messages.length - 1]?.content === ''" class="loading">
        DeepSeek思考中<span class="dots" />
      </div>
    </main>

    <!-- Input area -->
    <footer class="input-area">
      <textarea
        v-model="input"
        class="chat-input"
        placeholder="输入你的消息... (Enter发送, Shift+Enter换行)"
        rows="2"
        :disabled="isLoading"
        @keydown="handleKeydown"
      />
      <button class="btn-send" :disabled="!input.trim() || isLoading" @click="sendMessage">
        {{ isLoading ? "发送中..." : "发送" }}
      </button>
      <button class="btn-stop" @click="stopGenerating" :disabled="!isLoading">停止生成</button>
    </footer>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 900px;
  margin: 0 auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-bottom: 1px solid #e5e5e5;
  background: #fff;
  flex-shrink: 0;
}
.header h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.header-controls {
  display: flex;
  gap: 10px;
  align-items: center;
}
.model-select {
  padding: 6px 10px;
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 13px;
  background: #fff;
  cursor: pointer;
}
.btn-clear {
  padding: 6px 14px;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}
.btn-clear:hover:not(:disabled) {
  background: #f5f5f5;
}

.banner {
  padding: 10px 20px;
  font-size: 13px;
  flex-shrink: 0;
}
.banner-warn {
  background: #fff3cd;
  color: #856404;
  border-bottom: 1px solid #ffc107;
}
.banner-info {
  background: #e3f2fd;
  color: #1565c0;
  border-bottom: 1px solid #90caf9;
}
.banner code {
  background: rgba(0, 0, 0, 0.08);
  padding: 1px 5px;
  border-radius: 3px;
}

.system-prompt-section {
  padding: 0 20px;
  border-bottom: 1px solid #e5e5e5;
  flex-shrink: 0;
}
.system-prompt-section summary {
  padding: 10px 0;
  cursor: pointer;
  font-size: 13px;
  color: #666;
  user-select: none;
}
.system-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  margin-bottom: 10px;
  box-sizing: border-box;
}

.chat {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
}
.empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
}
.empty-state p {
  font-size: 15px;
}

.message {
  max-width: 85%;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.message-user {
  align-self: flex-end;
  background: #007aff;
  color: #fff;
}
.message-assistant {
  align-self: flex-start;
  background: #f0f0f0;
  color: #1a1a1a;
}
.message-role {
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 4px;
  opacity: 0.7;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.loading {
  align-self: flex-start;
  font-size: 13px;
  color: #999;
  padding: 8px 16px;
}
.dots::after {
  content: "";
  animation: dots 1.5s steps(4, end) infinite;
}
@keyframes dots {
  0%,
  100% {
    content: "";
  }
  25% {
    content: ".";
  }
  50% {
    content: "..";
  }
  75% {
    content: "...";
  }
}

.input-area {
  display: flex;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid #e5e5e5;
  background: #fff;
  flex-shrink: 0;
}
.chat-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  font-family: inherit;
  resize: none;
}
.chat-input:focus {
  outline: none;
  border-color: #007aff;
  box-shadow: 0 0 0 2px rgba(0, 122, 255, 0.15);
}
.btn-send {
  padding: 0 24px;
  background: #007aff;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.btn-send:hover:not(:disabled) {
  background: #0062cc;
}
.btn-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-stop{
  padding: 0 24px;
  background: #cfdceb;
  color: #000000;
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.btn-stop:hover:not(:disabled) {
  background: #0062cc;
}
.btn-stop:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
