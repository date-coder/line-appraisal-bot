// scripts/list-richmenus.mjs
import { Client } from "@line/bot-sdk";

const token = process.env.CHANNEL_ACCESS_TOKEN;
if (!token) {
  console.error("CHANNEL_ACCESS_TOKEN が環境変数にありません。先に設定してください。");
  process.exit(1);
}

const client = new Client({ channelAccessToken: token });

try {
  const menus = await client.getRichMenuList();
  if (!menus || menus.length === 0) {
    console.log("リッチメニューはありません。");
  } else {
    for (const m of menus) {
      console.log([
        `ID: ${m.richMenuId}`,
        `Name: ${m.name}`,
        `Size: ${m.size?.width}x${m.size?.height}`,
        `ChatBarText: ${m.chatBarText}`,
        `Areas: ${m.areas?.length}`
      ].join("\n"));
      console.log("----");
    }
  }

  try {
    const defId = await client.getDefaultRichMenuId();
    console.log(`Default: ${defId}`);
  } catch {
    console.log("Default: (not set)");
  }
} catch (e) {
  console.error("ERROR:", e?.originalError?.response?.data || e);
  process.exit(1);
}
