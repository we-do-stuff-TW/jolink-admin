// 後台網頁版的**純邏輯**(第四百四十二輪)—— 不碰畫面、不碰網路,node 探針直接 import(scripts/adminwebprobe.mjs)。
//
// 為什麼分家(家規 §3.2 第二句「這個判斷,探針測得到嗎?」):
//   「鈴鐺該不該響、響什麼」「誰算還沒更新」「證據裡哪個檔是哪一則的」「停權能選哪幾種」——
//   這幾個判斷寫在 app.js 的畫面碼裡就只能用眼睛驗;搬到這裡,探針逐條問。
//   app.js 只准「怎麼畫」。
//
// 資料的形狀全部來自 supabase/migrations/0158_admin_console.sql(admin_* 那十支)經 admin 函式轉手。

/* 檢舉理由:App 的選單送的是代碼(personcard／act 那兩個選單),翻回人話。
   ⚠️ 只翻完全相符的;不認得的原樣印(使用者自己打的字不准被「修飾」過再給審核的人看 —— _modqueue showReason 同一條)。
   ⚠️ 終端機那份(_modqueue REASON_ZH)的「其他」講得比較長,網頁放不下;兩邊的代碼要一樣(adminwebprobe 比)。 */
export const REASON = { harassment: "騷擾或攻擊", fake_account: "假帳號", other: "其他" };
export const reasonText = (raw) => {
  const s = String(raw ?? "").trim();
  return REASON[s] ?? s;
};
export const KIND = { message: "訊息", user: "這個人" };

/* 停權能選哪幾種。⚠️ 跟 supabase/functions/_shared/admin.ts 的 BAN_DAYS、_modqueue.mjs、0158 是同一件事的
   第五個地方(瀏覽器載不動那幾支)—— adminwebprobe 把它跟 BAN_DAYS 綁在一起比。 */
export const BAN_CHOICES = [
  { label: "1 天", days: 1 }, { label: "7 天", days: 7 }, { label: "30 天", days: 30 }, { label: "永久", days: "forever" },
];

/* ── 時間 ──────────────────────────────────────────────────────────── */
const TZ = "Asia/Taipei";
const parts = (iso) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { y: p.year, md: `${p.month}-${p.day}`, hm: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
};
/** 「09-28」 */
export const md = (iso) => parts(iso)?.md ?? "—";
/** 「13:54」 */
export const hm = (iso) => parts(iso)?.hm ?? "";
/** 「09-28 13:54」 */
export const mdhm = (iso) => { const p = parts(iso); return p ? `${p.md} ${p.hm}` : "—"; };

/** 等了多久(小時 → 人話)。超過兩天講天。 */
export function waited(hours) {
  const h = Math.max(0, Math.floor(Number(hours) || 0));
  if (h < 48) return `${h} 小時`;
  return `${Math.floor(h / 24)} 天${h % 24 ? ` ${h % 24} 小時` : ""}`;
}

export function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = b / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/* ── 鈴鐺:要處理的事 ────────────────────────────────────────────────
   他 09-28:「有需要處理的我們做一個鈴鐺icon，點擊就可以展開需要處理的事項」。
   資料是 0158 的 admin_bell。⚠️ 一條都沒有＝鈴鐺不帶數字(「沒有要處理的事」)。
   ⚠️ 伺服器互叫的錯誤不在這裡(天天有零星幾發,進鈴鐺就是天天響 —— 0158 admin_bell 檔頭)。 */
export function bellItems(b) {
  if (!b || typeof b !== "object") return [];
  const out = [];
  const n = (v) => Number(v) || 0;
  if (n(b.open_reports) > 0) {
    out.push({ dot: "yellow", text: `${b.open_reports} 筆檢舉等你看`,
      sub: b.oldest_hours != null ? `最舊的等了 ${waited(b.oldest_hours)}` : "", go: { view: "reports", rtab: "open" } });
  }
  for (const o of Array.isArray(b.offenders) ? b.offenders : []) {
    out.push({ dot: "red", text: `${o.name ?? "(查不到名字)"} 近 30 天被 ${o.reporters} 個不同的人檢舉`,
      sub: "還沒停權", go: { view: "reports", rtab: "open", person: o.id } });
  }
  if (n(b.push_fatal_24h) > 0) {
    out.push({ dot: "red", text: "推播憑證出錯", sub: "所有人的推播可能都送不出去", go: { view: "system" } });
  }
  if (n(b.cron_failed_24h) > 0) {
    out.push({ dot: "red", text: `排程失敗 ${b.cron_failed_24h} 次`, sub: "24 小時內", go: { view: "system" } });
  }
  if (n(b.not_updated) > 0 && b.latest_build != null) {
    out.push({ dot: "manual", text: `${b.not_updated} 人還沒更新到 build ${b.latest_build}`,
      sub: n(b.never_reported) > 0 ? `其中 ${b.never_reported} 人從沒回報過版本` : "", go: { view: "people", pf: "old" } });
  }
  if (n(b.new_feedback) > 0) {
    const lf = b.last_feedback;
    out.push({ dot: "blue", text: `${b.new_feedback} 則新的回饋`,
      sub: lf ? `${lf.who ?? "(查不到名字)"} · ${md(lf.at)}` : "", go: { view: "feedback" } });
  }
  return out;
}

