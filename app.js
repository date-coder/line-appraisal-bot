import express from "express";
import * as line from "@line/bot-sdk";                // ← default import
import { renderFlexConfirm } from "./lib/flexConfirm.js";

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const app = express();
const client = new line.Client(config);

// セッション（本番はRedis/Firestoreへ）
const SESS = new Map();

// 共通ヘルパ
const qr = (labels) => ({
  items: labels.map((l) => ({ type: "action", action: { type: "message", label: l, text: l } })),
});
const say = (replyToken, text, labels) =>
  client.replyMessage(replyToken, [{ type: "text", text, ...(labels ? { quickReply: qr(labels) } : {}) }]);

// バリデーション
const reNum = /^\d{1,4}(\.\d{1,2})?$/;
const rePhone = /^0\d{9,10}$/;
const reMail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const reYear = /^(19\d{2}|20\d{2}|築\d{1,2}年)$/;

// 入口（キーワード or リッチメニュー）
const startFlow = async (userId, replyToken) => {
  SESS.set(userId, { state: "ASK_TYPE", answers: {} });
  await client.replyMessage(replyToken, [
    { type: "text", text: "売却査定をはじめます。約3分・全16問前後です。途中保存されます。" },
    { type: "text", text: "まず、売却する物件の【種類】を教えてください。", quickReply: qr(["マンション","戸建て","土地","その他"]) }
  ]);
};

// 中休み
const breakMsg = (replyToken) =>
  say(replyToken, "ここまで物件について伺いました。次はお客様についてお聞かせください。", ["続ける"]);

// 確認カード
const showConfirm = async (userId, replyToken) => {
  const s = SESS.get(userId);
  s.state = "WAIT_CONFIRM";
  const flex = renderFlexConfirm(s.answers);
  return client.replyMessage(replyToken, [{ type: "flex", altText: "査定内容の確認", contents: flex.contents }]);
};

// 保存＆通知（必要ならオン）
async function saveAndNotify(answers) {
  if (process.env.SHEETS_WEBHOOK_URL) {
    await fetch(process.env.SHEETS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(answers),
    }).catch(console.error);
  }
  if (process.env.SLACK_WEBHOOK_URL) {
    const msg = `新規査定：${answers.type}｜${answers.address?.city || ""}｜${answers.appraisal_method}｜${answers.name || ""}`;
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: msg }),
    }).catch(console.error);
  }
}

// follow（友だち追加）時
async function onFollow(ev) {
  return client.replyMessage(ev.replyToken, [
    { type: "text", text: "友だち追加ありがとうございます！営業電話はしません。" },
    { type: "text", text: "よろしければ売却査定をはじめますか？", quickReply: {
      items: [
        { type:"action", action:{ type:"postback", label:"はじめる", data:"START_APPRAISAL" }},
        { type:"action", action:{ type:"message",  label:"あとで",   text:"あとで" }}
      ]
    }}
  ]);
}

// ---- Webhook本体 ----
app.post("/webhook", line.middleware(config), async (req, res) => {
  try {
    await Promise.all(req.body.events.map(handleEvent));
    res.status(200).end();
  } catch (e) {
    console.error(e);
    res.status(500).end();
  }
});

