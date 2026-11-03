// 後台網頁版的**純邏輯**(第四百四十二輪)—— 不碰畫面、不碰網路,node 探針直接 import(scripts/adminwebprobe.mjs)。
//
// 為什麼分家(家規 §3.2 第二句「這個判斷,探針測得到嗎?」):
//   「鈴鐺該不該響、響什麼」「誰算還沒更新」「證據裡哪個檔是哪一則的」「停權能選哪幾種」——
//   這幾個判斷寫在 app.js 的畫面碼裡就只能用眼睛驗;搬到這裡,探針逐條問。
//   app.js 只准「怎麼畫」。
//
// 資料的形狀全部來自 supabase/migrations/0158_admin_console.sql(admin_* 那十支)經 admin 函式轉手。

/* 檢舉理由:App 的選單送的是代碼(lib/reportflow 的 REPORT_REASONS),翻回人話。
   ⚠️ 這是 supabase/functions/_shared/reportreasons.ts 那張表的**逐字雙胞胎**(瀏覽器載不到那個資料夾;第二十八次健檢 藍收成一份＋這一份)——
      adminwebprobe 逐格比(鍵與字都要一樣),改字要兩邊一起改。🪦 以前終端機那份「其他」講得比較長、信裡一份都沒有。
   ⚠️ 只翻完全相符的;不認得的原樣印(使用者自己打的字不准被「修飾」過再給審核的人看)。 */
export const REASON = { harassment: "騷擾或攻擊", fake_account: "假帳號", other: "其他" };
export const reasonText = (raw) => {
  const s = String(raw ?? "").trim();
  return REASON[s] ?? s;
};
/* 檢舉的層級(reports.target_type)。⚠️ 'activity'(這場揪)第二十五次健檢 K183 起才有人寫(新 build 從揪卡進來;
   0096 的 CHECK 早就留了這一格)—— 以前揪卡那一筆也記成 'user',後台寫「這個人」。 */
export const KIND = { message: "訊息", user: "這個人", activity: "這場揪" };

/* 停權能選哪幾種。⚠️ 跟 supabase/functions/_shared/admin.ts 的 BAN_DAYS、_modqueue.mjs、0158 是同一件事的
   第五個地方(瀏覽器載不動那幾支)—— adminwebprobe 把它跟 BAN_DAYS 綁在一起比。 */
export const BAN_CHOICES = [
  { label: "1 天", days: 1 }, { label: "7 天", days: 7 }, { label: "30 天", days: 30 }, { label: "永久", days: "forever" },
];
/** 停權改短的確認句(第二十一次健檢卡 3)。資料庫(0163 admin_ban)擋下「這樣會提早放人」之後,停權框多一行問這句。
 *  current:對方現在停到哪 —— ISO 時間,或 "forever"(永久;沒有期限那一列)。label:這次選的那一格(「7 天」)。
 *  ⚠️ 「算不算改短」只住資料庫那一支;這裡只負責把它講成人話(不自己判斷,判斷寫兩份就會漂)。 */
export const shortenText = (current, label) =>
  `現在${current == null || current === "forever" ? "是永久停權" : "停到 " + mdhm(current)}，改成停 ${label}會提早放人。`;

/* ── 驗證器的條碼 ──────────────────────────────────────────────────
   GoTrue 的 /factors 回的 totp.qr_code 是**一段 SVG 原始碼**,不是網址 —— 官方套件(auth-js GoTrueClient 的 enroll)
   會自己在前面補 `data:image/svg+xml;utf-8,`;我們沒載套件,少了這一步 <img> 就是破圖(09-28 他第一次綁就撞到)。
   這裡把它變成網址,而且整段 encodeURIComponent(原始碼裡有 # 的話,沒編碼會被當成網址的片段切掉)。
   已經是 data: 的原樣回(哪天 GoTrue 改成直接給網址也不會壞)。 */
export function qrDataUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^data:/i.test(s)) return s;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
}

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

