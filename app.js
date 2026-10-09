// 揪起來後台(第四百四十二輪起;445 換成「奶霜」;第四百七十四輪換成 Synthex「三 深色頂帶」)—— 畫面。
// 樣子照 Francis 10-09 從第四輪(照 Dribbble「Synthex UI – Analytics SaaS Dashboard」)三版挑的三,再加他挑的「每週的揪」乙 成對細條
// (定稿樣品 https://claude.ai/artifact/NL75tSC1beNcpVuSqUfoSH 第三版):頂端一片深藍灰帶子,註冊人數坐在半圓儀表正中間;
// 帶子底下是淺色毛玻璃卡。442 的骨架(登入、四關、讀資料、四個動作)與 445／453／454 補的(焦點、讀不到、改短、背景工作)沒動,只換「怎麼畫」。
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
  reasonText, KIND, BAN_CHOICES, shortenText, md, hm, mdhm, waited, fmtBytes, bellItems, gateRows, netNew, weekPair, deltaText,
  growthSeries, buildNum, isOld, peopleFilters, matchName, chatLines, hasContext, matchFiles, qrDataUrl,
  regCounts, actGauge, niceScale,
} from "./logic.js";

/* 被嵌進別人的頁面就什麼都不畫:點擊劫持(把按鈕疊在一個看起來無害的頁面底下騙你按)。
   GitHub Pages 送不了 frame-ancestors／X-Frame-Options,只能在這裡擋。 */
const FRAMED = window.top !== window.self;

const root = document.getElementById("root");
class Stop extends Error {}
/* 0163:對已經停權中的人按了會提早放人的期限 → admin 函式回 409 would_shorten ＋ 現在停到哪(第二十一次健檢卡 3)。 */
class Shorten extends Error { constructor(current) { super("would_shorten"); this.current = current; } }