// 状態遷移
async function handleEvent(ev) {
  const userId = ev.source?.userId;
  if (!userId) return;

  // 初期セッション
  const s = SESS.get(userId) || { state: "INIT", answers: {} };
  SESS.set(userId, s);

  // 1) follow
  if (ev.type === "follow") return onFollow(ev);

  // 2) postback
  if (ev.type === "postback") {
    const data = ev.postback?.data || "";
    if (data === "START_APPRAISAL") return startFlow(userId, ev.replyToken);
    if (s.state === "WAIT_CONFIRM" && data === "SUBMIT") {
      await saveAndNotify(s.answers);
      s.state = "DONE";
      return client.replyMessage(ev.replyToken, [
        { type: "text", text: "査定依頼を受け付けました。担当よりご連絡します。" },
        { type: "text", text: "別の物件も査定しますか？",
          quickReply: { items: [{ type:"action", action:{ type:"postback", label:"もう一度査定する", data:"START_APPRAISAL" }}] } }
      ]);
    }
    if (s.state === "WAIT_CONFIRM" && data === "EDIT") {
      s.state = "EDIT_MENU";
      return say(ev.replyToken, "修正したい項目をお選びください。", [
        "住所","建物名","部屋番号","面積","間取り","築年","現況",
        "所有者","売却理由","査定方法","時期","連絡方法","氏名","連絡先","備考"
      ]);
    }
    return;
  }

  // 3) message（本文）
  if (ev.type === "message" && ev.message.type === "text") {
    const t = ev.message.text.trim();

    // ★どの状態でも再スタートOK（最初に判定）
    if (/^(売却査定|査定|新規査定|やり直し|もう一度査定)$/u.test(t)) {
      return startFlow(userId, ev.replyToken);
    }

    // EDITメニュー
    if (s.state === "EDIT_MENU") {
      if (t === "住所") { s.state = "ASK_ADDRESS_PREF"; return say(ev.replyToken, "物件の【都道府県】を教えてください。（例：東京都）"); }
      if (t === "建物名") { s.state = "ASK_APT_NAME"; return say(ev.replyToken, "【建物名】を教えてください。（例：〇〇マンション）"); }
      if (t === "部屋番号") { s.state = "ASK_APT_ROOMNO"; return say(ev.replyToken, "【部屋番号】を入力してください。（例：305／305号室）"); }
      if (t === "面積") { s.state = s.answers.type==="戸建て" ? "ASK_AREA_LAND" : "ASK_AREA"; return say(ev.replyToken, s.answers.type==="戸建て"?"まず【土地面積】を半角数字で（例：80.12）":"【面積】を半角数字で（㎡、例：65.34）"); }
      if (t === "間取り") { s.state = "ASK_LAYOUT"; return say(ev.replyToken, "【間取り】を選んでください。", ["1R","1K","1DK","1LDK","2LDK","3LDK","4LDK以上","不明"]); }
      if (t === "築年") { s.state = "ASK_YEAR_BUILT"; return say(ev.replyToken, "（戸建ての場合のみ）【築年】または【築年数】（例：2003 / 築22年）"); }
      if (t === "現況") { s.state = "ASK_STATUS"; return say(ev.replyToken, "現在の【ご状況】を教えてください。", ["居住中","空室","賃貸中","更地","建築中"]); }
      if (t === "所有者") { s.state = "ASK_OWNER"; return say(ev.replyToken, "物件の【所有者】について教えてください。", ["本人所有","親族所有","法人名義","相続予定","代理人","第三者"]); }
      if (t === "売却理由") { s.state = "ASK_REASON"; return say(ev.replyToken, "【ご売却の理由】を教えてください。", ["住み替え(決定済み)","住み替え(検討中)","相続整理","資産整理","転勤/転居","離婚等","空き家対策 賃貸→売却","その他"]); }
      if (t === "査定方法") { s.state = "ASK_METHOD"; return say(ev.replyToken, "【査定方法】をお選びください。", ["机上査定","オンライン面談","訪問査定"]); }
      if (t === "時期") { s.state = "ASK_TIMING"; return say(ev.replyToken, "【売却時期】の目安があればお知らせください。", ["できるだけ早く","3か月以内","半年以内","1年以内","未定"]); }
      if (t === "連絡方法") { s.state = "ASK_CONTACT_METHOD"; return say(ev.replyToken, "ご連絡はどの方法がよろしいですか？", ["LINEのみ","電話","メール"]); }
      if (t === "氏名") { s.state = "ASK_NAME"; return say(ev.replyToken, "【お名前（フルネーム）】をご入力ください。"); }
      if (t === "連絡先") { s.state = s.answers.contact_method==="電話"?"ASK_PHONE":"ASK_EMAIL"; return say(ev.replyToken, s.state==="ASK_PHONE"?"【電話番号】（例：09012345678）":"【メールアドレス】（例：example@domain.jp）"); }
      if (t === "備考") { s.state = "ASK_NOTES"; return say(ev.replyToken, "【気になる点】があればご自由にご記入ください。"); }
      s.state = "WAIT_CONFIRM"; return showConfirm(userId, ev.replyToken);
    }

    // --- 物件のこと（1〜7） ---
    if (s.state === "ASK_TYPE" && ["マンション","戸建て","土地","その他"].includes(t)) {
      s.answers.type = t; s.state = "ASK_ADDRESS_PREF";
      return say(ev.replyToken, `${t}ですね、承知しました。物件の【都道府県】を教えてください。（例：東京都）`);
    }
    if (s.state === "ASK_ADDRESS_PREF") { s.answers.address = { pref: t }; s.state = "ASK_ADDRESS_CITY"; return say(ev.replyToken,"続いて【市区町村】を教えてください。（例：杉並区 / 横浜市鶴見区）"); }
    if (s.state === "ASK_ADDRESS_CITY")  { s.answers.address.city = t; s.state = "ASK_ADDRESS_STREET"; return say(ev.replyToken,"【町名・番地】をご入力ください。（例：阿佐谷南1-23-4）"); }
    if (s.state === "ASK_ADDRESS_STREET"){ 
      s.answers.address.street = t; 
      if (s.answers.type === "マンション") {
        s.state = "ASK_APT_NAME";
        return say(ev.replyToken, "【建物名】を教えてください。（例：〇〇マンション）");
      }
      s.state = (s.answers.type === "戸建て") ? "ASK_AREA_LAND" : "ASK_AREA";
      return say(ev.replyToken, s.state==="ASK_AREA" ? "【面積】を半角数字で（㎡、例：65.34）" : "まず【土地面積】を半角数字で（例：80.12）");
    }

    // （マンション）建物名
    if (s.state === "ASK_APT_NAME") {
      // うっかり「〇〇マンション 305号室」と一行で来たら自動分割
      const m = t.match(/^(.+?)\s*([0-9A-Za-z\-]+(?:号室)?)?$/u);
      s.answers.apartment_name = (m?.[1] || t).trim();

      if (m?.[2]) {
        s.answers.room_no = m[2].replace(/\s+/g, "");
        s.state = "ASK_AREA";
        return say(ev.replyToken, "【専有面積】を半角数字で（㎡、例：65.34）");
      }
      s.state = "ASK_APT_ROOMNO";
      return say(ev.replyToken, "【部屋番号】を入力してください。（例：305／305号室）");
    }

    // （マンション）部屋番号
    if (s.state === "ASK_APT_ROOMNO") {
      const room = t.replace(/\s+/g, "");
      const ok = /^[0-9A-Za-z\-]+(号室)?$/u.test(room); // 305, 1201, 3-12, 305号室 など
      if (!ok) return say(ev.replyToken, "部屋番号の形式でお願いします。（例：305／305号室）");
      s.answers.room_no = room;
      s.state = "ASK_AREA";
      return say(ev.replyToken, "【専有面積】を半角数字で（㎡、例：65.34）");
    }

    if (s.state === "ASK_AREA") {
      if (!reNum.test(t)) return say(ev.replyToken,"うまく受け取れませんでした。例：65.34（㎡）",null);
      if (s.answers.type==="マンション") { s.answers.area = { exclusive: t }; }
      if (s.answers.type==="土地")      { s.answers.area = { land: t }; }
      s.state = "ASK_LAYOUT"; return say(ev.replyToken,"【間取り】を選んでください。",["1R","1K","1DK","1LDK","2LDK","3LDK","4LDK以上","不明"]);
    }
    if (s.state === "ASK_AREA_LAND") {
      if (!reNum.test(t)) return say(ev.replyToken,"例：80.12（㎡）でお願いします。",null);
      s.answers.area = { land: t }; s.state = "ASK_AREA_BUILDING";
      return say(ev.replyToken,"つづいて【建物面積】を半角数字で（例：95.60）");
    }
    if (s.state === "ASK_AREA_BUILDING") {
      if (!reNum.test(t)) return say(ev.replyToken,"例：95.60（㎡）でお願いします。",null);
      s.answers.area.building = t; s.state = "ASK_LAYOUT";
      return say(ev.replyToken,"【間取り】を選んでください。",["1R","1K","1DK","1LDK","2LDK","3LDK","4LDK以上","不明"]);
    }
    if (s.state === "ASK_LAYOUT" && ["1R","1K","1DK","1LDK","2LDK","3LDK","4LDK以上","不明"].includes(t)) {
      s.answers.layout = t; 
      if (s.answers.type==="戸建て") { s.state = "ASK_YEAR_BUILT"; return say(ev.replyToken,"（戸建て）【築年】または【築年数】（例：2003 / 築22年）"); }
      s.state = "ASK_STATUS"; return say(ev.replyToken,"現在の【ご状況】を教えてください。",["居住中","空室","賃貸中","更地","建築中"]);
    }
    if (s.state === "ASK_YEAR_BUILT") {
      if (!reYear.test(t)) return say(ev.replyToken,"例：2003 / 築22年 の形式でお願いします。",null);
      if (/^築/.test(t)) s.answers.age_built = t; else s.answers.year_built = t;
      s.state = "ASK_STATUS"; return say(ev.replyToken,"現在の【ご状況】を教えてください。",["居住中","空室","賃貸中","更地","建築中"]);
    }
    if (s.state === "ASK_STATUS" && ["居住中","空室","賃貸中","更地","建築中"].includes(t)) {
      s.answers.occupancy = t; s.state = "ASK_BREAK_CUSTOMER"; return breakMsg(ev.replyToken);
    }
    if (s.state === "ASK_BREAK_CUSTOMER" && t === "続ける") {
      s.state = "ASK_OWNER"; return say(ev.replyToken,"物件の【所有者】について教えてください。",["本人所有","親族所有","法人名義","相続予定","代理人","第三者"]);
    }

    // --- お客様のこと（8〜16） ---
    if (s.state === "ASK_OWNER" && ["本人所有","親族所有","法人名義","相続予定","代理人","第三者"].includes(t)) {
      s.answers.owner_type = t; s.state = "ASK_REASON";
      return say(ev.replyToken,"【ご売却の理由】を教えてください。",["住み替え(決定済み)","住み替え(検討中)","相続整理","資産整理","転勤/転居","離婚等","空き家対策 賃貸→売却","その他"]);
    }
    if (s.state === "ASK_REASON") {
      s.answers.sale_reason = t; s.state = "ASK_METHOD";
      return say(ev.replyToken,"ご希望の【査定方法】をお選びください。",["机上査定","オンライン面談","訪問査定"]);
    }
    if (s.state === "ASK_METHOD" && ["机上査定","オンライン面談","訪問査定"].includes(t)) {
      s.answers.appraisal_method = ({ "机上査定":"desk", "オンライン面談":"online", "訪問査定":"visit" })[t];
      s.state = "ASK_TIMING";
      return say(ev.replyToken,"【売却時期】の目安があればお知らせください。",["できるだけ早く","3か月以内","半年以内","1年以内","未定"]);
    }
    if (s.state === "ASK_TIMING" && ["できるだけ早く","3か月以内","半年以内","1年以内","未定"].includes(t)) {
      s.answers.sale_timing = t; s.state = "ASK_CONTACT_METHOD";
      return say(ev.replyToken,"ご連絡はどの方法がよろしいですか？",["LINEのみ","電話","メール"]);
    }
    if (s.state === "ASK_CONTACT_METHOD" && ["LINEのみ","電話","メール"].includes(t)) {
      s.answers.contact_method = t; s.state = "ASK_NAME";
      return say(ev.replyToken,"【お名前（フルネーム）】をご入力ください。");
    }
    if (s.state === "ASK_NAME") {
      s.answers.name = t; 
      if (s.answers.contact_method === "電話") { s.state = "ASK_PHONE"; return say(ev.replyToken,"【電話番号】（例：09012345678）"); }
      if (s.answers.contact_method === "メール") { s.state = "ASK_EMAIL"; return say(ev.replyToken,"【メールアドレス】（例：example@domain.jp）"); }
      s.state = "ASK_NOTES"; return say(ev.replyToken,"【備考】があればご記入ください。なければ「なし」でOKです。");
    }
    if (s.state === "ASK_PHONE") {
      if (!rePhone.test(t)) return say(ev.replyToken,"電話番号はハイフン無しで10-11桁でお願いします。（例：09012345678）");
      s.answers.phone = t; s.state = "ASK_NOTES";
      return say(ev.replyToken,"【備考】があればご記入ください。なければ「なし」でOKです。");
    }
    if (s.state === "ASK_EMAIL") {
      if (!reMail.test(t)) return say(ev.replyToken,"メール形式でお願いします。（例：example@domain.jp）");
      s.answers.email = t; s.state = "ASK_NOTES";
      return say(ev.replyToken,"【備考】があればご記入ください。なければ「なし」でOKです。");
    }
    if (s.state === "ASK_NOTES") {
      if (t !== "なし") s.answers.notes = t;
      s.state = "ASK_PRIVACY";
      const url = process.env.PRIVACY_URL || "https://example.com/privacy";
      return say(ev.replyToken, `【プライバシーポリシー】\n${url}\n同意いただける場合は「同意する」を選んでください。`, ["同意する"]);
    }
    if (s.state === "ASK_PRIVACY" && t === "同意する") {
      s.answers.privacy_agree = true;
      return showConfirm(userId, ev.replyToken);
    }

    // フォールバック
    if (/^(ありがとう|ありがとうございます|感謝|サンキュー)$/u.test(t))
      return say(ev.replyToken, "こちらこそ、ありがとうございます！");
    return Promise.resolve();
  }
}

// ヘルスチェック
app.get("/", (_, res) => res.send("OK"));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on ${port}`));