/* ── 總覽 ───────────────────────────────────────────────────────────── */
/** 燈號(analytics.v_gate_lights,spec §1.6)→ 畫面上的四列。名字去掉「L0 」這種前綴;
 *  不認得的燈照樣畫(名字＋燈),不吞掉 —— 少一列比多一列危險。 */
export const LIGHT = {
  green: { cls: "ok", word: "過了" }, yellow: { cls: "warm", word: "差一點" }, red: { cls: "red", word: "沒過" },
  invalid: { cls: "dark", word: "沒回太多" }, manual: { cls: "mute", word: "人工判" },
};
const pct = (v) => (v == null || Number.isNaN(Number(v)) ? "—" : `${Math.round(Number(v) * 100)}%`);
export function gateRows(gate) {
  return (Array.isArray(gate) ? gate : []).map((g) => {
    const m = g.metric ?? {};
    const code = /^L(\d)/.exec(g.gate ?? "")?.[1];
    const kv = code === "0" ? [["點開邀請", `${m.invite_opened_21d ?? "—"}`], ["註冊", `${m.signups_21d ?? "—"}`]]
      : code === "1" ? [["揪", `${m.sets_21d ?? "—"} 場`], ["主揪", `${m.distinct_hosts ?? "—"} / 3 位`]]
      : code === "2" ? [["有人加入", `${pct(m.established_share)} / 50%`], ["6 小時內", pct(m.within_6h_share)]]
      : code === "4" ? [["見面率", pct(m.join_to_meet_rate)], ["沒回", `${pct(m.unanswered_rate)} / 40%`]]
      : Object.entries(m).map(([k, v]) => [k, String(v)]);
    const l = LIGHT[g.light] ?? { cls: "mute", word: String(g.light ?? "—") };
    return { name: String(g.gate ?? "").replace(/^L\d\s*/, "") || "—", light: g.light, cls: l.cls, word: l.word, kv, rule: g.rule ?? "" };
  });
}
/** 因為 App 才見到面的場(L4 的 net_new)—— H0 的那個「x / 5」。找不到 L4 回 null(畫面寫「—」,不寫 0)。 */
export function netNew(gate) {
  const g = (Array.isArray(gate) ? gate : []).find((x) => /^L4/.test(x.gate ?? ""));
  return g?.metric?.net_new ?? null;
}
/** 這週／上週。weeks 是 0158 admin_overview 的 weeks(舊到新,最後一格是這週)。 */
export function weekPair(ov) {
  const w = Array.isArray(ov?.weeks) ? ov.weeks : [];
  const cur = w[w.length - 1] ?? {}, prev = w[w.length - 2] ?? {};
  const js = ov?.joined_sets ?? {};
  return [
    { k: "活躍的人", now: cur.active ?? 0, before: prev.active ?? 0 },
    { k: "開的揪", now: cur.sets ?? 0, before: prev.sets ?? 0 },
    { k: "有人加入的揪", now: js.this ?? 0, before: js.last ?? 0 },
    { k: "見到面的揪", now: cur.met ?? 0, before: prev.met ?? 0 },
  ];
}
export function deltaText(now, before) {
  const d = (Number(now) || 0) - (Number(before) || 0);
  return { cls: d > 0 ? "up" : d < 0 ? "down" : "", text: d === 0 ? "跟上週一樣" : `${d > 0 ? "↑" : "↓"} ${Math.abs(d)} 比上週` };
}
/** 成長:每週新註冊 → 累計。只畫最近 maxWeeks 週,累計從第一週算起(前面的週不畫但要加進去)。 */
export function growthSeries(growth, maxWeeks = 16) {
  let acc = 0;
  const all = (Array.isArray(growth) ? growth : []).map((g) => ({ week: g.week, n: Number(g.n) || 0, cum: (acc += Number(g.n) || 0) }));
  return all.slice(-maxWeeks);
}