/* ══ 狀態 ══ */
const S = {
  auth: "boot", loginErr: null, factor: null, enroll: null, me: null,
  view: "overview", bell: false, asof: null,
  rtab: "open", sel: null, rdetail: false, fog: true, ask: null, days: null, busy: false, shorten: null, banNote: "",
  q: "", pf: "all", drawer: null,
  done: {}, err: {}, actErr: null, loading: false,
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
  I_GO = "M9 5l7 7-7 7", I_BELL = "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0",
  I_REFRESH = "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6", I_OUT = "M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10";
const sec = (t, n) => put(el("h2", "sec"), el("span", null, t), n ? el("i", null, n) : null);
const card = (cls, title, meta, ...kids) => put(el("section", "card " + (cls || "")),
  title ? put(el("header", "ch"), el("h2", null, title), meta ? el("span", "cm", meta) : null) : null, ...kids);
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
  if (r.status === 409 && data?.error === "would_shorten") throw new Shorten(data.current ?? null);
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
  reports: async () => {
    const [q, b] = await Promise.all([api("queue"), api("banned")]); D.queue = q ?? []; D.banned = b ?? [];
    /* 電腦寬時清單跟詳情並排:還沒選就先選最舊的那筆待處理,右邊不留一張空卡(樣品 core.js 的作法;
       窄的時候 CSS 只秀清單,這裡選了也看不到,點下去才進詳情) */
    if (!S.sel || !D.queue.some((x) => x.id === S.sel)) S.sel = D.queue.find((x) => x.open)?.id ?? null;
    if (S.sel) loadReport(S.sel);
  },
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
  /* 頂帶那顆重新整理的圖示在讀的時候轉(按了有反應;成功就安靜地停,不出提示條) */
  S.loading = true; render();
  try { await Promise.all([loadBell(), loadView(S.view, true)]); } finally { S.loading = false; render(); }
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
let lastView = null;
function render() {
  if (FRAMED) return;
  /* ⚠️ 整頁每次都整個重畫 —— 焦點原本在哪顆鈕,重畫後就掉回 body,用鍵盤的人每按一下都要從頭 Tab(445 稽核抓到)。
     所以先記住焦點在哪一顆(data-k 或 id),重畫完放回去。 */
  const a = document.activeElement, fk = a && root.contains(a) ? (a.dataset?.k || a.id || null) : null;
  root.textContent = "";
  if (S.auth === "boot") { root.append(el("p", "loading", "讀取中…")); syncDrawer(); return; }
  if (S.auth !== "ok") { root.append(loginView()); syncDrawer(); return; }
  if (S.view !== lastView) { if (lastView) cue("view"); lastView = S.view; }
  /* 深色那一片＝頂端那一列＋(總覽才有的)註冊人數儀表與這週四個數;其他頁只剩那一列(.slim)。
     總覽的資料還沒到也先畫儀表的殼 —— 不然資料一到,帶子從一條長成一大片、整頁往下跳。讀不到(S.err)就只留那一列。 */
  const withHero = S.view === "overview" && !S.err.overview;
  const band = put(el("div", "deckband" + (withHero ? "" : " slim")), deck());
  if (withHero) band.append(heroDark(D.overview));
  root.append(put(el("div", "app"), band, mainView()));
  syncDrawer();
  placeTabs();
  if (fk && !S.drawer) (root.querySelector(`[data-k="${CSS.escape(fk)}"]`) ?? document.getElementById(fk))?.focus({ preventScroll: true });
}

/* ══ 外框:深色頂帶裡的那一列(第四百七十四輪;以前是左邊一條選單)══
   選中那頁＝薄荷膠囊。同一排字疊兩層:底下那層淺字是真的按鈕、上面那層薄荷底深字只露出選中那一格(clip-path);
   換頁時只有露出的那一格滑過去 —— 底色與字色是同一塊被揭開,不會一個先到一個後到(Emil 的做法;第四輪樣品驗過)。 */
const NAV = [["overview", "總覽"], ["reports", "檢舉"], ["people", "人"], ["feedback", "回饋"], ["system", "系統"]];
function deck() {
  const re = iconBtn(I_REFRESH, "重新整理", "refresh", () => refresh());
  if (S.loading) { re.classList.add("spin"); re.setAttribute("aria-busy", "true"); }
  const b = el("div", "brand", "揪起來"); b.append(el("small", null, "後台"));
  return put(el("header", "deck"), b, tabs(),
    put(el("div", "right"), S.asof ? el("span", "asof", S.asof) : null, re, bellView(), iconBtn(I_OUT, "登出", "logout", () => logout())));
}
function tabs() {
  const rail = el("div", "tabrail");
  const real = el("div", "tabs"), lit = el("div", "tabs lit"); lit.setAttribute("aria-hidden", "true");
  /* 檢舉那一格帶待處理的筆數 —— 讀鈴鐺的(每一頁都會讀),不讀 queue(只有切到檢舉才讀) */
  const open = Number(D.bell?.open_reports) || 0;
  NAV.forEach(([id, label]) => {
    const face = () => [el("span", "lb", label), id === "reports" && open ? el("span", "pip", String(open)) : null];
    const x = put(el("button", "tab"), ...face()); x.dataset.k = "nav-" + id; if (S.view === id) x.setAttribute("aria-current", "page");
    x.onclick = () => go(id); real.append(x);
    lit.append(put(el("span", "tab"), ...face()));
  });
  const nav = put(el("nav", "tabw"), put(rail, real, lit)); nav.setAttribute("aria-label", "後台");
  return nav;
}
/* render 之後量選中那格,把上面那層剪到那裡。上一次剪在哪記著:換了頁才從舊位置滑到新位置,其他重畫一律直接貼上。
   ⚠️ 上面那層每次重畫都是新節點,CSS 預設剪成全藏 —— 不先「不帶過場地貼到舊位置」的話,每按一下鈴鐺膠囊都會從左邊重新掃出來。
   字型晚到、視窗變寬窄也會改位置 —— 那兩種直接貼過去(instant)。 */
let litAt = null;
function placeTabs(instant = false) {
  const rail = root.querySelector(".tabrail"); if (!rail) return;
  const on = rail.querySelector(".tabs:not(.lit) [aria-current=page]"), lit = rail.querySelector(".lit");
  if (!on || !lit) return;
  const l = on.offsetLeft, r = rail.offsetWidth - l - on.offsetWidth;
  const to = `inset(0 ${r}px 0 ${l}px round 999px)`, from = instant || !litAt ? to : litAt;
  lit.style.transition = "none"; lit.style.clipPath = from; void lit.offsetWidth; lit.style.transition = "";
  if (from !== to) lit.style.clipPath = to;
  litAt = to;
}
document.fonts?.ready.then(() => placeTabs(true));
function iconBtn(d, label, k, fn) {
  const b = el("button", "iconbtn"); b.dataset.k = k; b.setAttribute("aria-label", label); b.title = label; b.append(icon(d, 18)); b.onclick = fn; return b;
}
async function logout() { await Auth.logout(); S.auth = "login"; S.loginErr = null; S.drawer = null; render(); }
function footBits(cls) {
  const f = el("div", cls);
  const re = el("button", "linkbtn ink", "重新整理"); re.onclick = () => refresh();
  const lo = el("button", "linkbtn", "登出"); lo.onclick = () => logout();
  return put(f, S.asof ? el("span", "asof", S.asof) : null, re, lo);
}

function top(title, n, withSearch) {
  const t = el("div", "top");
  const h = el("h1", null, title); if (n != null) h.append(el("i", null, String(n)));
  t.append(h);
  if (withSearch) {
    const s = el("label", "search"); s.append(icon(I_SEARCH));
    const inp = el("input"); inp.type = "search"; inp.placeholder = "找人"; inp.value = S.q; inp.setAttribute("aria-label", "找人"); inp.id = "q-" + S.view;
    /* ⚠️ 檢舉頁的清單有兩種(待處理／全部 是 queueList、已處理 是 handledList)—— 442 一律換成 queueList,
          在「已處理」打字就變成待處理的清單(445 稽核抓到) */
    inp.oninput = () => { S.q = inp.value; const box = root.querySelector("[data-list]"); if (box) box.replaceWith(S.view === "people" ? peopleTable() : S.rtab === "handled" ? handledList() : queueList()); };
    s.append(inp); t.append(s);
  }
  return t;
}

function bellView() {
  const items = bellItems(D.bell);
  const w = el("div", "bellw");
  const b = el("button", "bell"); b.dataset.k = "bell"; b.setAttribute("aria-label", items.length ? `${items.length} 件要處理` : "沒有要處理的事");
  b.setAttribute("aria-expanded", String(S.bell));
  b.append(icon(I_BELL, 21)); if (items.length) b.append(el("span", "pip", String(items.length)));
  b.onclick = (e) => { e.stopPropagation(); if (!S.bell) cue("bell"); S.bell = !S.bell; render(); };
  w.append(b);
  if (S.bell) {
    const pop = el("div", "pop"); pop.onclick = (e) => e.stopPropagation();
    pop.append(el("p", "ph2", "要處理的"));
    if (!items.length) put(pop, put(el("div", "calm"), el("span", "dot green"), el("span", null, "沒有要處理的事")));
    items.forEach((it, i) => {
      const r = el("button", "trow"); r.dataset.k = "bell-" + i; const tx = el("span", "tx", it.text); if (it.sub) tx.append(el("small", null, it.sub));
      put(r, el("span", "dot " + it.dot), tx, icon(I_GO, 18));
      r.onclick = () => {
        go(it.go.view, it.go);
        if (it.go.person) openPerson(it.go.person, "report");
      };
      pop.append(r);
    });
    play(pop, "bell", 240, "enter");
    w.append(pop);
  }
  return w;
}
document.addEventListener("click", () => { if (S.bell) { S.bell = false; render(); } });
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  /* 鈴鐺那張關掉時,焦點放回鈴鐺(不然焦點跟著那一列一起被拆掉,掉回 body;474 收尾兩份審查都抓到) */
  if (S.bell) { S.bell = false; render(); root.querySelector('[data-k="bell"]')?.focus(); } else if (S.drawer) closeDrawer();
});

function mainView() {
  const m = el("main", "main");
  const wrap = el("div", "wrap v-" + S.view);
  const body = { overview, reports, people, feedback, system }[S.view]();
  put(wrap, ...body, footBits("mobile-foot"));
  play(wrap, "view", 260, "enter");
  return put(m, wrap);
}
function oops(v) {
  if (!S.err[v]) return null;
  const b = el("div", "oops"); b.append(el("span", null, "讀不到:" + S.err[v]));
  const r = el("button", "btn sm", "再試一次"); r.onclick = () => loadView(v, true); b.append(r);
  return b;
}
/* ⚠️ 讀不到(S.err)的時候只留紅條＋再試一次 —— 同時再印「讀取中…」＝說謊(它不會再讀了;445 收尾審查抓到) */
const loading = (v) => (S.err[v] ? null : el("p", "loading", "讀取中…"));

/* ══ 動(第四百七十四輪)══ impeccable 定哪裡動、為什麼動 → Emil 定曲線與毫秒(三條曲線在 style.css 的 :root)。
   一個主角:第一次進總覽,儀表的弧從 0 掃到這週,「N 人這週有動作」那顆膠囊騎在弧的尖端一起走。
   其他只做交代:圖第一次捲進畫面才從底線長出來;切頁時薄荷膠囊滑過去、內容淡進來;鈴鐺那張從鈴鐺那角長出來;重新整理時圖示轉。
   ⚠️ 整頁每次 render 都整個重畫(鈴鐺、資料陸續到)—— 直接加 class 的話動畫會一直從頭演。
      所以記住每一段第一次開演的時間(T0),之後重畫用負的延遲接著演,演完就不再加(445 的 intro 同一招,收成這一支)。 */
