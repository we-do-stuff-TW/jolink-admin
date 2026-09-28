// 揪起來後台(第四百四十二輪)—— 畫面。照 Francis 09-28 點頭的樣品第三版(https://claude.ai/artifact/6EZRkLXYFr5jR1JVZkAesP)。
//
// 這一支只准「怎麼畫」;「該不該、算成什麼」在 logic.js(探針測得到),登入在 auth.js,資料全部來自
// supabase/functions/admin(四關的門,_shared/admin.ts)。
//
// ⚠️ 這裡**不准出現 innerHTML／outerHTML／insertAdjacentHTML／document.write**:名字、檢舉理由、證據、回饋
//    全是使用者自己打的字 —— 有人把名字取成 `<img onerror=…>`,那段 JS 會在一個握著停權權力的頁面裡跑起來
//    (本機審核台 _modweb.mjs 檔頭 ③ 同一課)。一律 textContent 造 DOM。scripts/adminwebprobe.mjs 釘著。
// ⚠️ 介面上不准有解釋性的話、不准有會自己消失的提示條(他的兩條鐵則):成功就把結果寫在原地,失敗寫在原地。
import { SUPABASE_URL, PUBLISHABLE_KEY } from "./config.js";
import * as Auth from "./auth.js";
import {
  reasonText, KIND, BAN_CHOICES, md, hm, mdhm, waited, fmtBytes, bellItems, gateRows, netNew, weekPair, deltaText,
  growthSeries, buildNum, isOld, peopleFilters, matchName, chatLines, hasContext, matchFiles, qrDataUrl,
} from "./logic.js";

/* 被嵌進別人的頁面就什麼都不畫:點擊劫持(把按鈕疊在一個看起來無害的頁面底下騙你按)。
   GitHub Pages 送不了 frame-ancestors／X-Frame-Options,只能在這裡擋。 */
const FRAMED = window.top !== window.self;

const root = document.getElementById("root");
class Stop extends Error {}

/* ══ 狀態 ══ */
const S = {
  auth: "boot", loginErr: null, factor: null, enroll: null, me: null,
  view: "overview", bell: false, asof: null,
  rtab: "open", sel: null, rdetail: false, fog: true, ask: null, days: null, busy: false,
  q: "", pf: "all", drawer: null,
  done: {}, err: {}, actErr: null,
};
const D = { bell: null, overview: null, people: null, feedback: null, system: null, queue: null, banned: null, report: {}, person: {} };
const VIEWS = ["overview", "reports", "people", "feedback", "system"];

/* ══ 小工具 ══ */
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const put = (p, ...k) => { k.forEach((c) => c && p.append(c)); return p; };
const stTag = (cls, t) => el("span", "st " + cls, t);
const NS = "http://www.w3.org/2000/svg";
const icon = (d, size = 16) => {
  const s = document.createElementNS(NS, "svg");
  [["viewBox", "0 0 24 24"], ["width", size], ["height", size], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "1.8"],
   ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["aria-hidden", "true"]].forEach(([k, v]) => s.setAttribute(k, v));
  const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); s.append(p); return s;
};
const I_SEARCH = "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4", I_BACK = "M15 5l-7 7 7 7", I_X = "M6 6l12 12M18 6L6 18",
  I_GO = "M9 5l7 7-7 7", I_BELL = "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0";
const sec = (t, n) => put(el("h2", "sec"), el("span", null, t), n ? el("i", null, n) : null);
const personTag = (p) => p?.gone ? stTag("mute", "已刪帳號")
  : p?.banned ? stTag("ink", p.until ? `停權到 ${mdhm(p.until)}` : "永久停權") : null;