/* ── 人 ─────────────────────────────────────────────────────────────── */
const DAY = 86400000;
export const buildNum = (b) => (typeof b === "string" && /^\d+$/.test(b) ? Number(b) : null);
/** 還沒更新:不是已刪帳號,而且版本不知道(沒回報過／不是數字)或比最新的舊。⚠️ 不知道的算還沒(§3.7 的方向)。 */
export const isOld = (p, latest) => !p.gone && (buildNum(p.build) == null || (latest != null && buildNum(p.build) < latest));
/** 兩週沒動靜:最近有動作是兩週前,或從來沒有。 */
export const isQuiet = (p, now = Date.now()) => !p.gone && (!p.last || now - new Date(p.last).getTime() > 14 * DAY);
export function peopleFilters(latest, now = Date.now()) {
  return [
    { id: "all", label: "全部", fn: () => true },
    { id: "old", label: "還沒更新", fn: (p) => isOld(p, latest) },
    { id: "quiet", label: "兩週沒動靜", fn: (p) => isQuiet(p, now) },
    { id: "nopush", label: "推播沒開", fn: (p) => !p.gone && !p.push },
    { id: "lonely", label: "沒有朋友", fn: (p) => !p.gone && !p.friends },
    { id: "banned", label: "停權中", fn: (p) => !!p.banned },
    { id: "gone", label: "已刪帳號", fn: (p) => !!p.gone },
  ];
}
/** 找人:名字或自選 ID 含那幾個字(不分大小寫)。 */
export const matchName = (q, name, handle) => {
  const s = String(q ?? "").trim().toLowerCase();
  return !s || String(name ?? "").toLowerCase().includes(s) || String(handle ?? "").toLowerCase().includes(s);
};

/* ── 證據 ───────────────────────────────────────────────────────────── */
/** 證據裡的對話,照時間排:前文、被檢舉的那一則(anchor)、後文。
 *  前後文是 431 輪才有的(開關打開之後的檢舉才有);沒有就只有那一則。
 *  ⚠️ 前後文住 evidence.context.before／after(submit_report:`ctx = { context: { before, after } }`),
 *     不在頂層 —— 讀錯一層＝永遠只看得到那一則,而畫面看起來像「那時候開關還沒開」(adminwebprobe 從
 *     submit_report 原始碼讀這個形狀,不抄)。 */
export function chatLines(ev) {
  if (!ev || typeof ev !== "object") return [];
  const arr = (x) => (Array.isArray(x) ? x : []);
  const ctx = ev.context && typeof ev.context === "object" ? ev.context : {};
  const line = (m, anchor) => ({
    id: m.message_id ?? null, sender: m.sender_id ?? null, kind: m.kind ?? "text",
    body: typeof m.body === "string" ? m.body : "", media: m.media_url ?? null, at: m.created_at ?? null, anchor,
  });
  return [...arr(ctx.before).map((m) => line(m, false)), line(ev, true), ...arr(ctx.after).map((m) => line(m, false))];
}
export const hasContext = (ev) => Array.isArray(ev?.context?.before) || Array.isArray(ev?.context?.after);
/** 檔名:網址或路徑的最後一段,去掉 ?token。 */
export const fileNameOf = (u) => {
  const s = String(u ?? "").split("?")[0];
  return s.slice(s.lastIndexOf("/") + 1);
};
/** 證據櫃裡的檔對回是哪一則的(照檔名;submit_report 拷的時候檔名不變 —— _shared/evidence.ts evidencePath)。
 *  回 { byLine: Map<對話第幾行, 檔>, loose: 對不上任何一則的檔(影片縮圖就是這種)} */
export function matchFiles(lines, files) {
  const byName = new Map((Array.isArray(files) ? files : []).map((f) => [f.name, f]));
  const byLine = new Map(), used = new Set();
  lines.forEach((l, i) => {
    const f = l.media ? byName.get(fileNameOf(l.media)) : null;
    if (f) { byLine.set(i, f); used.add(f.name); }
  });
  const loose = (Array.isArray(files) ? files : []).filter((f) => !used.has(f.name));
  return { byLine, loose };
}
