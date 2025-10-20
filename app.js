import express from "express";
import { Client, middleware } from "@line/bot-sdk";

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const app = express();
const client = new Client(config);

// Webhook endpoint (LINE Verify also hits here)
app.post("/webhook", middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

// Health check
app.get("/", (_, res) => res.send("OK"));

async function handleEvent(event) {
  if (event.type === "message" && event.message.type === "text") {
    const text = event.message.text.trim();

    // Entry: keyword trigger example
    if (/^(売却査定|査定)$/u.test(text)) {
      return client.replyMessage(event.replyToken, [
        { type: "text", text: "売却査定をはじめます。約3分・全16問です。途中保存されます。" },
        {
          type: "text",
          text: "まず、売却する物件の種類を教えてください。",
          quickReply: {
            items: ["マンション", "戸建て", "土地", "その他"].map((l) => ({
              type: "action",
              action: { type: "message", label: l, text: l },
            })),
          },
        },
      ]);
    }

    // Fallback echo (replace with your state machine)
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `受信: ${text}`,
    });
  }

  if (event.type === "postback") {
    // Example: handle START_APPRAISAL / SUBMIT / EDIT etc.
    return client.replyMessage(event.replyToken, {
      type: "text",
      text: `postback: ${event.postback?.data || ""}`,
    });
  }

  // Ack for other event types
  return Promise.resolve();
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));