/* ══ 跟伺服器講話 ══ */
const ERR = {
  empty_note: "要寫一句理由", bad_days: "要選停多久", bad_id: "這一筆找不到了,重新整理看看", not_found: "這一筆找不到了",
  not_a_message_report: "這筆檢舉不是針對某一則訊息", not_targets_message: "那則訊息不是被檢舉的人傳的,不能從這裡拿掉",
  failed: "伺服器出錯了,再試一次", gate_failed: "伺服器出錯了,再試一次",
};
function errText(data, status) {
  const d = typeof data?.detail === "string" ? data.detail.replace(/^admin_\w+:\s*/, "") : "";
  return d || ERR[data?.error] || (status ? `伺服器回 ${status}` : "連不上伺服器");
}
async function api(op, extra = {}) {
  const s = await Auth.fresh();
  if (!s) { Auth.clear(); S.auth = "login"; render(); throw new Stop(); }
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/admin`, {
      method: "POST",
      headers: { Authorization: `Bearer ${s.access_token}`, apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ op, ...extra }),
    });
  } catch {
    throw new Error("連不上伺服器");
  }
  const data = await r.json().catch(() => null);
  if (r.status === 403 && (data?.error === "no_token" || data?.error === "bad_token")) { Auth.clear(); S.auth = "login"; render(); throw new Stop(); }
  if (r.status === 403 && data?.error === "need_aal2") { await toMfa(); throw new Stop(); }
  if (r.status === 403 && data?.error === "not_admin") { S.auth = "notadmin"; render(); throw new Stop(); }
  if (!r.ok) throw new Error(errText(data, r.status));
  return data;
}

/* ══ 開機 ══ */
async function boot() {
  if (FRAMED) return;
  const back = await Auth.finishRedirect();
  S.loginErr = back.error ?? null;
  await ensureAuth();
}
async function ensureAuth() {
  const s = await Auth.fresh();
  if (!s) { S.auth = "login"; return render(); }
  if (Auth.aal() !== "aal2") return toMfa();
  try {
    const w = await api("whoami");
    S.me = w?.name ?? null;
    S.auth = "ok";
  } catch (e) {
    if (e instanceof Stop) return;
    S.auth = "login"; S.loginErr = e.message; return render();
  }
  readHash();
  render();
  await loadAll();
}
async function toMfa() {
  try {
    const fs = await Auth.totpFactors();
    const ok = fs.find((f) => f.status === "verified");
    if (ok) { S.factor = ok.id; S.enroll = null; }
    else {
      const e = await Auth.enroll();
      S.factor = e.id; S.enroll = { qr: qrDataUrl(e?.totp?.qr_code), secret: e?.totp?.secret ?? "" };
    }
    S.auth = "mfa"; S.loginErr = null;
  } catch (e) {
    Auth.clear(); S.auth = "login"; S.loginErr = e.message;
  }
  render();
}

/* ══ 讀資料 ══ */
const LOAD = {
  overview: async () => { D.overview = await api("overview"); },
  reports: async () => { const [q, b] = await Promise.all([api("queue"), api("banned")]); D.queue = q ?? []; D.banned = b ?? []; },
  people: async () => { D.people = (await api("people")) ?? []; },
  feedback: async () => { D.feedback = (await api("feedback")) ?? []; },
  system: async () => { D.system = await api("system"); },
};
async function loadBell() {
  try { D.bell = await api("bell"); } catch (e) { if (!(e instanceof Stop)) D.bell = D.bell ?? null; }
}
async function loadView(v, force = false) {
  const has = { overview: D.overview, reports: D.queue, people: D.people, feedback: D.feedback, system: D.system }[v];
  if (has && !force) return;
  S.err[v] = null;
  try { await LOAD[v](); } catch (e) { if (e instanceof Stop) return; S.err[v] = e.message; }
  S.asof = mdhm(new Date().toISOString());
  render();
}
/* 「人」那頁的「還沒更新」要知道最新 build —— 在鈴鐺裡,跟頁面的資料一起讀。 */
async function loadAll(force = false) {
  await Promise.all([loadBell(), loadView(S.view, force)]);
  render();
}
async function refresh() {
  D.report = {}; D.person = {};
  S.done = {}; S.actErr = null;
  await Promise.all([loadBell(), loadView(S.view, true)]);
  if (S.view === "reports" && S.sel && S.rdetail) loadReport(S.sel, true);
}
async function loadReport(id, force = false) {
  if (D.report[id] && !force) return;
  try { D.report[id] = await api("report", { id }); } catch (e) { if (e instanceof Stop) return; D.report[id] = { error: e.message }; }
  render();
}
async function loadPerson(id, force = false) {
  if (D.person[id] && !force) return;
  try { D.person[id] = await api("person", { id }); } catch (e) { if (e instanceof Stop) return; D.person[id] = { error: e.message }; }
  render();
}

/* ══ 網址上的分頁(重新整理停在同一頁)══ */
function readHash() {
  const h = location.hash.replace(/^#/, "");
  if (VIEWS.includes(h)) S.view = h;
}
function go(view, opts = {}) {
  S.view = view; S.bell = false; S.drawer = null; S.ask = null; S.actErr = null;
  if (opts.rtab) S.rtab = opts.rtab;
  if (opts.pf) S.pf = opts.pf;
  history.replaceState(null, "", "#" + view);
  render();
  window.scrollTo(0, 0);
  loadView(view);
}

/* ══ 畫 ══ */
function render() {
  if (FRAMED) return;
  root.textContent = "";
  if (S.auth === "boot") { root.append(el("p", "loading", "讀取中…")); return; }
  if (S.auth !== "ok") { root.append(loginView()); return; }
  const app = el("div", "app");
  put(app, rail(), mainView());
  root.append(app, scrim(), drawerView());
}

function rail() {
  const r = el("nav", "rail");
  const b = el("div", "brand", "揪起來"); b.append(el("small", null, "後台"));
  const t = el("div", "tabs"); t.setAttribute("role", "tablist");
  [["overview", "總覽"], ["reports", "檢舉"], ["people", "人"], ["feedback", "回饋"], ["system", "系統"]].forEach(([id, label]) => {
    const x = el("button", null, label); x.setAttribute("role", "tab"); x.setAttribute("aria-selected", String(S.view === id));
    x.onclick = () => go(id); t.append(x);
  });
  return put(r, b, t, footBits("rail-foot"));
}
function footBits(cls) {
  const f = el("div", cls);
  const re = el("button", "linkbtn ink", "重新整理"); re.onclick = () => refresh();
  const lo = el("button", "linkbtn", "登出"); lo.onclick = async () => { await Auth.logout(); S.auth = "login"; S.loginErr = null; render(); };
  return put(f, S.asof ? el("span", "asof", S.asof) : null, re, lo);
}

function top(title, n, withSearch) {
  const t = el("div", "top");
  const h = el("h1", null, title); if (n != null) h.append(el("i", null, String(n)));
  t.append(h);
  if (withSearch) {
    const s = el("label", "search"); s.append(icon(I_SEARCH));
    const inp = el("input"); inp.type = "search"; inp.placeholder = "找人"; inp.value = S.q; inp.setAttribute("aria-label", "找人"); inp.id = "q-" + S.view;
    inp.oninput = () => { S.q = inp.value; const box = root.querySelector("[data-list]"); if (box) box.replaceWith(S.view === "people" ? peopleTable() : queueList()); };
    s.append(inp); t.append(s);
  }
  t.append(bellView());
  return t;
}

function bellView() {
  const items = bellItems(D.bell);
  const w = el("div", "bellw");
  const b = el("button", "bell"); b.setAttribute("aria-label", items.length ? `${items.length} 件要處理` : "沒有要處理的事");
  b.setAttribute("aria-expanded", String(S.bell));
  b.append(icon(I_BELL, 22)); if (items.length) b.append(el("span", "pip", String(items.length)));
  b.onclick = (e) => { e.stopPropagation(); S.bell = !S.bell; render(); };
  w.append(b);
  if (S.bell) {
    const pop = el("div", "pop"); pop.onclick = (e) => e.stopPropagation();
    pop.append(el("p", "ph2", "要處理的"));
    if (!items.length) put(pop, put(el("div", "calm"), el("span", "dot green"), el("span", null, "沒有要處理的事")));
    items.forEach((it) => {
      const r = el("button", "trow"); const tx = el("span", "tx", it.text); if (it.sub) tx.append(el("small", null, it.sub));
      put(r, el("span", "dot " + it.dot), tx, icon(I_GO, 18));
      r.onclick = () => {
        go(it.go.view, it.go);
        if (it.go.person) { S.drawer = { id: it.go.person, mode: "report" }; loadPerson(it.go.person); render(); }
      };
      pop.append(r);
    });
    w.append(pop);
  }
  return w;
}
document.addEventListener("click", () => { if (S.bell) { S.bell = false; render(); } });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (S.bell) { S.bell = false; render(); } else if (S.drawer) { S.drawer = null; render(); }
});

function mainView() {
  const m = el("main", "main");
  const wrap = el("div", S.view === "reports" ? "wrap wide" : "wrap");
  const body = { overview, reports, people, feedback, system }[S.view]();
  put(wrap, ...body, footBits("mobile-foot"));
  return put(m, wrap);
}
function oops(v) {
  if (!S.err[v]) return null;
  const b = el("div", "oops"); b.append(el("span", null, "讀不到:" + S.err[v]));
  const r = el("button", "btn sm", "再試一次"); r.onclick = () => loadView(v, true); b.append(r);
  return b;
}
const loading = (has) => (has ? null : el("p", "loading", "讀取中…"));

/* ══ 總覽 ══ */
function overview() {
  const ov = D.overview;
  const out = [top("總覽"), oops("overview")];
  if (!ov) { out.push(loading(false)); return out; }
  out.push(sec("這週", md(ov.weeks?.[ov.weeks.length - 1]?.week) + " 起"));
  const wk = el("div", "week");
  weekPair(ov).forEach((x) => {
    const d = deltaText(x.now, x.before);
    put(wk, put(el("div", "wk"), el("span", "k", x.k), el("b", null, String(x.now)), el("span", "d " + d.cls, d.text)));
  });
  out.push(wk);

  out.push(sec("驗證", "近 21 天"));
  const h = el("section", "h0");
  const nn = netNew(ov.gate);
  const bb = el("b", null, nn == null ? "—" : String(nn)); bb.append(el("span", null, " / 5"));
  put(h, put(el("div", "big"), bb, el("div", "lab", "場因為 App 才見到面")));
  const seg = el("div", "seg5"); for (let i = 0; i < 5; i++) seg.append(el("i", i < (Number(nn) || 0) ? "on" : ""));
  h.append(seg);
  gateRows(ov.gate).forEach((g) => {
    const row = el("div", "gate"); row.title = g.rule;
    const v = el("span", "v"); g.kv.forEach(([k, n], i) => { if (i) v.append(document.createTextNode("　")); v.append(document.createTextNode(k + " "), el("b", null, n)); });
    put(row, el("span", "dot " + (g.light in { green: 1, yellow: 1, red: 1, invalid: 1, manual: 1 } ? g.light : "manual")), el("span", "nm", g.name), v, stTag(g.cls, g.word));
    h.append(row);
  });
  out.push(h);

  out.push(sec("八週"));
  out.push(weeksChart(ov.weeks ?? []));
  /* 標題跟圖上的終點用同一個數(註冊過幾個人,含後來刪了帳號的)—— 「現在還在的」在「人」那頁的標題。
     兩個不一樣的數並排會像算錯。 */
  const g = growthSeries(ov.growth);
  out.push(sec("成長", g.length ? `註冊過 ${g[g.length - 1].cum} 人` : ""));
  out.push(growthChart(ov));
  return out;
}
function legend(items) {
  const lg = el("div", "legend");
  items.forEach(([c, t]) => { const i = el("i"); i.style.background = c; put(lg, put(el("span"), i, document.createTextNode(t))); });
  return lg;
}
function svgBox(W, H, label) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("preserveAspectRatio", "none"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", label);
  return svg;
}
function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, String(v))); return e; }
function xLabels(list, fmt) {
  const xl = el("div", "xl" + (list.length > 6 ? " thin" : ""));
  xl.style.gridTemplateColumns = `repeat(${Math.max(1, list.length)},1fr)`;
  list.forEach((w, i) => xl.append(el("span", i === list.length - 1 ? "now" : "", fmt(w))));
  return xl;
}
function weeksChart(weeks) {
  const ch = el("section", "chart");
  ch.append(legend([["var(--blue)", "活躍的人"], ["#C9D9FB", "開的揪"], ["var(--coral)", "見到面"]]));
  const plot = el("div", "plot"); plot.append(el("div", "dots"));
  const n = weeks.length, W = 800, H = 180;
  const maxV = Math.max(4, ...weeks.map((w) => Math.max(w.active ?? 0, w.sets ?? 0, w.met ?? 0))) * 1.15;
  const cx = (i) => (i + 0.5) * W / Math.max(1, n), y = (v) => H - 8 - (v / maxV) * (H - 24);
  const svg = svgBox(W, H, "八週的活躍人數、開的揪與見到面");
  weeks.forEach((w, i) => {
    const bw = W / Math.max(1, n) * 0.42, v = w.sets ?? 0;
    if (v > 0) svg.append(svgEl("rect", { x: cx(i) - bw / 2, width: bw, y: y(v), height: H - 8 - y(v), rx: 6, fill: "#C9D9FB" }));
  });
  if (n) svg.append(svgEl("path", { d: weeks.map((w, i) => (i ? "L" : "M") + cx(i) + " " + y(w.active ?? 0)).join(" "), fill: "none", stroke: "#286EFA", "stroke-width": 3, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }));
  plot.append(svg);
  weeks.forEach((w, i) => {
    const dot = (v, c) => { const s = el("span", "pt"); s.style.left = `${(i + 0.5) / n * 100}%`; s.style.top = `${y(v) / H * 100}%`; s.style.background = c; return s; };
    plot.append(dot(w.active ?? 0, "#286EFA"));
    if (w.met) plot.append(dot(w.met, "#FD767D"));
  });
  return put(ch, plot, xLabels(weeks, (w) => md(w.week)));
}
function growthChart(ov) {
  const ch = el("section", "chart");
  ch.append(legend([["var(--blue)", "累計註冊"], ["#C9D9FB", "那週新來的"]]));
  const g = growthSeries(ov.growth);
  const plot = el("div", "plot"); plot.append(el("div", "dots"));
  const n = g.length, W = 800, H = 180, maxV = Math.max(4, ...g.map((x) => x.cum)) * 1.15;
  const cx = (i) => (i + 0.5) * W / Math.max(1, n), y = (v) => H - 8 - (v / maxV) * (H - 24);
  const svg = svgBox(W, H, "累計註冊人數與每週新註冊");
  g.forEach((x, i) => {
    if (!x.n) return; const bw = W / Math.max(1, n) * 0.42;
    svg.append(svgEl("rect", { x: cx(i) - bw / 2, width: bw, y: y(x.n), height: H - 8 - y(x.n), rx: 6, fill: "#C9D9FB" }));
  });
  if (n) {
    const line = g.map((x, i) => (i ? "L" : "M") + cx(i) + " " + y(x.cum)).join(" ");
    svg.append(svgEl("path", { d: `${line} L${cx(n - 1)} ${H - 8} L${cx(0)} ${H - 8} Z`, fill: "rgba(40,110,250,.08)" }));
    svg.append(svgEl("path", { d: line, fill: "none", stroke: "#286EFA", "stroke-width": 3, "vector-effect": "non-scaling-stroke" }));
  }
  plot.append(svg);
  if (n) {
    const last = g[n - 1];
    const dot = el("span", "pt"); dot.style.left = `${(n - 0.5) / n * 100}%`; dot.style.top = `${y(last.cum) / H * 100}%`; dot.style.background = "#286EFA";
    const lab = el("span", "endlab", `${last.cum} 人`); lab.style.top = `${y(last.cum) / H * 100}%`;
    plot.append(dot, lab);
  }
  const t = ov.totals ?? {};
  const inv = el("div", "inv");
  [["發出的邀請", t.invites], ["被點開", t.invite_opened], ["用掉", t.invite_used], ["朋友關係", t.friendships]].forEach(([k, v], i) => {
    if (i) inv.append(el("span", "ar", i === 3 ? "·" : "→"));
    put(inv, put(el("span", "iv"), el("b", null, v ?? "—"), document.createTextNode(k)));
  });
  return put(ch, plot, xLabels(g, (x) => md(x.week)), inv);
}

/* ══ 檢舉 ══ */
const openRows = () => (D.queue ?? []).filter((r) => r.open);
function reports() {
  const out = [top("檢舉", null, S.rtab !== "banned"), oops("reports")];
  const segs = el("div", "segs"); segs.setAttribute("role", "tablist");
  [["open", "待處理", openRows().length], ["handled", "已處理"], ["all", "全部"], ["banned", "停權中", (D.banned ?? []).length]].forEach(([id, label, n]) => {
    const b = el("button"); b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(S.rtab === id));
    put(b, el("span", null, label), n ? el("span", "num", String(n)) : null);
    b.onclick = () => { S.rtab = id; S.rdetail = false; S.ask = null; S.actErr = null; render(); };
    segs.append(b);
  });
  out.push(segs);
  if (!D.queue) { out.push(loading(false)); return out; }
  if (S.rtab === "banned") { out.push(bannedList()); return out; }
  if (S.rtab === "handled") { out.push(handledList()); return out; }
  const sp = el("div", "split" + (S.rdetail ? " detail" : ""));
  put(sp, queueList(), detailPane());
  out.push(sp);
  return out;
}
function queueRows() {
  const rows = S.rtab === "all" ? (D.queue ?? []) : openRows();
  return rows.filter((r) => matchName(S.q, r.target_name, r.target_handle));
}
function queueList() {
  const box = el("div", "queue"); box.dataset.list = "1";
  const rows = queueRows();
  if (!rows.length) { box.append(el("p", "empty", S.q ? "沒有叫這個名字的人被檢舉。" : S.rtab === "open" ? "沒有待處理的檢舉。" : "還沒有任何檢舉。")); return box; }
  rows.forEach((r) => {
    const b = el("button", "qi"); b.setAttribute("aria-current", String(S.sel === r.id && S.rdetail));
    const who = { gone: r.target_gone, banned: r.target_banned, until: r.target_until };
    const w = r.open ? el("span", "w" + (r.hours >= 12 ? " late" : ""), "等了 " + waited(r.hours)) : el("span", "w", md(r.handled_at));
    put(b, put(el("div", "r1"), el("span", "nm", r.target_name ?? "(查不到名字)"), personTag(who), w),
      put(el("div", "r2"), el("span", "kind", KIND[r.target_type] ?? r.target_type),
        el("span", null, `${reasonText(r.reason)} · ${r.reporter_name ?? "(查不到名字)"} 檢舉`),
        r.open ? (r.reporters_30d >= 2 ? stTag("red", `30 天 ${r.reporters_30d} 人`) : null) : stTag(r.auto_closed ? "mute" : "ok", r.auto_closed ? "自動" : "人工")));
    b.onclick = () => { S.sel = r.id; S.rdetail = true; S.ask = null; S.actErr = null; S.fog = true; render(); loadReport(r.id); };
    box.append(b);
  });
  return box;
}
function detailPane() {
  const pane = el("section", "pane");
  const back = el("button", "back"); back.append(icon(I_BACK), el("span", null, S.rtab === "all" ? "全部" : "待處理")); back.onclick = () => { S.rdetail = false; render(); };
  pane.append(back);
  const base = (D.queue ?? []).find((x) => x.id === S.sel);
  if (!S.sel || !base) { pane.append(el("p", "empty", "")); return pane; }
  const R = D.report[S.sel];
  const r = R?.row ?? base;
  const who = { gone: r.target_gone, banned: r.target_banned, until: r.target_until };
  const see = el("button", "linkbtn ink", "看這個人"); see.onclick = () => { S.drawer = { id: r.target_id, mode: "report" }; render(); loadPerson(r.target_id); };
  put(pane, put(el("div", "ph"), el("span", "who", r.target_name ?? "(查不到名字)"), r.target_handle ? el("span", "hd", "@" + r.target_handle) : null,
    personTag(who), el("span", "sp"), see));
  const kv = el("dl", "kv");
  const row = (k, v) => put(kv, el("dt", null, k), typeof v === "string" ? el("dd", null, v) : put(el("dd"), v));
  row("理由", reasonText(r.reason)); row("誰檢舉的", r.reporter_name ?? "(查不到名字)"); row("檢舉的是", KIND[r.target_type] ?? r.target_type);
  const a = R?.activity;
  if (a) row("在哪一場", put(el("div", "act"), el("span", null, `「${a.title ?? ""}」`), el("small", null, `${mdhm(a.start_at)}${a.host_name ? " · 主揪 " + a.host_name : ""}`)));
  else if (r.activity_title) row("在哪一場", `「${r.activity_title}」`);
  row(r.open ? "等了多久" : "什麼時候處理的", r.open ? waited(r.hours) : mdhm(r.handled_at));
  pane.append(kv);
  if (r.open && r.reporters_30d >= 2) pane.append(el("div", "done red", `近 30 天有 ${r.reporters_30d} 個不同的人檢舉過他,共 ${r.reports_30d} 筆。`));

  if (R?.error) pane.append(el("div", "done red", "讀不到這一筆:" + R.error));
  else if (!R) pane.append(el("p", "loading", "讀取中…"));
  else if (R.evidence) pane.append(...evidenceView(R, r));

  if (S.done[S.sel]) { pane.append(el("div", "done" + (S.done[S.sel].red ? " red" : ""), S.done[S.sel].text)); return pane; }
  if (!r.open) {
    pane.append(el("div", "done " + (r.auto_closed ? "mute" : ""), `${r.auto_closed ? "自動關掉" : "看過了"}:「${r.handled_note ?? ""}」`));
    return pane;
  }
  const acts = el("div", "acts");
  const mk = (label, cls, key) => { const b = el("button", "btn " + cls, label); b.setAttribute("aria-expanded", String(S.ask === key)); b.onclick = () => { S.ask = S.ask === key ? null : key; S.days = null; S.actErr = null; render(); }; return b; };
  put(acts, mk("看過了", "solid", "handle"), mk("停權", "danger", "ban"),
    r.target_type === "message" && r.message_live ? mk("把這則拿掉", "line", "remove") : null);
  pane.append(acts);
  if (S.ask) pane.append(askBox(S.ask, r));
  if (S.actErr) pane.append(el("div", "done red", S.actErr));
  return pane;
}
const MEDIA_WORD = { photo: "照片", image: "照片", video: "影片", voice: "語音", audio: "語音", file: "檔案" };
function evidenceView(R, r) {
  const ev = R.evidence;
  const lines = chatLines(ev);
  const { byLine, loose } = matchFiles(lines, R.files);
  const names = R.names ?? {};
  const h = sec("證據", hasContext(ev) ? "前後各 9 則" : "那一則");
  const box = el("div", "evwrap" + (S.fog ? " fog" : ""));
  const tg = el("button", "btn sm", S.fog ? "看清楚" : "霧回去"); tg.onclick = () => { S.fog = !S.fog; render(); };
  const chat = el("div", "chat");
  lines.forEach((l, i) => {
    const them = l.sender && l.sender === r.target_id;
    const m = el("div", "msg" + (them ? " them" : "") + (l.anchor ? " anchor" : "") + (l.anchor && r.message_live === false ? " gone" : ""));
    const bb = el("div", "bb");
    const f = byLine.get(i);
    if (f) bb.append(fileNode(f, false));
    else if (l.media) bb.append(el("span", "note", `(${MEDIA_WORD[l.kind] ?? "檔案"},檔已經不在了)`));
    if (l.body) bb.append(document.createTextNode(l.body));
    else if (!l.media) bb.append(el("span", "note", MEDIA_WORD[l.kind] ? `(${MEDIA_WORD[l.kind]})` : ""));
    put(m, el("span", "by", names[l.sender] ?? "(查不到名字)"), bb, el("span", "tm", hm(l.at)));
    chat.append(m);
  });
  put(box, put(el("div", "evtools"), tg), chat);
  if (loose.length) { const lz = el("div", "loose"); loose.forEach((f) => lz.append(fileNode(f, true))); box.append(lz); }
  const errs = [];
  if (ev.files_error) errs.push(el("div", "done mute", "有檔沒拷到:" + ev.files_error));
  if (ev.context_error) errs.push(el("div", "done mute", "前後文沒存到:" + ev.context_error));
  return [h, box, ...errs];
}
function fileNode(f, small) {
  if (!f.url) return el("span", "note", `(${f.name},檔已經不在了)`);
  if (f.img) {
    const img = el("img"); img.src = f.url; img.alt = ""; img.referrerPolicy = "no-referrer"; img.loading = "lazy";
    if (small) img.className = "sm";
    return img;
  }
  const a = el("a", "linkbtn ink", "下載 " + f.name); a.href = f.url; a.rel = "noopener noreferrer"; a.target = "_blank";
  return a;
}
function askBox(key, r) {
  const box = el("div", "ask");
  const note = el("input"); note.type = "text"; note.placeholder = "寫一句理由"; note.setAttribute("aria-label", "理由"); note.id = "note-" + key; note.maxLength = 500;
  const id = r.id;
  const act = async (btn, fn) => {
    if (S.busy) return; S.busy = true; btn.disabled = true; S.actErr = null;
    try { await fn(); S.ask = null; }
    catch (e) { if (!(e instanceof Stop)) S.actErr = e.message; }
    finally { S.busy = false; }
    render();
  };
  if (key === "handle") {
    const g = el("button", "btn solid", "確定"); g.disabled = true; note.oninput = () => { g.disabled = !note.value.trim(); };
    g.onclick = () => act(g, async () => {
      const t = note.value.trim();
      const res = await api("handle", { id, note: t });
      S.done[id] = { text: res?.changed === 0 ? "這一筆剛才已經被處理過了" : `標成看過了:「${t}」` };
      await afterWrite(id);
    });
    put(box, el("p", "q", "看過了"), put(el("div", "row"), note, g));
  } else if (key === "ban") {
    const days = el("div", "row"); const g = el("button", "btn danger", "停權 " + (r.target_name ?? "")); g.disabled = true;
    const check = () => { g.disabled = S.days == null || !note.value.trim(); };
    const chips = BAN_CHOICES.map((c) => {
      const b = el("button", "chipbtn", c.label); b.setAttribute("aria-pressed", String(S.days === c.days));
      b.onclick = () => { S.days = c.days; chips.forEach((x, i) => x.setAttribute("aria-pressed", String(BAN_CHOICES[i].days === c.days))); check(); };
      days.append(b); return b;
    });
    note.oninput = check;
    g.onclick = () => act(g, async () => {
      const t = note.value.trim(), c = BAN_CHOICES.find((x) => x.days === S.days);
      await api("ban", { id, target: r.target_id, note: t, days: S.days });
      S.done[id] = { text: `${r.target_name ?? ""} ${c?.days === "forever" ? "永久停權" : "停權 " + c?.label}:「${t}」`, red: true };
      await afterWrite(id);
    });
    put(box, el("p", "q", "停多久"), days, put(el("div", "row"), note, g));
  } else {
    const g = el("button", "btn danger", "拿掉"), no = el("button", "btn", "先不要");
    no.onclick = () => { S.ask = null; render(); };
    g.onclick = () => act(g, async () => {
      await api("remove_message", { id });
      await loadReport(id, true);
    });
    put(box, el("p", "q", "拿掉這則?"), put(el("div", "row"), g, no));
  }
  return box;
}
async function afterWrite(id) {
  await Promise.all([loadBell(), (async () => { try { await LOAD.reports(); } catch (e) { if (!(e instanceof Stop)) S.err.reports = e.message; } })()]);
  delete D.report[id];
  D.people = null;
  loadReport(id, true);
}
function bannedList() {
  const box = el("div", "hlist");
  const rows = D.banned ?? [];
  if (!rows.length) { box.append(el("p", "empty", "沒有人停權中。")); return box; }
  rows.forEach((p) => {
    const r = el("div", "hi"); const un = el("button", "btn sm", "解封");
    const d = S.done["unban:" + p.id];
    put(r, el("span", "nm", p.name ?? "(查不到名字)"), el("span", "nt", p.note ? `「${p.note}」` : ""),
      put(el("span", "rt"), stTag("ink", p.until ? "到 " + mdhm(p.until) : "永久"), d ? null : un));
    if (d) { const x = el("div", "done", d.text); x.style.gridColumn = "1/-1"; r.append(x); }
    un.onclick = () => {
      const a = el("div", "ask"); a.style.gridColumn = "1/-1";
      const note = el("input"); note.type = "text"; note.placeholder = "寫一句理由"; note.setAttribute("aria-label", "理由"); note.id = "note-unban"; note.maxLength = 500;
      const g = el("button", "btn solid", "解封 " + (p.name ?? "")); g.disabled = true; note.oninput = () => { g.disabled = !note.value.trim(); };
      const err = el("p", "err"); err.hidden = true;
      g.onclick = async () => {
        if (S.busy) return; S.busy = true; g.disabled = true;
        try {
          const t = note.value.trim();
          const res = await api("unban", { target: p.id, note: t });
          S.done["unban:" + p.id] = { text: `解封了:「${t}」${res?.reopened ? `,${res.reopened} 筆檢舉重新回到待處理` : ""}` };
          await Promise.all([loadBell(), LOAD.reports()]);
          D.people = null;
        } catch (e) { if (!(e instanceof Stop)) { err.textContent = e.message; err.hidden = false; g.disabled = false; S.busy = false; return; } }
        S.busy = false; render();
      };
      put(a, put(el("div", "row"), note, g), err); r.append(a); un.disabled = true; note.focus();
    };
    box.append(r);
  });
  return box;
}
function handledList() {
  const box = el("div", "hlist"); box.dataset.list = "1";
  const rows = (D.queue ?? []).filter((r) => !r.open && matchName(S.q, r.target_name, r.target_handle));
  if (!rows.length) { box.append(el("p", "empty", S.q ? "沒有叫這個名字的人。" : "還沒有處理過的檢舉。")); return box; }
  rows.forEach((h) => {
    const b = el("button", "hi");
    put(b, el("span", "nm", h.target_name ?? "(查不到名字)"), el("span", "nt", h.handled_note ?? ""),
      put(el("span", "rt"), stTag(h.auto_closed ? "mute" : "ok", h.auto_closed ? "自動" : "人工"), el("span", "mono", mdhm(h.handled_at))));
    b.onclick = () => { S.rtab = "all"; S.sel = h.id; S.rdetail = true; S.fog = true; render(); loadReport(h.id); };
    box.append(b);
  });
  return box;
}

/* ══ 人 ══ */
const latestBuild = () => D.bell?.latest_build ?? null;
function people() {
  const rows = D.people;
  const out = [top("人", rows ? rows.filter((p) => !p.gone).length : null, true), oops("people")];
  if (!rows) { out.push(loading(false)); return out; }
  const f = el("div", "filters");
  peopleFilters(latestBuild()).forEach((x) => {
    const b = el("button"); b.setAttribute("aria-pressed", String(S.pf === x.id));
    put(b, el("span", null, x.label), el("b", null, String(rows.filter(x.fn).length)));
    b.onclick = () => { S.pf = x.id; render(); };
    f.append(b);
  });
  out.push(f, peopleTable());
  return out;
}
function peopleTable() {
  const box = el("div", "ptable"); box.dataset.list = "1";
  const head = el("div", "prow head");
  ["", "版本", "最近有動作", "朋友", "開揪 / 參加", ""].forEach((t) => head.append(el("span", null, t)));
  box.append(head);
  const fx = peopleFilters(latestBuild()).find((x) => x.id === S.pf) ?? peopleFilters(latestBuild())[0];
  const rows = (D.people ?? []).filter(fx.fn).filter((p) => matchName(S.q, p.name, p.handle));
  if (!rows.length) { box.append(el("p", "empty", "沒有符合的人。")); return box; }
  rows.forEach((p) => {
    const b = el("button", "prow");
    const who = el("span", "who"); put(who, el("b", null, p.name ?? "(查不到名字)"), el("span", null, p.handle ? "@" + p.handle : "沒有自選 ID"));
    const bn = buildNum(p.build);
    const bd = el("span", "c bd" + (bn == null ? " none" : isOld(p, latestBuild()) ? " old" : ""), bn == null ? (p.build ? p.build : "沒回報過") : String(bn));
    const tag = personTag(p) || (p.reports ? stTag("warm", "被檢舉 " + p.reports) : null);
    put(b, who, bd, el("span", "c la", p.last ? md(p.last) : "—"), el("span", "c fr", String(p.friends ?? 0)),
      el("span", "c hj", `${p.hosted ?? 0} / ${p.joined ?? 0}`), tag ? put(el("span", "stc"), tag) : el("span"));
    b.onclick = () => { S.drawer = { id: p.id, mode: "person" }; render(); loadPerson(p.id); };
    box.append(b);
  });
  return box;
}

/* ══ 回饋 ══ */
function feedback() {
  const rows = D.feedback;
  const out = [top("回饋", rows ? rows.length : null), oops("feedback")];
  if (!rows) { out.push(loading(false)); return out; }
  if (!rows.length) { out.push(el("p", "empty", "還沒有人寫過。")); return out; }
  const box = el("section", "fblist");
  const week = Date.now() - 7 * 86400000;
  rows.forEach((f) => {
    const it = el("article", "fb");
    put(it, put(el("div", "l1"), el("b", null, f.who ?? "(查不到名字)"), new Date(f.at).getTime() > week ? stTag("warm", "新的") : null, el("span", "mono", mdhm(f.at))),
      el("p", "bd", f.body ?? ""), el("div", "mono", [f.build ? "build " + f.build : null, f.platform, f.lang].filter(Boolean).join(" · ")));
    box.append(it);
  });
  out.push(box);
  return out;
}

/* ══ 系統 ══ */
const STORE_NAME = { memory: "憶裡的照片與影片", live: "還在跑的場", avatars: "頭貼與封面", evidence: "檢舉證據", total: "合計" };
function system() {
  const s = D.system;
  const out = [top("系統"), oops("system")];
  if (!s) { out.push(loading(false)); return out; }
  const box = el("section", "sys");
  const line = (nm, light, word, kv) => {
    const r = el("div", "srow");
    const v = el("span", "v"); kv.forEach(([k, n], i) => { if (i) v.append(document.createTextNode("　")); v.append(document.createTextNode(k + " "), el("b", null, n)); });
    put(r, el("span", "dot " + light), el("span", "nm", nm), v, word ? stTag(light === "green" ? "ok" : light === "red" ? "red" : "warm", word) : null);
    box.append(r);
  };
  const pf = s.push_fatal_30d ?? 0;
  line("推播", pf ? "red" : "green", pf ? "出錯" : "正常", pf ? [["30 天內全站級錯誤", `${pf} 次`], ["最近一次", mdhm(s.push_fatal_last)]] : [["30 天內全站級錯誤", "0"]]);
  const c = s.cron ?? {};
  line("排程", c.failed_24h ? "red" : "green", c.failed_24h ? "有失敗" : "正常",
    [["24 小時跑了", `${c.runs_24h ?? 0} 次`], ["失敗", String(c.failed_24h ?? 0)], ...(c.off ? [["關著", `${c.off} 支`]] : [])]);
  if ((c.failed_jobs ?? []).length) box.append(el("p", "mono", "失敗的:" + c.failed_jobs.join("、")));
  const pn = s.pgnet ?? {};
  line("伺服器互叫", pn.errors ? "yellow" : "green", pn.errors ? "有錯" : "正常", [[`最近 ${pn.window_hours ?? "—"} 小時`, `${pn.calls ?? 0} 次`], ["錯誤", String(pn.errors ?? 0)]]);
  const q = s.quota ?? {};
  line("限流帳本", "manual", null, [["24 小時記了", `${q.hits ?? 0} 次`], ["人", String(q.users ?? 0)]]);
  out.push(box);

  const b = s.builds ?? {};
  out.push(sec("大家在第幾版", b.latest ? "最新 build " + b.latest : ""));
  const bl = el("section", "sys");
  const dist = b.dist ?? [];
  const mx = Math.max(1, ...dist.map((x) => x.n));
  dist.forEach((x) => {
    const r = el("div", "bld");
    const k = el("span", "k" + (x.build === b.latest ? " cur" : x.build == null ? " nr" : ""), x.build == null ? "沒回報過" : "build " + x.build);
    const tr = el("div", "tr"); const fl = el("span", "fl" + (x.build === b.latest ? "" : x.build == null ? " nr" : " old")); fl.style.width = (x.n / mx * 100) + "%"; tr.append(fl);
    put(r, k, tr, el("span", "n", String(x.n)));
    bl.append(r);
  });
  out.push(bl);

  out.push(sec("倉庫"));
  const sto = el("section", "sys");
  const order = ["memory", "live", "avatars", "evidence", "total"];
  [...(s.storage ?? [])].sort((a, z) => order.indexOf(a.k) - order.indexOf(z.k)).forEach((x) =>
    put(sto, put(el("div", "store"), el("span", null, STORE_NAME[x.k] ?? x.k), el("span", "c", `${x.n} 個`), el("span", "c", fmtBytes(x.bytes)))));
  out.push(sto);

  out.push(sec("看不到的"));
  const bd = el("section", "blind");
  [["最近一次打開 App", " 沒在記。「最近有動作」是開揪、加入、按過東西的時間。"],
   ["聊天", " 散場 48 小時後清掉,只剩結晶那一刻記的句數。"],
   ["閃退", " 在 Sentry,這裡沒有。"]].forEach(([b1, t]) => bd.append(put(el("p"), el("b", null, b1), document.createTextNode(t))));
  out.push(bd);
  return out;
}

/* ══ 抽屜:一個人 ══
   從檢舉打開(report)＝處理檢舉,看得到他最近揪的標題(伺服器也只對被檢舉過的人給);
   從「人」打開(person)＝只有場數,不畫揪的標題(隱私頁:統計不含內容)。 */
function scrim() { const s = el("div", "scrim" + (S.drawer ? " on" : "")); s.onclick = () => { S.drawer = null; render(); }; return s; }
function drawerView() {
  const d = el("aside", "drawer" + (S.drawer ? " on" : "")); d.setAttribute("aria-label", "一個人");
  if (!S.drawer) return d;
  const { id, mode } = S.drawer;
  const P = D.person[id];
  const row = (D.people ?? []).find((x) => x.id === id);
  const u = P?.user ?? (row ? { name: row.name, handle: row.handle, banned: row.banned, until: row.until, gone: row.gone } : {});
  const x = el("button", "close"); x.setAttribute("aria-label", "關上"); x.append(icon(I_X, 18)); x.onclick = () => { S.drawer = null; render(); };
  const sub = el("div", "ph"); put(sub, u.handle ? el("span", "hd", "@" + u.handle) : null, personTag(u) || stTag("ok", "正常"));
  put(d, x, el("h3", null, u.name ?? "(查不到名字)"), sub);
  if (P?.error) { d.append(el("div", "done red", "讀不到:" + P.error)); return d; }
  const bans = (P?.bans ?? []);
  const f = el("div", "facts");
  const facts = mode === "report" || !row
    ? [[P?.reporters_30d ?? "—", "30 天內檢舉他的人"], [P?.reports_total ?? "—", "被檢舉共幾筆"], [P ? bans.filter((b) => b.kind === "user_banned").length : "—", "停過幾次"]]
    : [[row.friends ?? 0, "朋友"], [row.hosted ?? 0, "開過的揪"], [row.joined ?? 0, "參加過"], [row.met ?? 0, "見到面"],
       [buildNum(row.build) ?? "—", "版本"], [row.push ? "開著" : "沒開", "推播"], [md(row.since), "加入"], [row.by_name ?? "—", "被誰帶進來"], [row.brought ?? 0, "帶進來的人"]];
  facts.forEach(([n, l]) => put(f, put(el("div"), el("b", null, String(n)), el("span", null, l))));
  d.append(f);
  if (!P) { d.append(el("p", "loading", "讀取中…")); return d; }

  const reps = P.reports ?? [];
  if (mode === "report" || reps.length) {
    d.append(sec("被檢舉的紀錄", `${reps.length} 筆`));
    const tl = el("div", "tl");
    reps.forEach((h) => put(tl, put(el("div", "tli"),
      put(el("div", "l1"), el("b", null, reasonText(h.reason)), el("span", null, `${h.reporter_name ?? "(查不到名字)"} 檢舉`),
        h.open ? stTag("warm", "待處理") : stTag("mute", h.auto_closed ? "自動" : "人工"), el("span", "mono", md(h.created_at))),
      !h.open && h.handled_note ? el("div", "nt", `「${h.handled_note}」`) : null)));
    d.append(reps.length ? tl : el("p", "empty", "沒有。"));
  }
  if (mode === "report" || bans.length) {
    d.append(sec("停權紀錄", `${bans.filter((b) => b.kind === "user_banned").length} 次`));
    const bl = el("div", "tl");
    bans.forEach((b) => {
      const what = b.kind === "user_banned" ? (b.days == null ? "永久停權" : `停權 ${b.days} 天`) : b.kind === "user_unbanned" ? "解封" : "到期解開";
      put(bl, put(el("div", "tli"), put(el("div", "l1"), el("b", null, what), el("span", "mono", mdhm(b.at))), b.note ? el("div", "nt", `「${b.note}」`) : null));
    });
    d.append(bans.length ? bl : el("p", "empty", "沒有停過。"));
  }
  if (mode === "report") {
    d.append(sec("最近的揪"));
    const acts = P.acts ?? [];
    const al = el("div", "tl");
    const ROLE = { host: ["ok", "主揪"], joined: ["mute", "參加"], left: ["mute", "不去了"] };
    acts.forEach((a) => { const [c, t] = ROLE[a.role] ?? ["mute", a.role]; put(al, put(el("div", "tli"), put(el("div", "l1"), el("b", null, `「${a.title ?? ""}」`), stTag(c, t), el("span", "mono", md(a.start_at))))); });
    d.append(acts.length ? al : el("p", "empty", "沒有。"));
  } else if (!reps.length && !bans.length) {
    d.append(sec("檢舉與停權"), el("p", "empty", "沒有被檢舉過,也沒有停過。"));
  }
  return d;
}

/* ══ 登入 ══ */
function loginView() {
  const w = el("div", "login"), c = el("div", "lcard");
  const b = el("div", "brand", "揪起來"); b.append(el("small", null, "後台"));
  c.append(b);
  const err = S.loginErr ? el("p", "err", S.loginErr) : null;
  if (S.auth === "login") {
    const g = el("button", "gbtn");
    const gi = document.createElementNS(NS, "svg"); [["viewBox", "0 0 24 24"], ["width", "20"], ["height", "20"], ["aria-hidden", "true"]].forEach(([k, v]) => gi.setAttribute(k, v));
    [["#4285F4", "M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"], ["#34A853", "M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"],
     ["#FBBC05", "M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14z"], ["#EA4335", "M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 5.9 12 5.9z"]]
      .forEach(([fill, dd]) => gi.append(svgEl("path", { fill, d: dd })));
    put(g, gi, el("span", null, "用 Google 登入"));
    g.onclick = async () => { g.disabled = true; try { await Auth.startGoogle(); } catch (e) { S.loginErr = e.message; render(); } };
    put(c, g, err);
  } else if (S.auth === "mfa") {
    const field = el("div", "field"); const lab = el("label", null, "驗證器上的六位數"); lab.htmlFor = "code";
    const box = el("div", "in"); const i = el("input"); i.id = "code"; i.inputMode = "numeric"; i.autocomplete = "one-time-code"; i.placeholder = "000000"; i.maxLength = 6;
    box.append(i); put(field, lab, box);
    const go2 = el("button", "btn solid", S.enroll ? "綁好了,進去" : "進去");
    const submit = async () => {
      const code = i.value.trim();
      if (!/^\d{6}$/.test(code)) { S.loginErr = "六位數不對,打開驗證器看最新的那組"; render(); return; }
      go2.disabled = true;
      try { await Auth.verifyCode(S.factor, code); S.enroll = null; S.loginErr = null; S.auth = "boot"; render(); await ensureAuth(); }
      catch (e) { S.loginErr = /invalid|expired/i.test(e.message) ? "六位數不對,打開驗證器看最新的那組" : e.message; render(); }
    };
    go2.onclick = submit;
    i.onkeydown = (e) => { if (e.key === "Enter") submit(); };
    if (S.enroll) {
      const q = el("div", "qr");
      if (S.enroll.qr) { const img = el("img"); img.src = S.enroll.qr; img.alt = "驗證器要掃的條碼"; q.append(img); }
      put(c, el("p", null, "用驗證器 App 掃這個"), q, S.enroll.secret ? el("p", "secret", S.enroll.secret) : null, field, err, go2);
    } else {
      put(c, field, err, go2);
    }
    const lo = el("button", "linkbtn", "換一個帳號"); lo.onclick = async () => { await Auth.logout(); S.auth = "login"; S.loginErr = null; render(); };
    c.append(lo);
    setTimeout(() => i.focus(), 0);
  } else if (S.auth === "notadmin") {
    const o = el("button", "btn", "換一個帳號"); o.onclick = async () => { await Auth.logout(); S.auth = "login"; S.loginErr = null; render(); };
    put(c, el("p", "err", "這個帳號不是管理員。"), o);
  }
  return put(w, c);
}

render();
boot();