const REDUCE = matchMedia("(prefers-reduced-motion: reduce)");
const T0 = {};
const cue = (key) => { T0[key] = performance.now(); };
function play(node, key, dur, cls) {
  if (T0[key] == null) return false;
  const e = performance.now() - T0[key];
  if (e > dur) return false;
  node.classList.add(cls);
  node.style.setProperty("--since", `${-Math.round(e)}ms`);
  return true;
}
/** 圖:第一次捲進畫面才長(開頁時在下面的圖,沒人看到就演完了等於沒演)。看到之前先「上膛」:柱子藏在底線下。
 *  減少動態、或瀏覽器沒有 IntersectionObserver → 直接畫好,不上膛(上膛了沒人解開＝圖永遠是空的)。 */
const IO = {};
function onSight(node, key, dur) {
  if (play(node, key, dur, "grow") || T0[key] != null) return;
  if (REDUCE.matches || !("IntersectionObserver" in window)) { T0[key] = -1e9; return; }
  node.classList.add("armed");
  IO[key]?.disconnect();
  const io = (IO[key] = new IntersectionObserver((es) => {
    if (!es.some((x) => x.isIntersecting)) return;
    io.disconnect(); cue(key); node.classList.remove("armed"); play(node, key, dur, "grow");
  }, { threshold: 0.3 }));
  io.observe(node);
}

/* ══ 總覽 ══ 註冊人數與這週四個數住在頂帶(heroDark,render 放的);這裡是帶子底下的三張卡,一張一整排。 */
function overview() {
  const ov = D.overview;
  /* 這一頁沒有看得到的頁標題(頂帶就是),標題留給讀屏 */
  const out = [el("h1", "sr", "總覽"), oops("overview")];
  if (!ov) { out.push(loading("overview")); return out; }
  const rc = regCounts(ov);
  const su = card("signc", "每週新註冊", rc.ever != null ? `註冊過 ${rc.ever} 人` : null, signupBars(ov), invites(ov));
  onSight(su, "c-signup", 1700);
  out.push(card("gatec", "驗證", "近 21 天", gateBody(ov)), su, setsCard(ov));
  return out;
}
/* 大數字底下那兩顆:這週新來幾個、刪了帳號幾個。後者是為了讓 10(目前)跟 11(註冊過)對得起來 —— regCounts 檔頭。 */
function regChips(rc) {
  const w = el("div", "hs");
  if (!rc) return w;
  put(w, el("span", "chip" + (rc.week > 0 ? " up" : ""), `這週 +${rc.week}`), rc.gone ? el("span", "chip", `刪了帳號 ${rc.gone}`) : null);
  return w;
}
/* ── 頂帶裡的主角(474,Synthex 三 深色頂帶)── 註冊人數坐在半圓儀表正中間;弧＝這週有動作的人 / 目前註冊(actGauge)。
   ov 還沒到:只畫儀表的殼、標籤與這週四格的字,數字的位置先留著。 */
function heroDark(ov) {
  const nw = narrow(), W = nw ? 360 : 760, H = nw ? 200 : 400, R = nw ? 150 : 330;
  const rc = ov ? regCounts(ov) : null, g = ov ? actGauge(ov) : { act: 0, now: null, f: 0 };
  const { s, cx, cy } = gauge({ f: g.f, W, H, r: R, sw: nw ? 10 : 14, label: ov ? `這週有動作 ${g.act} 人,目前註冊 ${g.now ?? "—"} 人` : null });
  /* 手機上弧小,數字底下再塞兩顆膠囊會頂到弧頂那顆「N 人這週有動作」—— 膠囊搬到儀表底下 */
  const box = put(el("div", "gbig"), s, put(el("div", "gc"),
    put(el("div", "hv"), el("p", "hl", "目前註冊人數"), el("p", "hn", ov ? (rc.now ?? "—") : " "), nw ? null : regChips(rc))));
  if (ov) {
    /* 弧的兩端寫刻度:0 與目前註冊人數(弧的分母) */
    const ex = ((cx - R) / W * 100).toFixed(2) + "%";
    const l = el("span", "gend", "0"), rr = el("span", "gend", g.now ?? "—"); l.style.left = ex; rr.style.right = ex;
    box.append(l, rr);
  }
  if (g.f > 0) {
    /* 騎士:一個跟弧同心、直徑＝弧的方框,膠囊釘在它最左邊(＝0 那一端),整框轉 f×180° 就到弧的尖端,膠囊自己反轉回來保持正的。
       弧是 stroke-dasharray 從 0 長到 100(pathLength＝100),長度跟角度成正比 —— 兩邊同一條曲線、同一段時間,所以一路貼著。
       ⚠️ 不准改成量弧尖的座標、再用 JS 每一格搬 left/top:背景分頁與被節流的框裡 rAF 會掉格,膠囊會落在弧後面。 */
    const rider = el("div", "rider");
    Object.assign(rider.style, { left: ((cx - R) / W * 100).toFixed(3) + "%", top: ((cy - R) / H * 100).toFixed(3) + "%", width: (2 * R / W * 100).toFixed(3) + "%", height: (2 * R / H * 100).toFixed(3) + "%" });
    rider.style.setProperty("--a", (g.f * 180).toFixed(2) + "deg");
    /* 手機上帶子只比弧寬一點:弧尖靠近兩端時膠囊會凸出畫面被切掉(474 收尾審查算的)—— 依弧尖的左右位置 u(0～1)把膠囊往裡推,
       最多推自己寬度的 45%。只推字,不動弧;推的是膠囊反轉回正之後的水平方向。 */
    if (nw) { const u = (1 - Math.cos(Math.PI * g.f)) / 2; rider.style.setProperty("--sx", (u < 0.2 ? (0.2 - u) / 0.2 * 45 : u > 0.8 ? -(u - 0.8) / 0.2 * 45 : 0).toFixed(1)); }
    rider.append(el("span", "gpill", `${g.act} 人這週有動作`));
    box.append(rider);
  }
  const hero = put(el("section", "hero" + (ov ? "" : " wait")), box, nw ? regChips(rc) : null, kpis(ov));
  if (ov) { if (T0.intro == null) cue("intro"); play(hero, "intro", 1500, "intro"); }
  play(hero, "view", 260, "enter");
  return hero;
}
/** 半圓儀表:弧＝ f(0～1,actGauge 算的;只給有分母的數 —— 沒有分母的數字不准畫圈)。 */
function gauge({ f, W, H, r, sw, label }) {
  const cx = W / 2, cy = H - 14;
  const pt = (t) => [cx - r * Math.cos(Math.PI * t), cy - r * Math.sin(Math.PI * t)];
  const s = svgRoot(W, H, label, "gauge big");
  const [ex, ey] = pt(1);
  s.append(svgEl("path", { d: `M${cx - r} ${cy} A${r} ${r} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`, class: "gt" }));
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * i / 10, r1 = r + sw * 0.9, r2 = r1 + (i % 5 ? 5 : 10);
    s.append(svgEl("line", { x1: (cx - r1 * Math.cos(a)).toFixed(1), y1: (cy - r1 * Math.sin(a)).toFixed(1), x2: (cx - r2 * Math.cos(a)).toFixed(1), y2: (cy - r2 * Math.sin(a)).toFixed(1), class: "gk" }));
  }
  if (f > 0) {
    const [px, py] = pt(f);
    const v = svgEl("path", { d: `M${cx - r} ${cy} A${r} ${r} 0 0 1 ${px.toFixed(2)} ${py.toFixed(2)}`, class: "gv", "stroke-width": sw, pathLength: 100 });
    /* --c 是開場 sweep 的起點「0 長、--c 空」:空要比整條長(101 > 100)—— 寫 100 的話第二段長度 0 的虛線剛好落在弧尾,
       圓頭會在弧還沒掃過去之前就先在終點冒一顆點(474 逐格截圖看到的) */
    v.style.setProperty("--c", "101"); s.append(v);
  }
  return { s, cx, cy };
}
/* 這週四個數(頂帶底部那條霧玻璃)。資料還沒到:字先在,數字的位置留著。 */
function kpis(ov) {
  const wrap = el("div", "kpis");
  weekPair(ov).forEach((x, i) => {
    const d = ov ? deltaText(x.now, x.before) : { cls: "", text: " " };
    put(wrap, put(el("div", "kpi k" + i), el("span", "k", x.k), el("b", null, ov ? String(x.now) : " "), el("span", "d " + d.cls, d.text)));
  });
  return wrap;
}
/* 驗證:整寬一張,左邊大數字＋五格(淨增量 / 5,L4 的門檻;儀表已經是頂帶的主角,這裡不畫第二個圈),右邊四道燈。 */
function gateBody(ov) {
  const nn = netNew(ov.gate);
  const big = put(el("div", "h0"), put(el("b", null, nn == null ? "—" : String(nn)), el("span", null, "/ 5")), el("span", "h0l", "場因為 App 才見到面"));
  const seg = el("div", "seg5"); seg.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 5; i++) seg.append(el("i", i < (Number(nn) || 0) ? "on" : ""));
  const list = el("div", "gates");
  gateRows(ov.gate).forEach((g) => {
    const row = el("div", "gate"); row.title = g.rule;
    const v = el("span", "v"); g.kv.forEach(([k, n], i) => { if (i) v.append(el("span", "sep", "·")); v.append(document.createTextNode(k + " "), el("b", null, n)); });
    put(row, el("span", "dot " + (g.light in { green: 1, yellow: 1, red: 1, invalid: 1, manual: 1 } ? g.light : "manual")), el("span", "nm", g.name), v, stTag(g.cls, g.word));
    list.append(row);
  });
  return put(el("div", "gx"), put(el("div", "gxl"), big, seg), list);
}

