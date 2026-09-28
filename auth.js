// 後台網頁版的登入(第四百四十二輪)—— Google 登入 ＋ 驗證器(TOTP)。直接打 Supabase Auth 的 REST,不載 supabase-js。
//
// 他 09-28:「google，驗證器」。App 本來就只有 Apple／Google 登入(lib/socialAuth.ts),後台用同一個 Google 帳號。
//
// ── 為什麼不載 supabase-js ─────────────────────────────────────────────
//   這一頁放在公開的 GitHub Pages,手上握著的是管理員的登入。多載一包第三方程式＝多一條供應鏈
//   (CDN 被換掉、版本被投毒)跑在這個握著停權權力的頁面裡 —— _shared/deps.ts 檔頭同一課。
//   要用的只有六個端點(PKCE 換 token、換新 token、列因素、綁驗證器、驗六位數、登出),自己寫完全看得見。
//   端點與參數照 node_modules/@supabase/auth-js 的 GoTrueClient 逐一對過(authorize 帶 code_challenge、
//   token?grant_type=pkce 帶 auth_code＋code_verifier、factors／challenge／verify)。
//
// ── 登入狀態放 sessionStorage,不放 localStorage ──────────────────────
//   GitHub Pages 的專案頁跟帳號底下其他頁**同一個來源**(we-do-stuff-tw.github.io);官網哪天公開就是鄰居。
//   localStorage 同來源的每一頁都讀得到;sessionStorage 只有這一個分頁讀得到,關掉分頁就沒了。
//   代價:每開一個新分頁要重登一次(Google 通常一鍵、再輸一次六位數)。後台一天開不了幾次,划算。
//
// ── 第二道驗證的真正把關在伺服器 ─────────────────────────────────────
//   這裡的「先輸六位數」只是帶路;admin 函式自己看 JWT 上的 aal(_shared/admin.ts 的第 ③ 關)。
//   就算有人繞過這一頁直接打函式,沒過驗證器的 JWT 一樣 403。
import { SUPABASE_URL, PUBLISHABLE_KEY } from "./config.js";

const SESSION = "jolink-admin.session";
const VERIFIER = "jolink-admin.pkce";
const store = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* 私密視窗寫不進去:這一趟照樣能用,只是重新整理要重登 */ } },
  del: (k) => { try { sessionStorage.removeItem(k); } catch { /* 同上 */ } },
};

/** 登入回來的網址 ＝ 這一頁本身(不含 ?、#)。⚠️ 要在 Supabase Auth 的轉址白名單上(deploy-round436-admin.sh 加)。 */
export const siteUrl = () => location.origin + location.pathname;

async function gotrue(path, { method = "POST", body, token } = {}) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method,
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!r.ok) {
    const e = new Error(data?.msg || data?.message || data?.error_description || data?.error || `HTTP ${r.status}`);
    e.status = r.status;
    e.code = data?.error_code || data?.code || null;
    throw e;
  }
  return data;
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** 按「用 Google 登入」:PKCE —— 驗證碼的原文留在這個分頁,只把雜湊送出去。 */
export async function startGoogle() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  store.set(VERIFIER, verifier);
  const u = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  u.searchParams.set("provider", "google");
  u.searchParams.set("redirect_to", siteUrl());
  u.searchParams.set("code_challenge", b64url(digest));
  u.searchParams.set("code_challenge_method", "s256");
  location.assign(u.toString());
}

function save(t) {
  const s = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: t.expires_at ?? Math.floor(Date.now() / 1000) + (Number(t.expires_in) || 3600),
  };
  store.set(SESSION, JSON.stringify(s));
  return s;
}
export function current() {
  try { return JSON.parse(store.get(SESSION) || "null"); } catch { return null; }
}
export function clear() { store.del(SESSION); store.del(VERIFIER); }

/** JWT 的內容(不驗簽 —— 只拿來決定「下一步帶你去哪」,真正的判斷在伺服器)。 */
export function claims(token) {
  try {
    const p = String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(p + "=".repeat((4 - (p.length % 4)) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch { return null; }
}
export const aal = () => claims(current()?.access_token)?.aal ?? null;

/** 從 Google 回來(?code=…)→ 換成登入。⚠️ 網址上的 code 立刻從網址列拿掉(不留在上一頁紀錄裡)。 */
export async function finishRedirect() {
  const q = new URLSearchParams(location.search);
  const code = q.get("code");
  const err = q.get("error_description") || q.get("error");
  if (!code && !err) return { handled: false };
  history.replaceState(null, "", siteUrl() + location.hash);
  if (err) return { handled: true, error: err };
  const verifier = store.get(VERIFIER);
  store.del(VERIFIER);
  if (!verifier) return { handled: true, error: "這個分頁沒有登入到一半的紀錄,再按一次登入" };
  try {
    save(await gotrue("/token?grant_type=pkce", { body: { auth_code: code, code_verifier: verifier } }));
    return { handled: true };
  } catch (e) {
    return { handled: true, error: e.message };
  }
}

/** 快到期(剩不到 60 秒)就換一張新的;換不到＝登出。換新不會掉 aal2(同一個 session)。 */
export async function fresh() {
  const s = current();
  if (!s?.access_token) return null;
  if (s.expires_at - Date.now() / 1000 > 60) return s;
  try {
    return save(await gotrue("/token?grant_type=refresh_token", { body: { refresh_token: s.refresh_token } }));
  } catch {
    clear();
    return null;
  }
}

async function token() {
  const s = await fresh();
  if (!s) throw Object.assign(new Error("登入過期了"), { status: 401 });
  return s.access_token;
}

/** 這個帳號的驗證器(TOTP)。 */
export async function totpFactors() {
  const u = await gotrue("/user", { method: "GET", token: await token() });
  return (Array.isArray(u?.factors) ? u.factors : []).filter((f) => f.factor_type === "totp");
}

/** 第一次:綁一個驗證器。先清掉上次沒綁完的(掃到一半關掉的那種;留著會擋住新的)。
 *  回 { id, totp: { qr_code, secret, uri } } —— qr_code 是 GoTrue 給的 SVG data 網址。 */
export async function enroll() {
  const t = await token();
  for (const f of await totpFactors()) {
    if (f.status !== "verified") await gotrue(`/factors/${f.id}`, { method: "DELETE", token: t });
  }
  return gotrue("/factors", { token: t, body: { factor_type: "totp", friendly_name: `後台 ${new Date().toISOString().slice(0, 10)}`, issuer: "揪起來後台" } });
}

/** 輸六位數:challenge → verify。成功之後手上這張換成 aal2 的新 JWT。 */
export async function verifyCode(factorId, code) {
  const t = await token();
  const ch = await gotrue(`/factors/${factorId}/challenge`, { token: t, body: {} });
  save(await gotrue(`/factors/${factorId}/verify`, { token: t, body: { challenge_id: ch.id, code } }));
}

export async function logout() {
  const s = current();
  clear();
  if (s?.access_token) {
    try { await gotrue("/logout?scope=local", { token: s.access_token }); } catch { /* 伺服器那邊登出失敗無妨:這個分頁已經忘了它 */ }
  }
}
