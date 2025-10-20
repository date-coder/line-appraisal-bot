import fs from "fs";
const tmpl = JSON.parse(fs.readFileSync("./templates/confirm.json", "utf8"));

const mapMethod = (m) => ({ desk: "机上査定", online: "オンライン面談", visit: "訪問査定" }[m] || m);
const z = (v) => (v === 0 ? "0" : (v ?? ""));
const row = (label, value) => value ? ({ type: "text", wrap: true, text: `【${label}】${value}` }) : null;
const joinAddr = (a) => [a?.pref, a?.city, a?.street].filter(Boolean).join("");

export function renderFlexConfirm(answers) {
  const bubble = JSON.parse(JSON.stringify(tmpl));
  const body = bubble.contents.body;

  const addr = joinAddr(answers.address || {});
  const type = answers.type;

  const areaLine =
    type === "マンション" && answers.area?.exclusive
      ? `専有 ${answers.area.exclusive}㎡${answers.layout ? `／【間取り】${answers.layout}` : ""}`
      : type === "戸建て" && (answers.area?.land || answers.area?.building)
      ? `土地 ${z(answers.area.land)}㎡／建物 ${z(answers.area.building)}㎡${answers.layout ? `／【間取り】${answers.layout}` : ""}`
      : type === "土地" && answers.area?.land
      ? `土地 ${answers.area.land}㎡`
      : null;

  const items = [
    row("物件種別", type),
    row("住所", [addr, answers.apartment_name ? ` ${answers.apartment_name}${answers.room_no ? ` ${answers.room_no}` : ""}` : ""].join("").trim()),
    row("面積", areaLine),
    type === "戸建て" ? row("築年", answers.year_built || answers.age_built) : null,
    row("現況", answers.occupancy),
    row("所有者", answers.owner_type),
    row("売却理由", answers.sale_reason),
    row("査定方法", mapMethod(answers.appraisal_method)),
    row("時期", answers.sale_timing),
    row("ご連絡", `${answers.contact_method}${answers.name ? `／【氏名】${answers.name}` : ""}`),
    row("備考", answers.notes),
  ].filter(Boolean);

  body.contents = items;
  return bubble;
}