/* ══ 圖 ══ SVG 整張等比縮放(viewBox 固定、寬 100%、高跟著比例走)—— 圓頭與字才不會被拉歪(442/445 的 HTML 長條換掉)。
   螢幕窄於 760 換一組比較方的 viewBox(跨過那條線才重畫,手機鍵盤彈出不會把輸入框洗掉)。刻度用 logic.js 的 niceScale(不准第二份)。 */
function legend(items) {
  const lg = el("div", "legend");
  items.forEach(([cls, t]) => put(lg, put(el("span"), el("i", cls), document.createTextNode(t))));
  return lg;
}
function svgEl(tag, attrs) { const e = document.createElementNS(NS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, String(v))); return e; }
function svgRoot(W, H, label, cls) {
  const s = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: cls });
  if (label) { s.setAttribute("role", "img"); s.setAttribute("aria-label", label); } else s.setAttribute("aria-hidden", "true");
  return s;
}
const narrow = () => window.innerWidth < 760;
let bucket = narrow();
window.addEventListener("resize", () => { if (narrow() !== bucket) { bucket = narrow(); render(); } else placeTabs(true); });
const SEL = {}; // 每張圖目前指著哪一週 —— 重畫時留著,不然資料一到、鈴鐺一按,說明卡就跳回這週
let uid = 0;
const txt = (x, y, t, cls, anchor, i) => {
  const e = svgEl("text", { x: x.toFixed(1), y: y.toFixed(1), class: cls }); if (anchor) e.setAttribute("text-anchor", anchor);
  if (i != null) e.style.setProperty("--i", i);
  e.textContent = t; return e;
};
/** 共用的框:交錯的淡色週欄、虛線格線、右邊刻度、底下日期。字寫在 viewBox 單位裡:窄的圖縮得多,字給大一號,畫出來才差不多 12–14px。 */
function chartBase({ labels, max, step, W, H, pad, label }) {
  const [T, R, B, L] = pad, n = labels.length;
  const pw = W - L - R, ph = H - T - B, cw = pw / n;
  const x = (i) => L + (i + 0.5) * cw, y = (v) => T + ph - (v / max) * ph;
  const s = svgRoot(W, H, label, "chart"); s.style.setProperty("--fs", W >= 1000 ? "13.5px" : "16px");
  for (let i = 0; i < n; i++) s.append(svgEl("rect", { x: L + i * cw + 3, y: 4, width: cw - 6, height: T + ph - 4, rx: 12, class: "col" + (i % 2 ? " alt" : ""), "data-i": i }));
  for (let t = 0; t <= max; t += step) {
    s.append(svgEl("line", { x1: L, x2: W - R + 8, y1: y(t), y2: y(t), class: t ? "gl" : "gl base" }));
    s.append(txt(W - R + 18, y(t) + 4.5, String(t), "tk"));
  }
  const thin = narrow() && n > 8;
  labels.forEach((t, i) => { if (!thin || i % 2 === (n - 1) % 2) s.append(txt(x(i), H - 12, t, "xt" + (i === n - 1 ? " now" : ""), "middle")); });
  return { s, x, y, cw, L, W, H, n };
}
/** 收尾:每一週一塊看不見的感應區,滑過去說明卡就移到那一週;左右鍵也可以。
 *  說明卡坐在圖上方留的那一條(.chw 的 padding-top)裡,底下一個小尖角指著那一欄。
 *  ⚠️ 不准再放進圖裡:放在柱子旁邊會蓋住隔壁那一週(他 10-09 截給我的圖裡,08-24 那顆點就被蓋成灰的)。 */