/** ⚠️ supabase/functions/_shared/planusage.ts 有一份逐字的雙胞胎(週報那幾行用;那邊載不到這一頁)。改這裡要一起改,quotaprobe §B 拿同一串數字比兩邊。 */
export function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = b / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/* ── 額度:資料庫與倉庫用到哪了(0215 的 plan_usage;第三十次健檢卡 10)────────────
   系統頁那兩行與鈴鐺都從這一支拿(同一份 level → 燈、字)。⚠️ 不在這裡判門檻:用了多少算「快滿了」是資料庫說的(level),
   這裡只把 level 翻成燈與字。usage 是 null(0215 還沒上、或 plan_usage 問不到)→ 一行都不畫(不畫成「正常」—— 那會是一句假話)。 */
export const USAGE_NAME = { db: "資料庫", storage: "倉庫" };   // 週報叫同一個名字(_shared/planusage.ts 的 USAGE_NAME)
const USAGE_LOOK = {
  ok: { light: "green", word: "正常" },
  warn: { light: "yellow", word: "快滿了" },
  full: { light: "red", word: "滿了" },
};
export function usageRows(u) {
  if (!u || typeof u !== "object") return [];
  const out = [];
  for (const k of ["db", "storage"]) {
    const c = u[k];
    if (!c || typeof c !== "object") continue;
    const look = USAGE_LOOK[c.level] ?? { light: "manual", word: "算不出來" };
    const nm = USAGE_NAME[k];
    const known = c.level in USAGE_LOOK;
    out.push({
      k, nm, level: c.level, light: look.light, word: look.word,
      kv: known ? [["用了", `${fmtBytes(c.used)}(${c.pct}%)`], ["上限", fmtBytes(c.limit)]] : [["上限", c.limit ? fmtBytes(c.limit) : "沒設"]],
      bell: c.level === "full" ? `${nm}滿了` : `${nm}用到 ${c.pct}%`,
      span: `${fmtBytes(c.used)} / ${fmtBytes(c.limit)}`,
    });
  }
  return out;
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
  /* 0164(第二十一次健檢卡 5):背景工作被擋／沒送出去、巡邏停了。暗號對不上那天,寄警報信的那支也被擋 ——
     後台(用 Google 登入,不靠那把暗號)是唯一還醒著的窗口。哪幾種算大事由資料庫與 netalarm.ts 決定,這裡只畫。 */
  if (n(b.net_blocked_24h) > 0) {
    const labels = Array.isArray(b.net_blocked_labels) ? b.net_blocked_labels : [];
    out.push({ dot: "red", text: `背景工作被擋 ${b.net_blocked_24h} 發`, sub: labels.length ? `${labels.join("、")} · 24 小時內` : "24 小時內",
      go: { view: "system" } });
  }
  if (b.patrol_stale === true) {
    out.push({ dot: "red", text: "巡邏停了", sub: b.patrol_scanned_at ? `上次 ${mdhm(b.patrol_scanned_at)}` : "還沒跑過", go: { view: "system" } });
  }
  /* 0215(第三十次健檢卡 10):資料庫、倉庫過了警告線(warn)或滿了(full)。上限與警告線只住資料庫的 plan_usage,這裡只照 level 畫。 */
  for (const r of usageRows(b.usage)) {
    if (r.level === "warn" || r.level === "full") out.push({ dot: r.light, text: r.bell, sub: r.span, go: { view: "system" } });
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
/** L4「沒回」那格:按人數的未回率,0204 起括號裡多主揪未回率(第二十八次健檢拍板單 C18)—— 兩個任一 >40% 燈就是「沒回太多」,
 *  所以兩個都寫出來:只寫按人數的話,燈亮「沒回太多」旁邊卻寫「14% / 40%」,看不出是哪一道擋的(要補催的是主揪)。
 *  主揪那個數沒有值 → 照舊只寫一個,不寫「主揪 —」(那會像壞了)。沒有值有兩種:伺服器還沒上 0204(metric 裡沒有那一格)、
 *  窗裡沒有算數的場(「資料不足」:那一格在、值是 null)。🪦 第一版只問「那一格在不在」,資料不足時寫成「—(主揪 —) / 40%」(檢查員抓的)。 */
const unansText = (m) => (m.host_unanswered_rate != null
  ? `${pct(m.unanswered_rate)}(主揪 ${pct(m.host_unanswered_rate)}) / 40%`
  : `${pct(m.unanswered_rate)} / 40%`);
export function gateRows(gate) {
  return (Array.isArray(gate) ? gate : []).map((g) => {
    const m = g.metric ?? {};
    const code = /^L(\d)/.exec(g.gate ?? "")?.[1];
    const kv = code === "0" ? [["點開邀請", `${m.invite_opened_21d ?? "—"}`], ["註冊", `${m.signups_21d ?? "—"}`]]
      : code === "1" ? [["揪", `${m.sets_21d ?? "—"} 場`], ["主揪", `${m.distinct_hosts ?? "—"} / 3 位`]]
      : code === "2" ? [["有人加入", `${pct(m.established_share)} / 50%`], ["6 小時內", pct(m.within_6h_share)]]
      : code === "4" ? [["見面率", pct(m.join_to_meet_rate)], ["沒回", unansText(m)]]
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

/* ── 總覽的主角:目前註冊人數(第四百四十五輪起;474 換成 Synthex 深色頂帶的半圓儀表)────────
   他 09-28:「目前註冊人數要是 dashboard 的最上面中間顯示的,最明顯的,最重要的」。 */
/** 目前＝totals.users(0158 admin_overview 的 totals,只數 deleted_at 是空的);
 *  註冊過＝growth 累計(同一支的 growth,數 public.users 每一列、含刪了帳號的;最後一格永遠是這週 —— generate_series 到 now())。
 *  ⚠️ 兩個數會一起出現在畫面上(大數字 10、「每週新註冊」那張卡寫註冊過 11),差的那幾個一定要寫出來(刪了帳號 N),不然像算錯。
 *  ⚠️ 伺服器沒給 totals.users 就是 null(畫「—」),不是 0:0 會讓人以為大家都跑了。 */
export function regCounts(ov) {
  const g = growthSeries(ov?.growth, Number.MAX_SAFE_INTEGER);
  const u = ov?.totals?.users;
  const now = u == null || !Number.isFinite(Number(u)) ? null : Number(u);
  const ever = g.length ? g[g.length - 1].cum : null;
  return { now, ever, week: g.length ? g[g.length - 1].n : 0, gone: ever != null && now != null ? Math.max(0, ever - now) : 0 };
}
/** 頂帶那個半圓儀表的弧(第四百七十四輪):弧＝這週有動作的人 / 目前註冊人數,弧尖那顆膠囊寫「N 人這週有動作」。
 *  有動作＝weeks 最後一格的 active(v_weekly 的 active_users,這週開揪、加入、按過東西的人)。
 *  ⚠️ 只畫有分母的:目前註冊人數不知道(null)或是 0 → 不畫弧(f＝0),不准拿別的數頂替分母。
 *  ⚠️ active 數的是「那週有動作的帳號」、可能含這週剛刪帳號的人,users 不含 —— 理論上 act 會比 now 多一點點;
 *     弧夾在 1(滿弧),膠囊上的字照實寫 act(不改數字,只是弧畫不出超過一圈的部分)。 */
export function actGauge(ov) {
  const w = Array.isArray(ov?.weeks) ? ov.weeks : [];
  const act = Number(w[w.length - 1]?.active) || 0;
  const now = regCounts(ov).now;
  return { act, now, f: now ? Math.min(1, act / now) : 0 };
}
/** 圖的刻度:最多四格,一格是 1／2／5／10 × 10 的次方,至少 1(人數沒有半個)。max 一定 ≥ 資料最大值。 */
export function niceScale(m) {
  const raw = Math.max(Number(m) || 0, 1) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(1, [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw));
  return { step, max: Math.max(step, Math.ceil((Number(m) || 0) / step) * step) };
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
/** 記事那一列的 body_check(0205;第二十八次健檢收尾)哪幾種值算「伺服器親手確認過,字就是講的那個人說的」。
 *  五種值與意思只住 0205 的 CHECK 與欄位註解;這裡只分「算對過」與「不算」—— actreportprobe 從 0205 原文讀那五種,
 *  逐一問這裡,多一種沒分到就紅(不准有一種值兩邊各講各的)。
 *    quoted 寫進來那一刻原話在、字一樣 ／ own 自己寫的 ／ requoted 0205 從還在的原話重抄 ／ same 0205 對過,本來就一樣。
 *  不在這裡面的(unchecked、快照裡沒有這一格、認不得的值)一律當「沒對過」—— 往多標那邊倒:
 *  多標的代價是一行提醒,少標的代價是把手機送的字當成原話。 */
export const NOTE_BODY_OK = new Set(["quoted", "own", "requoted", "same"]);
/** 證據是從記事本拍的(submit_report 的記事快照,第二十八次健檢拍板單 C6)→ 後台多畫一行「記事本:◯◯ 存的」要的東西;不是 → null。
 *  存的人跟講的人不一定是同一個(我存了別人的話):審的人要看得到「這句是誰挑進記事本的」(檢查員退件 1)。
 *  🪦 第一版還標「存的人就是檢舉人自己」(self)—— 複驗退件 1 拿掉:存的是誰,那一行已經寫了名字。
 *  name:快照當時的名字(saved_by_name);沒有就問名冊(現在的名字);都沒有＝null(畫面寫「查不到名字」)。
 *  unchecked:快照裡的 body_check 不在 NOTE_BODY_OK 裡 → 字是存的人那支手機送的、沒有人對上過原話,可能不是原話。
 *     沒有這一格的快照(0205 之前拍的、或 submit_report 先上而 0205 還沒上)也算 —— 那時候伺服器沒有留「對過」的紀錄。
 *  🪦 第二版用快照裡的 created_at 判斷(NOTE_QUOTE_SAFE_FROM「09-29 之前存的」那條線):created_at 0205 以前手機可以自己帶,
 *     往晚填漏標(0149 之前捏造的字被當原話)、往早填讓真話被標 —— 0205 起伺服器在寫進來那一刻(與舊的那批重抄時)記下對過沒有,這裡只讀那一格。
 *  ⚠️ 值一律原樣(名字不准被「修飾」過再給審核的人看,actSnapRows 同一條)。 */
export function noteSourceOf(ev, names = {}) {
  if (!ev || typeof ev !== "object" || ev.source !== "note") return null;
  const id = typeof ev.saved_by === "string" ? ev.saved_by : null;
  const then = typeof ev.saved_by_name === "string" && ev.saved_by_name.trim() ? ev.saved_by_name : null;
  return { id, name: then ?? (id ? names[id] ?? null : null), unchecked: !NOTE_BODY_OK.has(ev.body_check) };
}
/** unchecked 那一行的字。⚠️ 寫「沒有對上原話的紀錄」不寫「對不到」:沒有那一格的舊快照是「沒留紀錄」,不一定是對過而對不到。 */
export const NOTE_UNCHECKED_LINE = "沒有對上原話的紀錄,字可能不是原話";
/* ── 回憶裡凍住的那一份(第二十八次健檢收尾:回憶頁「那天」的話、照片影片、檔案)──────────────────────
   submit_report 的 memory_snapshot(形狀住 supabase/functions/_shared/evidence.ts 的 memorySnapshot):形狀照訊息快照,chatLines 照樣畫成一則;
   多一行講清楚它是哪來的 —— 原本那則訊息已經被結晶刪了,審的人要知道「把這則拿掉」沒有東西可拿(那一顆本來就只看 message_live)。 */
export const MEM_WORD = { talk: "那天的話", photo: "那天的照片／影片", file: "那天傳的檔案" };
/** 證據是從回憶頁拍的 → 那一行字;不是 → null。 */
export function memSourceOf(ev) {
  if (!ev || typeof ev !== "object" || ev.source !== "memory") return null;
  return `這一則是從回憶頁拍的(${MEM_WORD[ev.memory_kind] ?? "回憶"}):散場封存時凍住的那一份,原本那則訊息已經不在了`;
}
/** 證據區那一行「封印」(0210;第二十八次健檢收尾第五趟複驗要修 B)。R＝admin 的 report 那一發交回來的那一筆。
 *  true → 不印。false → 紅字:觸發器只在「手機身分寫進來、或手機改過」時蓋 false。
 *  null／沒有那一格 → 灰字:0210 之前的舊列沒有記號(大多其實是伺服器拍的,只是分不出來),admin 先上、0210 還沒上那段也是。
 *  讀不到那一列(remove_block 是 lookup_failed)→ 灰字「讀不到」(第六趟複驗建議 3:鈕那邊的那一句只在拿得掉的那幾種才印,檢舉這場揪、訊息已經不在的那幾筆會兩邊都空著)。
 *  訊息證據與揪快照兩處都畫它(app.js)。用字跟 app.js 的 ERR.evidence_not_sealed 同一個說法「伺服器封過的記號」。
 *  🪦 第一版只要不是 true 就紅、舊列又全回填成 false —— 0210 之前的每一筆都亮「可能是手機自己寫進來的」,停權前審的人看到的是「證據可能是假的」。 */
export const SEAL_FALSE_LINE = "這筆證據是手機身分寫進來的(或手機改過),不是伺服器拍的:內容不一定是當時真的樣子";
export const SEAL_NONE_LINE = "這筆證據沒有伺服器封過的記號(封印上線之前的檢舉都沒有):分不出是不是伺服器拍的";
export const SEAL_UNREAD_LINE = "讀不到這一筆有沒有伺服器封過的記號,重新整理看看";
export function sealLineOf(R) {
  if (!R || typeof R !== "object" || R.evidence_sealed === true) return null;
  if (R.remove_block === "lookup_failed") return { red: false, text: SEAL_UNREAD_LINE };
  return R.evidence_sealed === false ? { red: true, text: SEAL_FALSE_LINE } : { red: false, text: SEAL_NONE_LINE };
}
/** 回憶那一份的另外幾行(第二十八次健檢收尾,檢查員退件 A2／E2):認不清、已經從回憶拿掉。不是回憶那一份 → []。
 *  🪦 「檔沒有再拷一份(沿用別筆)」那一行第五趟複驗跟著 files_dup_of 一起拿掉:每一筆自己拷。 */
export function memNotesOf(ev) {
  if (!ev || typeof ev !== "object" || ev.source !== "memory") return [];
  const out = [];
  if (Number(ev.ambiguous) > 1) out.push(`同一刻他有 ${Number(ev.ambiguous)} 筆,認不清檢舉的是哪一筆 —— 全部拍下來了`);
  if (typeof ev.memory_removed_at === "string") out.push(`已經從回憶拿掉了(${mdhm(ev.memory_removed_at)})`);
  return out;
}
/** 後台長不長「把這則拿掉」(回憶那一份):是回憶那一份、而且還沒拿掉過。拿不拿得掉的真閘在 admin 函式(memRefOf 只讀伺服器拍的那一份)。 */
/* 這一筆長不長「停權」鈕(第三十次健檢卡 8):被檢舉的人已經不在了就沒有對象。
   兩種「不在」:0155 之後留空殼(deleted_at 有值);0211 起那一列真的被刪時 target_id 變空(on delete set null)——
   後者按下去,admin_ban 只會回「找不到這筆檢舉」(講錯理由)。target_gone 由 admin_report_row 算,兩種都認得。 */
export const canBan = (r) => !!r && !r.target_gone && typeof r.target_id === "string" && r.target_id !== "";
export const memRemovable = (ev) => !!ev && typeof ev === "object" && ev.source === "memory" && typeof ev.memory_removed_at !== "string";
/* ── 拿掉他的…(第三十次健檢卡 9;0214)───────────────────────────────────────────
   admin 函式「report」那一發多交一格 profile:他**現在**有、拿得掉的幾樣(順序照伺服器的 PROFILE_ITEMS;判斷住
   supabase/functions/_shared/profileremove.ts 的 profileOffer —— 已經是沒取名的標題不列、不是他開的那一場不列)。
   ⚠️ 鍵＝那邊的 PROFILE_ITEMS(adminprobe §9 對兩邊;多一樣少一樣都紅)。 */
export const PROFILE_LABEL = { avatar: "頭貼", cover: "封面", bio: "簡介", title: "揪的標題" };
/** 長不長「拿掉他的…」:這一筆的對象還在(同 canBan)、伺服器交了至少一樣、每一樣都認得。 */
export const canRemoveProfile = (r, R) => canBan(r) && Array.isArray(R?.profile) && R.profile.length > 0
  && R.profile.every((p) => p && Object.hasOwn(PROFILE_LABEL, p.k));
/** 拿掉之後原地那一行。removed＝伺服器說**真的**改了的那幾樣(已經是空的不算);一樣都沒改＝早就不在了(另一個分頁先拿了)。 */
export function profileDoneText(removed, note) {
  const ks = Array.isArray(removed) ? removed.filter((k) => Object.hasOwn(PROFILE_LABEL, k)) : [];
  return ks.length ? `拿掉了${ks.map((k) => PROFILE_LABEL[k]).join("、")}:「${note}」` : `那幾樣早就不在了:「${note}」`;
}
/* ── 投票卡的選項(第二十八次健檢收尾:拍板單 N3,他 10-26「全部照你建議修吧」)─────────────────────────
   submit_report 檢舉一張投票卡時,在承諾點之後另拍那張投票(evidence.poll;形狀住 supabase/functions/_shared/evidence.ts 的 pollSnapshot)。
   🪦 以前證據只有那一則卡片訊息:喬時間／喬地點那一則的 body 是空字串(0134 的 poll_card_body),後台畫出一顆空泡泡;
      問一題只有題目 —— 選項(使用者自己打的字、自己挑的地點名)一個字都看不到。 */
export const POLL_KIND = { time: "喬時間", place: "喬地點", ask: "問一題", hand: "舉手" };
/** 一格選項印成一行字。⚠️ 喬時間的 day／hm 是出題那支手機的**本地字面值**(lib/poll.ts 的 TimeSlot),不換時區、原樣印;
 *  只有舊形狀(只有 start_at／end_at 的那些格)才是絕對時刻,換成台北時間印。值一律原樣(使用者打的字不准被「修飾」過再給審核的人看)。 */
export function pollOptText(kind, o) {
  const s = (x) => (typeof x === "string" && x.trim() ? x : null);
  if (!o || typeof o !== "object") return "—";
  if (kind === "ask") return s(o.label) ?? "—";
  if (kind === "place") return s(o.name) ?? "—";
  if (kind === "time") {
    const d = (x) => (s(x) ? x.slice(5) : null);   // "2026-10-26" → "10-26"
    const local = !!(s(o.day) || s(o.hm));
    const a = local ? [d(o.day), s(o.hm)].filter(Boolean).join(" ") : (s(o.start_at) ? mdhm(o.start_at) : "");
    const b = local ? [s(o.day2) && o.day2 !== o.day ? d(o.day2) : null, s(o.hm2)].filter(Boolean).join(" ") : (s(o.end_at) ? mdhm(o.end_at) : "");
    return a ? (b ? `${a} – ${b}` : a) : "—";
  }
  return s(o.label) ?? s(o.name) ?? "—";
}
/** 證據是一張投票卡 → 投票那一塊要畫的東西;不是投票卡 → null。
 *  回 { kind, title, opts:[{ text, landed }], who }(拍到了)/ { error }(沒拍到,原因原樣)/ { missing: true }(這一筆是選項進證據之前送的)。
 *  who:這些字是誰寫的。⚠️ 講話的人(卡片的寄件人＝出題的人)跟選項的作者不一定是同一個:貼出來之後**出題的人或主揪**都改得動題目與選項
 *     (0134 activity_polls_update;0192 對其他人丟 42501),而表上沒有記「哪一格是誰改的」—— 沒改過才說得出「都是出題的人寫的」;
 *     改過、主揪又是另一個人,就照實寫「分不出」,兩個名字都給(不替沒有的資料下結論)。
 *  names:admin_report 回的名冊(現在的名字);act:admin_report 的 activity(現在的主揪)。快照裡凍住的名字優先(當時叫什麼)。 */
export function pollSnapOf(ev, names = {}, act = null) {
  if (!ev || typeof ev !== "object" || ev.kind !== "poll") return null;
  if (typeof ev.poll_error === "string" && ev.poll_error) return { error: ev.poll_error };
  const p = ev.poll;
  if (!p || typeof p !== "object") return { missing: true };
  const s = (x) => (typeof x === "string" && x.trim() ? x : null);
  const creator = s(p.created_by);
  const hostId = s(p.host_id) ?? s(act?.host_id);
  const cName = s(p.created_by_name) ?? (creator ? names[creator] ?? null : null) ?? "(查不到名字)";
  const hName = s(p.host_name) ?? (hostId ? names[hostId] ?? null : null) ?? s(act?.host_name) ?? "(查不到名字)";
  const edited = s(p.edited_at);
  const who = !edited
    ? (creator ? `題目和選項都是 ${cName} 寫的(貼出來之後沒改過)` : "題目和選項都是出題的人寫的(貼出來之後沒改過;他後來刪了帳號)")
    : creator && hostId && creator === hostId
      ? `${cName} 出的題,${mdhm(edited)} 改過 —— 他就是主揪,改得動的只有他`
      : `${creator ? cName : "出題的人(後來刪了帳號)"} 出的題,${mdhm(edited)} 改過 —— 出題的人跟主揪(${hName})都改得動,分不出哪一格是誰寫的`;
  const opts = (Array.isArray(p.opts) ? p.opts : []).map((o) => ({ text: pollOptText(p.kind, o), landed: !!s(p.landed) && o?.id === p.landed }));
  return { kind: POLL_KIND[p.kind] ?? String(p.kind ?? ""), title: s(p.title) ?? "", opts, who };
}
/** 投票那一塊印在卡片那一則的泡泡裡的字(一行一格;拍板的那一格標出來)。 */
export function pollBubbleText(pv) {
  if (!pv || !Array.isArray(pv.opts)) return "";
  return [pv.title, ...pv.opts.map((o) => `・${o.text}${o.landed ? "(拍板)" : ""}`)].filter(Boolean).join("\n");
}
/** 揪的快照(第二十五次健檢 K183;submit_report 在檢舉那一刻拍的)→ 後台那一塊要列的幾行 [欄名, 值]。
 *  不是揪的快照(訊息證據、沒有快照)回 null —— 畫面據此決定走這一塊還是對話那一塊(evidenceView)。
 *  ⚠️ 值一律原樣(主揪自己打的字不准被「修飾」過再給審核的人看,reasonText 同一條);空的那幾格不列。
 *  names:admin_report 回的名冊(現在的名字);快照裡的 host_name 是當時的,兩個不一樣就都印。 */
export function actSnapRows(ev, names = {}) {
  if (!ev || typeof ev !== "object" || ev.kind !== "activity") return null;
  const s = (x) => (typeof x === "string" && x.trim() ? x : null);
  const when = ev.start_at ? `${mdhm(ev.start_at)}${ev.all_day ? " · 全天" : ev.end_at ? " – " + hm(ev.end_at) : ""}` : null;
  const now = names[ev.host_id] ?? null, then = s(ev.host_name);
  const host = then && now && now !== then ? `${then}(現在叫 ${now})` : (then ?? now);
  const rows = [
    ["標題", s(ev.title) ? `${s(ev.emoji) ? ev.emoji + " " : ""}${ev.title}` : null],
    ["時間", when],
    ["地點", s(ev.place_text)],
    ["簡介", s(ev.description)],
    ["主揪", host],
    ["狀態", ev.status === "cancelled" ? "已解散" : null],
    ["拍下的時間", ev.snapshot_at ? mdhm(ev.snapshot_at) : null],
  ];
  return rows.filter(([, v]) => v != null);
}
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
