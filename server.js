import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

function getClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey === "your-api-key-here") {
    return null;
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
  });
}

// ========== 天气功能 ==========

// 中文城市名 → wttr.in 用的拼音名
const CITY_MAP = {
  "北京": "beijing",
  "上海": "shanghai",
  "广州": "guangzhou",
  "深圳": "shenzhen",
  "杭州": "hangzhou",
  "成都": "chengdu",
  "武汉": "wuhan",
  "南京": "nanjing",
  "西安": "xian",
  "重庆": "chongqing",
  "天津": "tianjin",
  "苏州": "suzhou",
  "长沙": "changsha",
  "郑州": "zhengzhou",
  "青岛": "qingdao",
  "大连": "dalian",
  "厦门": "xiamen",
  "福州": "fuzhou",
  "昆明": "kunming",
  "哈尔滨": "haerbin",
  "济南": "jinan",
  "沈阳": "shenyang",
  "合肥": "hefei",
  "南宁": "nanning",
  "贵阳": "guiyang",
  "兰州": "lanzhou",
  "海口": "haikou",
  "三亚": "sanya",
  "珠海": "zhuhai",
  "佛山": "foshan",
  "东莞": "dongguan",
  "无锡": "wuxi",
  "宁波": "ningbo",
  "温州": "wenzhou",
  "石家庄": "shijiazhuang",
  "太原": "taiyuan",
  "呼和浩特": "huhehaote",
  "长春": "changchun",
  "南昌": "nanchang",
  "乌鲁木齐": "wulumuqi",
  "拉萨": "lasa",
  "西宁": "xining",
  "银川": "yinchuan",
  "香港": "hongkong",
  "澳门": "macao",
  "台北": "taipei",
};

/** 从用户文本中提取城市名（精确匹配中文城市名） */
function extractCity(text) {
  for (const city of Object.keys(CITY_MAP)) {
    if (text.includes(city)) return city;
  }
  return null;
}

/**
 * 将任意来源的城市名归一到 CITY_MAP 里的标准中文名。
 * 兼容：中文名直接命中、拼音（含首字母大小写）命中。
 */
function normalizeCity(raw) {
  if (!raw) return null;
  const name = String(raw).trim();
  // 1) 直接中文命中
  if (CITY_MAP[name]) return name;
  // 2) 拼音命中（大小写不敏感）
  const lower = name.toLowerCase();
  for (const [cn, py] of Object.entries(CITY_MAP)) {
    if (py.toLowerCase() === lower) return cn;
  }
  return null;
}