function finish(g, tip, label, key) {
  const w = el("div", "chw"); w.tabIndex = 0; w.dataset.k = "chart-" + key; w.setAttribute("role", "group"); w.setAttribute("aria-label", label + "。左右鍵看每一週");
  w.append(g.s);
  /* ⚠️ 不准叫 hi:.hi 是「已處理」清單那一列(width:100%),套到 SVG 方塊上會把它撐成整張圖寬(第四輪樣品撞過) */
  const mark = (i) => g.s.querySelectorAll("[data-i]").forEach((e) => e.classList.toggle("wk", Number(e.dataset.i) === i));
  const c = el("div", "tip"), caret = el("i", "caret");
  const big = el("b"), l1 = el("span", "t1"), sub = el("small");
  put(c, big, put(el("span", "tx"), l1, sub), caret);
  /* 說明卡不掛 aria-live:滑鼠每滑過一週讀屏就唸一次。改成只有按左右鍵時用 say() 唸(474 收尾審查) */
  let cur = Math.min(SEL[key] ?? g.n - 1, g.n - 1);
  const place = () => {
    const cw = w.clientWidth; if (!cw) return;
    const cx = (g.x(cur) / g.W) * cw, tw = c.offsetWidth;
    const left = Math.max(0, Math.min(cw - tw, cx - tw / 2));
    c.style.transform = `translateX(${left.toFixed(1)}px)`;
    caret.style.transform = `translateX(${(cx - left).toFixed(1)}px)`;
  };
  const show = (i) => {
    cur = SEL[key] = i; const t = tip(i);
    big.textContent = t.big; l1.textContent = t.line; sub.textContent = t.sub ?? "";
    mark(i); place();
  };
  /* 第一次量到寬度那一下不准滑(不然每次重畫,說明卡都從最左邊滑過來) */
  let first = true;
  new ResizeObserver(() => {
    if (!first) return place();
    c.classList.add("still"); place(); void c.offsetWidth; c.classList.remove("still"); first = false;
  }).observe(w);
  for (let i = 0; i < g.n; i++) {
    const r = svgEl("rect", { x: g.L + i * g.cw, y: 0, width: g.cw, height: g.H, class: "hit" });
    r.addEventListener("pointerenter", () => show(i));
    r.addEventListener("click", () => show(i));
    g.s.append(r);
  }
  w.onkeydown = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault(); show(Math.max(0, Math.min(g.n - 1, cur + (e.key === "ArrowLeft" ? -1 : 1))));
    const t = tip(cur); say([t.big, t.line, t.sub].filter(Boolean).join(" "));
  };
  show(cur);
  w.append(c);
  return w;
}
/** 細圓頭直條:一週一到兩根並排(淺＝第一串、深＝第二串),這週那根最深;頭上寫數字。
 *  開場:柱子藏在底線後面(剪裁只露出底線以上),從那裡推出來 —— 只動 transform,圓頭一路是圓的。 */
function bars({ labels, series, tip, label, key, h = 300 }) {
  if (!labels.length) return el("p", "empty", "還沒有資料。");
  const nw = narrow(), W = nw ? 420 : 1000, H = nw ? 260 : h, n = labels.length;
  const { step, max } = niceScale(Math.max(1, ...series.flatMap((x) => x.v)) * 1.3);
  const g = chartBase({ labels, max, step, W, H, pad: [28, nw ? 40 : 58, 40, 4], label });
  const floor = g.y(0), id = "fl" + (++uid);
  const defs = svgEl("defs", {}), cp = svgEl("clipPath", { id }); cp.append(svgEl("rect", { x: 0, y: -60, width: W, height: (floor + 60).toFixed(1) })); defs.append(cp); g.s.prepend(defs);
  const grp = svgEl("g", { "clip-path": `url(#${id})` }), vals = [];
  const k = series.length, sw = nw ? 6 : 8, gap = Math.min(15, g.cw * 0.2);
  series.forEach((ser, j) => ser.v.forEach((v, i) => {
    if (!v) return;
    const cx = g.x(i) + (j - (k - 1) / 2) * gap, now = i === n - 1 ? " now" : "";
    const y0 = floor - sw / 2, y1 = Math.min(y0, g.y(v) + sw / 2);
    /* --h:整根(連上面的圓頭)推到底線後面要走多遠 */
    grp.append(svgEl("line", { x1: cx.toFixed(1), x2: cx.toFixed(1), y1: y0.toFixed(1), y2: y1.toFixed(1), class: "bar rise " + ser.cls + now, "stroke-width": sw, "data-i": i, style: `--i:${i};--h:${(y0 - y1 + sw).toFixed(1)}px` }));
    vals.push(txt(cx, g.y(v) - 12, String(v), "bv lab" + now, "middle", i));
  }));
  g.s.append(grp, ...vals);
  return finish(g, tip, label, key);
}
function signupBars(ov) {
  const g = growthSeries(ov.growth, 12);
  const labels = g.map((x, i) => (i === g.length - 1 ? "這週" : md(x.week)));
  const tip = (i) => ({ big: `+${g[i].n}`, line: `${i === g.length - 1 ? "這週" : md(g[i].week) + " 那週"}新註冊`, sub: `累計 ${g[i].cum} 人` });
  return bars({ labels, series: [{ v: g.map((x) => x.n), cls: "pb" }], tip, label: "每週新註冊的人數", key: "signup", h: 240 });
}
/* 每週的揪:成對細條(他 10-09 從三種挑的乙)—— 淺＝開的揪、深＝見到面,兩根並排、同一把尺。
   ⚠️ 不准相減、不准畫成一根裝在另一根裡:sets 照「開的那週」(created_at)、met 照「出發那週」(start_at)算
      (0063_analytics_v2.sql:161、178),不是同一批揪 ——「開了、沒見到面」算不出來,某一週見到面可以比開的多。
      第四輪樣品第一版就畫了那個差(斜線區間帶),adminwebprobe §5 釘著。 */
function setsCard(ov) {
  const w = ov.weeks ?? [], n = w.length;
  const labels = w.map((x, i) => (i === n - 1 ? "這週" : md(x.week)));
  const v = (k) => w.map((x) => Number(x[k]) || 0);
  const sets = v("sets"), met = v("met"), act = v("active");
  const when = (i) => (i === n - 1 ? "這週" : `${md(w[i].week)} 那週`);
  const tip = (i) => ({ big: String(sets[i]), line: `${when(i)}開的揪`, sub: `見到面 ${met[i]} · 活躍的人 ${act[i]}` });
  const c = card("setsc", "每週的揪", n ? `近 ${n} 週` : null, legend([["k-pa", "開的揪"], ["k-pb", "見到面"]]),
    bars({ labels, series: [{ v: sets, cls: "pa" }, { v: met, cls: "pb" }], tip, label: `近 ${n} 週開的揪與見到面的場數`, key: "sets", h: 300 }));
  onSight(c, "c-sets", 1700);
  return c;
}
function invites(ov) {
  const t = ov.totals ?? {};
  const inv = el("div", "inv");
  [["發出的邀請", t.invites], ["被點開", t.invite_opened], ["用掉", t.invite_used], ["朋友關係", t.friendships]].forEach(([k, v], i) => {
    if (i) inv.append(el("span", "ar", i === 3 ? "·" : "→"));
    put(inv, put(el("span", "iv"), el("b", null, v ?? "—"), document.createTextNode(k)));
  });
  return inv;
}

