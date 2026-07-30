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

// POST /api/chat — streaming chat with DeepSeek
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

  // Build messages array with system prompt as first message
  const chatMessages = [];
  if (system) {
    chatMessages.push({ role: "system", content: system });
  }
  chatMessages.push(...messages);

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  try {
    const stream = await client.chat.completions.create({
      model,
      max_tokens,
      messages: chatMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        res.write(`data: ${JSON.stringify({ type: "delta", text: delta })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (err) {
    console.error("DeepSeek API error:", err);
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        message: err.message || "Unknown error",
      })}\n\n`
    );
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
    console.warn("⚠ DEEPSEEK_API_KEY not set — edit .env and restart.");
  }
});
