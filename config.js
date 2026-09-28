// 後台網頁版的設定(第四百四十二輪)。⚠️ 這個檔會被放進**公開**的 repo(we-do-stuff-TW/jolink-admin)。
//
// 這裡只准放「本來就是公開的」東西:
//   · 專案網址 —— App 裡就有,誰都看得到。
//   · publishable 金鑰(sb_publishable_…)—— 官方設計成放在瀏覽器與 App 裡的那一把,只開得了 RLS 放行的門;
//     後台的資料一律走 admin 函式的四關(登入＋驗證器＋名單),這把鑰匙本身拿不到任何一筆。
// ⚠️ 絕對不准出現 secret 金鑰(那把繞過全部 RLS)或 PAT —— scripts/adminwebprobe.mjs 連註解一起掃,連它們的前綴都不准寫。
export const SUPABASE_URL = "https://tfnawvhjpbrqjmaniilm.supabase.co";
export const PUBLISHABLE_KEY = "sb_publishable_afdxEQl1wVseJN8ffG9QPg_LD1gAy_b";