/* ══ 檢舉 ══ */
const openRows = () => (D.queue ?? []).filter((r) => r.open);
function reports() {
  const out = [top("檢舉", null, S.rtab !== "banned"), oops("reports")];
  const segs = el("div", "segs");
  [["open", "待處理", openRows().length], ["handled", "已處理"], ["all", "全部"], ["banned", "停權中", (D.banned ?? []).length]].forEach(([id, label, n]) => {
    const b = el("button"); b.dataset.k = "seg-" + id; b.setAttribute("aria-pressed", String(S.rtab === id));
    put(b, el("span", null, label), n ? el("span", "num", String(n)) : null);
    b.onclick = () => { S.rtab = id; S.rdetail = false; S.ask = null; S.actErr = null; render(); };
    segs.append(b);
  });
  out.push(segs);
  if (!D.queue) { out.push(loading("reports")); return out; }
  if (S.rtab === "banned") { out.push(bannedList()); return out; }
  if (S.rtab === "handled") { out.push(handledList()); return out; }
  /* 清單是空的(沒有待處理／搜不到)就不畫右邊那張卡 —— 一張沒有內容的黏土卡比沒有更糟 */
  out.push(queueRows().length ? put(el("div", "split" + (S.rdetail ? " detail" : "")), queueList(), detailPane()) : queueList());
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
    const b = el("button", "qi"); b.dataset.k = "qi-" + r.id; b.setAttribute("aria-current", String(S.sel === r.id));
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
  const see = el("button", "btn sm", "看這個人"); see.dataset.k = "see"; see.onclick = () => openPerson(r.target_id, "report");
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
  const mk = (label, cls, key) => { const b = el("button", "btn " + cls, label); b.dataset.k = "ask-" + key; b.setAttribute("aria-expanded", String(S.ask === key)); b.onclick = () => { S.ask = S.ask === key ? null : key; S.days = null; S.shorten = null; S.banNote = ""; S.actErr = null; render(); }; return b; };
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
  const box = el("div", "evwrap" + (S.fog ? " fog" : ""));
  /* 霧用切 class,不整頁重畫 —— 重畫會換掉節點,模糊散開的過場就被吃掉了 */
  const tg = el("button", "btn sm", S.fog ? "看清楚" : "霧回去"); tg.dataset.k = "fog";
  const chat = el("div", "chat"), lz = loose.length ? el("div", "loose") : null;
  /* 霧著的時候裡面的下載連結也不准被 Tab 到(pointer-events 只擋滑鼠,焦點會落在看不見的東西上)—— inert */
  const fogged = () => { chat.inert = S.fog; if (lz) lz.inert = S.fog; };
  tg.onclick = () => { S.fog = !S.fog; box.classList.toggle("fog", S.fog); tg.textContent = S.fog ? "看清楚" : "霧回去"; fogged(); };
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
  put(box, put(el("div", "evtools"), el("span", "evh", hasContext(ev) ? "證據 · 前後各 9 則" : "證據 · 那一則"), tg), chat);
  if (lz) { loose.forEach((f) => lz.append(fileNode(f, true))); box.append(lz); }
  fogged();
  const errs = [];
  if (ev.files_error) errs.push(el("div", "done mute", "有檔沒拷到:" + ev.files_error));
  if (ev.context_error) errs.push(el("div", "done mute", "前後文沒存到:" + ev.context_error));
  return [box, ...errs];
}
function fileNode(f, small) {
  if (!f.url) return el("span", "note", `(${f.name},檔已經不在了)`);
  if (f.img) {
    const img = el("img"); img.src = f.url; img.alt = small ? "證據附件" : "證據照片"; img.referrerPolicy = "no-referrer"; img.loading = "lazy";
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
    say(S.actErr || S.done[id]?.text || "");
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
      const b = el("button", "chipbtn", c.label); b.dataset.k = "day-" + c.days; b.setAttribute("aria-pressed", String(S.days === c.days));
      /* 換了天數,剛才那一句「會提早放人」就不算數了(它講的是上一個選擇) */
      b.onclick = () => { S.days = c.days; if (S.shorten) { S.shorten = null; render(); return; } chips.forEach((x, i) => x.setAttribute("aria-pressed", String(BAN_CHOICES[i].days === c.days))); check(); };
      days.append(b); return b;
    });
    /* 整頁重畫會重做這個輸入框:被擋回來那一下,剛打的理由要還在(S.banNote) */
    if (S.banNote) note.value = S.banNote;
    note.oninput = check;
    /* 會不會提早放人只問資料庫(0163 admin_ban);被擋回來(Shorten)就把確認那一行畫出來,不當成錯誤。 */
    const send = (btn, shorten) => act(btn, async () => {
      const t = note.value.trim(), c = BAN_CHOICES.find((x) => x.days === S.days);
      S.banNote = t;
      try {
        await api("ban", { id, target: r.target_id, note: t, days: S.days, ...(shorten ? { shorten: true } : {}) });
      } catch (e) {
        if (e instanceof Shorten) { S.shorten = { id, current: e.current }; throw new Stop(); }
        throw e;
      }
      S.shorten = null; S.banNote = "";
      S.done[id] = { text: `${r.target_name ?? ""} ${c?.days === "forever" ? "永久停權" : "停權 " + c?.label}:「${t}」`, red: true };
      await afterWrite(id);
    });
    g.onclick = () => send(g, false);
    put(box, el("p", "q", "停多久"), days, put(el("div", "row"), note, g));
    if (S.shorten?.id === id) {
      const c = BAN_CHOICES.find((x) => x.days === S.days);
      const y = el("button", "btn danger", "改短"); y.dataset.k = "ban-shorten";
      const n = el("button", "btn", "先不要"); n.dataset.k = "ban-keep";
      y.onclick = () => send(y, true);
      n.onclick = () => { S.shorten = null; S.banNote = ""; S.ask = null; render(); };
      put(box, el("p", "q", shortenText(S.shorten.current, c?.label ?? "")), put(el("div", "row"), y, n));
    }
    check();
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
        } catch (e) { if (!(e instanceof Stop)) { err.textContent = e.message; err.hidden = false; g.disabled = false; S.busy = false; say(e.message); return; } }
        S.busy = false; render(); say(S.done["unban:" + p.id]?.text ?? "");
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
    const b = el("button", "hi"); b.dataset.k = "hi-" + h.id;
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
  if (!rows) { out.push(loading("people")); return out; }
  const f = el("div", "filters");
  peopleFilters(latestBuild()).forEach((x) => {
    const b = el("button"); b.dataset.k = "pf-" + x.id; b.setAttribute("aria-pressed", String(S.pf === x.id));
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
  ["名字", "版本", "最近有動作", "朋友", "開揪 / 參加", "見到面", ""].forEach((t) => head.append(el("span", null, t)));
  box.append(head);
  const fx = peopleFilters(latestBuild()).find((x) => x.id === S.pf) ?? peopleFilters(latestBuild())[0];
  const rows = (D.people ?? []).filter(fx.fn).filter((p) => matchName(S.q, p.name, p.handle));
  if (!rows.length) { box.append(el("p", "empty", "沒有符合的人。")); return box; }
  rows.forEach((p) => {
    const b = el("button", "prow"); b.dataset.k = "p-" + p.id;
    const who = el("span", "who"); put(who, el("b", null, p.name ?? "(查不到名字)"), el("span", null, p.handle ? "@" + p.handle : "沒有自選 ID"));
    const bn = buildNum(p.build);
    const bd = el("span", "c bd" + (bn == null ? " none" : isOld(p, latestBuild()) ? " old" : ""), bn == null ? (p.build ? p.build : "沒回報過") : String(bn));
    const tag = personTag(p) || (p.reports ? stTag("warm", "被檢舉 " + p.reports) : null);
    put(b, who, bd, el("span", "c la", p.last ? md(p.last) : "—"), el("span", "c fr", String(p.friends ?? 0)),
      el("span", "c hj", `${p.hosted ?? 0} / ${p.joined ?? 0}`), el("span", "c mt", String(p.met ?? 0)), tag ? put(el("span", "stc"), tag) : el("span"));
    b.onclick = () => openPerson(p.id, "person");
    box.append(b);
  });
  return box;
}

/* ══ 回饋 ══ */
function feedback() {
  const rows = D.feedback;
  const out = [top("回饋", rows ? rows.length : null), oops("feedback")];
  if (!rows) { out.push(loading("feedback")); return out; }
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
  if (!s) { out.push(loading("system")); return out; }
  const box = el("div", "sys");
  const line = (nm, light, word, kv) => {
    const v = el("span", "v"); kv.forEach(([k, n], i) => { if (i) v.append(el("span", "sep", "·")); v.append(document.createTextNode(k + " "), el("b", null, n)); });
    put(box, put(el("div", "srow"), el("span", "dot " + light), el("span", "nm", nm), v, word ? stTag(light === "green" ? "ok" : light === "red" ? "red" : "warm", word) : null));
  };
  const pf = s.push_fatal_30d ?? 0;
  line("推播", pf ? "red" : "green", pf ? "出錯" : "正常", pf ? [["30 天內全站級錯誤", `${pf} 次`], ["最近一次", mdhm(s.push_fatal_last)]] : [["30 天內全站級錯誤", "0"]]);
  const c = s.cron ?? {};
  line("排程", c.failed_24h ? "red" : "green", c.failed_24h ? "有失敗" : "正常",
    [["24 小時跑了", `${c.runs_24h ?? 0} 次`], ["失敗", String(c.failed_24h ?? 0)], ...(c.off ? [["關著", `${c.off} 支`]] : [])]);
  if ((c.failed_jobs ?? []).length) box.append(el("p", "mono", "失敗的:" + c.failed_jobs.join("、")));
  const pn = s.pgnet ?? {};
  line("伺服器互叫", pn.errors ? "yellow" : "green", pn.errors ? "有錯" : "正常", [[`最近 ${pn.window_hours ?? "—"} 小時`, `${pn.calls ?? 0} 次`], ["錯誤", String(pn.errors ?? 0)]]);
  /* 0164:警報帳本(巡邏抄進來的,留 90 天)。被擋／沒送出去、巡邏停了＝紅(鈴鐺也響);其他出錯＝黃。 */
  const nf = s.netfail ?? {};
  const nfRed = (nf.blocked_24h ?? 0) > 0 || nf.patrol_stale === true;
  line("背景工作", nfRed ? "red" : nf.failures_24h ? "yellow" : "green",
    (nf.blocked_24h ?? 0) > 0 ? "被擋" : nf.patrol_stale === true ? "巡邏停了" : nf.failures_24h ? "有錯" : "正常",
    [["24 小時出錯", `${nf.failures_24h ?? 0} 發`], ["被擋／沒送出去", String(nf.blocked_24h ?? 0)], ["7 天", `${nf.failures_7d ?? 0} 發`],
     ["巡邏", nf.patrol_scanned_at ? mdhm(nf.patrol_scanned_at) : "沒跑過"]]);
  const q = s.quota ?? {};
  line("限流帳本", "manual", null, [["24 小時記了", `${q.hits ?? 0} 次`], ["人", String(q.users ?? 0)]]);
  out.push(card("", "狀態", null, box));

  const b = s.builds ?? {};
  const bl = el("div", "blds");
  const dist = b.dist ?? [];
  const mx = Math.max(1, ...dist.map((x) => x.n));
  dist.forEach((x) => {
    const k = el("span", "k" + (x.build === b.latest ? " cur" : x.build == null ? " nr" : ""), x.build == null ? "沒回報過" : "build " + x.build);
    const tr = el("div", "tr"); const fl = el("span", "fl" + (x.build === b.latest ? "" : x.build == null ? " nr" : " old")); fl.style.width = (x.n / mx * 100) + "%"; tr.append(fl);
    put(bl, put(el("div", "bld"), k, tr, el("span", "n", String(x.n))));
  });
  const sto = el("div", "stos");
  const order = ["memory", "live", "avatars", "evidence", "total"];
  [...(s.storage ?? [])].sort((a, z) => order.indexOf(a.k) - order.indexOf(z.k)).forEach((x) =>
    put(sto, put(el("div", "store"), el("span", null, STORE_NAME[x.k] ?? x.k), el("span", "c", `${x.n} 個`), el("span", "c", fmtBytes(x.bytes)))));
  out.push(put(el("div", "grid2"), card("", "大家在第幾版", b.latest ? "最新 build " + b.latest : null, bl), card("", "倉庫", null, sto)));

  const bd = el("div", "blind");
  [["最近一次打開 App", " 沒在記。「最近有動作」是開揪、加入、按過東西的時間。"],
   ["聊天", " 散場 48 小時後清掉,只剩結晶那一刻記的句數。"],
   ["閃退", " 在 Sentry,這裡沒有。"]].forEach(([b1, t]) => bd.append(put(el("p"), el("b", null, b1), document.createTextNode(t))));
  out.push(card("blindc", "看不到的", null, bd));
  return out;
}

/* ══ 抽屜:一個人 ══
   從檢舉打開(report)＝處理檢舉,看得到他最近揪的標題(伺服器也只對被檢舉過的人給);
   從「人」打開(person)＝只有場數,不畫揪的標題(隱私頁:統計不含內容)。
   ⚠️ 外殼(暗幕＋抽屜)常駐在 body、不跟著整頁重畫 —— 每次重畫都換新節點的話,滑進滑出的過場永遠演不出來
      (442 版就是這樣:抽屜直接跳出來)。內容每次重填。 */
let opener = null;
function openPerson(id, mode) {
  if (!S.drawer) opener = document.activeElement?.dataset?.k ?? null;
  S.drawer = { id, mode }; S.bell = false; render(); loadPerson(id);
}
function closeDrawer() { S.drawer = null; render(); }
let drawerEl = null, scrimEl = null;
function syncDrawer() {
  if (!drawerEl) {
    scrimEl = el("div", "scrim"); scrimEl.onclick = () => closeDrawer();
    drawerEl = el("aside", "drawer");
    [["role", "dialog"], ["aria-modal", "true"], ["aria-labelledby", "drw-h"]].forEach(([k, v]) => drawerEl.setAttribute(k, v));
    document.body.append(scrimEl, drawerEl);
  }
  const was = drawerEl.classList.contains("on");
  const on = !!S.drawer && S.auth === "ok";
  scrimEl.classList.toggle("on", on); drawerEl.classList.toggle("on", on);
  const app = root.querySelector(".app"); if (app) app.inert = on;
  if (on) {
    /* 內容每次重填(資料讀回來也會)—— 焦點原本在抽屜裡就留在同一顆,剛打開就放在「關上」 */
    const inside = drawerEl.contains(document.activeElement) ? (document.activeElement.dataset?.k ?? "close") : null;
    drawerEl.replaceChildren(...drawerBody());
    if (!was || inside) drawerEl.querySelector(`[data-k="${CSS.escape(inside ?? "close")}"]`)?.focus({ preventScroll: true });
  } else if (was) {
    if (opener) root.querySelector(`[data-k="${CSS.escape(opener)}"]`)?.focus({ preventScroll: true });
    opener = null;
  }
}
/* 讀屏的播報:處理完的結果照舊寫在原地(畫面上),這裡只是讓看不到畫面的人也聽得到 —— 不是會消失的提示條 */
let liveEl = null;
function say(t) {
  if (!t) return;
  if (!liveEl) { liveEl = el("div", "sr"); liveEl.setAttribute("role", "status"); document.body.append(liveEl); }
  liveEl.textContent = "";
  setTimeout(() => { liveEl.textContent = t; }, 60);
}
function drawerBody() {
  const { id, mode } = S.drawer;
  const P = D.person[id];
  const row = (D.people ?? []).find((x) => x.id === id);
  const u = P?.user ?? (row ? { name: row.name, handle: row.handle, banned: row.banned, until: row.until, gone: row.gone } : {});
  const x = el("button", "close"); x.dataset.k = "close"; x.setAttribute("aria-label", "關上"); x.append(icon(I_X, 18)); x.onclick = () => closeDrawer();
  const h = el("h3", null, u.name ?? "(查不到名字)"); h.id = "drw-h";
  const out = [x, h, put(el("div", "ph"), u.handle ? el("span", "hd", "@" + u.handle) : null, personTag(u) || stTag("ok", "正常"))];
  if (P?.error) { out.push(el("div", "done red", "讀不到:" + P.error)); return out; }
  const bans = P?.bans ?? [];
  const f = el("div", "facts");
  const facts = mode === "report" || !row
    ? [[P?.reporters_30d ?? "—", "30 天內檢舉他的人"], [P?.reports_total ?? "—", "被檢舉共幾筆"], [P ? bans.filter((b) => b.kind === "user_banned").length : "—", "停過幾次"]]
    : [[row.friends ?? 0, "朋友"], [row.hosted ?? 0, "開過的揪"], [row.joined ?? 0, "參加過"], [row.met ?? 0, "見到面"],
       [buildNum(row.build) ?? "—", "版本"], [row.push ? "開著" : "沒開", "推播"], [md(row.since), "加入"], [row.by_name ?? "—", "被誰帶進來"], [row.brought ?? 0, "帶進來的人"]];
  facts.forEach(([n, l]) => put(f, put(el("div"), el("b", null, String(n)), el("span", null, l))));
  out.push(f);
  if (!P) { out.push(el("p", "loading", "讀取中…")); return out; }

  const reps = P.reports ?? [];
  if (mode === "report" || reps.length) {
    out.push(sec("被檢舉的紀錄", `${reps.length} 筆`));
    const tl = el("div", "tl");
    reps.forEach((h) => put(tl, put(el("div", "tli"),
      put(el("div", "l1"), el("b", null, reasonText(h.reason)), el("span", null, `${h.reporter_name ?? "(查不到名字)"} 檢舉`),
        h.open ? stTag("warm", "待處理") : stTag("mute", h.auto_closed ? "自動" : "人工"), el("span", "mono", md(h.created_at))),
      !h.open && h.handled_note ? el("div", "nt", `「${h.handled_note}」`) : null)));
    out.push(reps.length ? tl : el("p", "empty", "沒有。"));
  }
  if (mode === "report" || bans.length) {
    out.push(sec("停權紀錄", `${bans.filter((b) => b.kind === "user_banned").length} 次`));
    const bl = el("div", "tl");
    bans.forEach((b) => {
      const what = b.kind === "user_banned" ? (b.days == null ? "永久停權" : `停權 ${b.days} 天`) : b.kind === "user_unbanned" ? "解封" : "到期解開";
      put(bl, put(el("div", "tli"), put(el("div", "l1"), el("b", null, what), el("span", "mono", mdhm(b.at))), b.note ? el("div", "nt", `「${b.note}」`) : null));
    });
    out.push(bans.length ? bl : el("p", "empty", "沒有停過。"));
  }
  if (mode === "report") {
    out.push(sec("最近的揪"));
    const acts = P.acts ?? [];
    const al = el("div", "tl");
    const ROLE = { host: ["ok", "主揪"], joined: ["mute", "參加"], left: ["mute", "不去了"] };
    acts.forEach((a) => { const [c, t] = ROLE[a.role] ?? ["mute", a.role]; put(al, put(el("div", "tli"), put(el("div", "l1"), el("b", null, `「${a.title ?? ""}」`), stTag(c, t), el("span", "mono", md(a.start_at))))); });
    out.push(acts.length ? al : el("p", "empty", "沒有。"));
  } else if (!reps.length && !bans.length) {
    out.push(sec("檢舉與停權"), el("p", "empty", "沒有被檢舉過,也沒有停過。"));
  }
  return out;
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
      put(c, el("p", "lp", "用驗證器 App 掃這個"), q, S.enroll.secret ? el("p", "secret", S.enroll.secret) : null, field, err, go2);
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