/** 通过请求 IP 兜底定位城市（ip-api.com，免费、无需 key） */
async function getCityByIp(req) {
  try {
    // 优先取可信客户端 IP（经过代理时）
    const fwd = req.headers["x-forwarded-for"];
    const ip = (typeof fwd === "string" ? fwd.split(",")[0] : req.socket?.remoteAddress)?.trim();
    // localhost / 内网地址无法定位
    if (!ip || ip === "::1" || ip.startsWith("127.") || ip.startsWith("192.168.") || ip.startsWith("10.")) {
      return null;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,city`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "success" || !data.city) return null;
    return normalizeCity(data.city);
  } catch {
    return null;
  }
}

/** 调用免费天气 API (wttr.in)，5 秒超时 */
async function fetchWeather(cityPinyin) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(
      `https://wttr.in/${cityPinyin}?format=j1`,
      { signal: controller.signal }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** 将天气 JSON 格式化为可读中文 */
function formatWeather(data, cityCn) {
  const current = data.current_condition?.[0];
  const weather = data.weather;

  let text = `📍 城市: ${cityCn}\n`;

  if (current) {
    text += `🌡 当前温度: ${current.temp_C}°C（体感 ${current.FeelsLikeC}°C）\n`;
    text += `☁ 天气状况: ${current.weatherDesc?.[0]?.value || "未知"}\n`;
    text += `💧 湿度: ${current.humidity}%\n`;
    text += `🌬 风速: ${current.windspeedKmph} km/h（${current.winddir16Point}）\n`;
    text += `👁 能见度: ${current.visibility} km\n`;
  }

  if (weather && weather.length >= 2) {
    const today = weather[0];
    const tomorrow = weather[1];
    text += `\n📅 预报:\n`;
    text += `  今天(${today.date}): ${today.mintempC}°C ~ ${today.maxtempC}°C, ${today.hourly[4]?.weatherDesc?.[0]?.value || "未知"}\n`;
    text += `  明天(${tomorrow.date}): ${tomorrow.mintempC}°C ~ ${tomorrow.maxtempC}°C, ${tomorrow.hourly[4]?.weatherDesc?.[0]?.value || "未知"}\n`;
  }

  return text;
}

// POST /api/chat — streaming chat with DeepSeek（自动注入天气）
app.post("/api/chat", async (req, res) => {
  const client = getClient();
  if (!client) {
    return res.status(401).json({
      error: "DEEPSEEK_API_KEY not configured. Set it in .env file.",
    });
  }

  const { messages, model = "deepseek-chat", max_tokens = 4096, system } = req.body;

  if (!messages || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  // SSE headers（提前设置才能推送天气状态）
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  // ---- 天气检测 & 注入 ----
  const sseSend = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  let finalSystem = system || "";
  const lastMsg = messages[messages.length - 1];

  // 天气相关触发关键词（命中任意一个即尝试查询天气）
  const WEATHER_KEYWORDS = [
    "天气", "气温", "温度", "多少度", "几度", "下雨", "降雨", "下雪",
    "阴", "晴", "多云", "台风", "暴雨", "大风", "雾霾", "湿度", "体感",
    "气象", "冷不冷", "热不热", "穿什么", "紫外线", "雷阵雨", "冰雹",
  ];

  const triggerWeather = WEATHER_KEYWORDS.some((kw) =>
    lastMsg && lastMsg.role === "user" && lastMsg.content.includes(kw)
  );

  if (triggerWeather) {
    // 优先从用户文本提取城市；其次用前端传入的定位城市；最后用 IP 兜底定位
    let cityCn = extractCity(lastMsg.content);
    if (!cityCn && req.body.userCity) {
      cityCn = normalizeCity(req.body.userCity);
    }
    if (!cityCn) {
      cityCn = await getCityByIp(req);
    }
    if (cityCn) {
      sseSend({ type: "weather_status", status: "fetching", city: cityCn });

      const pinyin = CITY_MAP[cityCn];
      const weatherData = await fetchWeather(pinyin);

      if (weatherData) {
        const weatherText = formatWeather(weatherData, cityCn);

        finalSystem = finalSystem
          ? `${finalSystem}\n\n---\n以下是用户所在城市的实时天气信息，请参考这些数据回答用户的问题：\n\n${weatherText}`
          : `你是 DeepSeek 助手。以下是用户所在城市的实时天气信息，请参考这些数据回答用户的问题：\n\n${weatherText}`;

        sseSend({ type: "weather_status", status: "done", city: cityCn });
      } else {
        sseSend({ type: "weather_status", status: "failed", city: cityCn });
      }
    }
  }

  // Build messages array with system prompt as first message
  const chatMessages = [];
  if (finalSystem) {
    chatMessages.push({ role: "system", content: finalSystem });
  }
  chatMessages.push(...messages);

  try {
    const stream = await client.chat.completions.create({
      model,
      max_tokens,
      messages: chatMessages,
      stream: true,
    });

    // 监听客户端断开连接（用户点了"停止生成"或关闭页面）
    let clientDisconnected = false;
    req.on("close", () => {
      clientDisconnected = true;
      // 手动取消 stream 的迭代器，让 for await 跳出循环
      stream.controller.abort();
    });

    for await (const chunk of stream) {
      // 客户端已断开，不再推送数据
      if (clientDisconnected) break;

      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        sseSend({ type: "delta", text: delta });
      }
    }

    if (!clientDisconnected) {
      sseSend({ type: "done" });
    }
    res.end();
  } catch (err) {
    // 客户端断开导致的错误不需要打印
    if (err?.constructor?.name === "APIUserAbortError" || err?.code === "ECONNRESET") {
      // 用户主动停止，静默处理
    } else {
      console.error("DeepSeek API error:", err);
      try {
        sseSend({
          type: "error",
          message: err.message || "Unknown error",
        });
      } catch {}
    }
    res.end();
  }
});

// GET /api/health
app.get("/api/health", (_req, res) => {
  const client = getClient();
  res.json({
    status: "ok",
    api_configured: client !== null,
    provider: "deepseek",
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (!getClient()) {
    console.warn("⚠ DEEPSEEK的API_KEY未配置 — 去.env文件中设置然后重启服务.");
  }
});
