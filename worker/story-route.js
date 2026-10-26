/* ════════════════════════════════════════════════════════════════
 * 阿公說故事 分享連結（arcar v24 新增）— 路由 /story/*
 * KV：優先用 STORY_KV，沒綁就沿用 BLESSING_KV（key 前綴 sm: / sa:，不會和齊聲祝福撞）
 * 上傳通行碼沿用 VOICE_TOKEN（有設才檢查）
 *
 * POST   /story          body=音檔，headers：Content-Type、X-Token、X-Title、X-Emoji、X-Kid、X-Dur、X-Ai（中文用 encodeURIComponent）
 *                         → { id, key, url }
 * GET    /story/s/:id    收聽頁（給孫子點，LINE 會抓 og 預覽）
 * GET    /story/a/:id    音檔（支援 Range，iPhone 才能播）
 * DELETE /story/:id      header X-Key = 上傳時拿到的 key
 * 名稱都加 st / ST_ 前綴，避免和 arcar 其他功能撞名
 * ════════════════════════════════════════════════════════════════ */
const ST_MAX_AUDIO = 20 * 1024 * 1024;           // KV 單值上限 25 MiB
const ST_ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
const ST_ORIGINS = ['https://kftseng2oo1.github.io', 'http://localhost', 'http://127.0.0.1'];
const ST_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Token,X-Key,X-Title,X-Emoji,X-Kid,X-Dur,X-Ai',
  'Access-Control-Expose-Headers': 'Content-Range,Content-Length,Accept-Ranges',
  'Access-Control-Max-Age': '86400'
};

function stRid(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (const x of b) s += ST_ALPHA[x % ST_ALPHA.length];
  return s;
}
async function stSha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const stJson = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: Object.assign({}, ST_CORS, { 'Content-Type': 'application/json; charset=utf-8' }) });
const stErr = (m, st = 400) => stJson({ error: m }, st);
const stStr = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const stDec = (req, h) => { try { return decodeURIComponent(req.headers.get(h) || ''); } catch (e) { return ''; } };
const stH = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stMmss = s => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

async function handleStory(req, env) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ST_CORS });
  const kv = env.STORY_KV || env.BLESSING_KV;
  if (!kv) return stErr('arcar 尚未綁定 STORY_KV（或 BLESSING_KV）', 500);
  const url = new URL(req.url);
  const seg = url.pathname.split('/').filter(Boolean).slice(1);   // 去掉 'story'
  const m = req.method;
  try {
    // ── 上傳 ──
    if (seg.length === 0 && m === 'POST') {
      const origin = req.headers.get('Origin') || '';
      if (!ST_ORIGINS.some(o => origin === o || origin.startsWith(o + ':'))) return stErr('不允許的來源', 403);
      if (env.VOICE_TOKEN && (req.headers.get('X-Token') || '') !== env.VOICE_TOKEN) return stErr('通行碼不對', 401);
      const buf = await req.arrayBuffer();
      if (!buf.byteLength) return stErr('沒有錄音內容');
      if (buf.byteLength > ST_MAX_AUDIO) return stErr('錄音太大（上限 20 MB）', 413);
      const id = stRid(10), key = stRid(24);
      const meta = {
        title: stStr(stDec(req, 'X-Title'), 40) || '阿公講的故事',
        emoji: stStr(stDec(req, 'X-Emoji'), 8) || '📖',
        kid: stStr(stDec(req, 'X-Kid'), 20) || '乖孫',
        dur: Math.min(7200, Math.max(0, parseFloat(req.headers.get('X-Dur')) || 0)),
        ai: req.headers.get('X-Ai') === '1',
        mime: stStr((req.headers.get('Content-Type') || 'audio/mp4').split(';')[0], 40),
        size: buf.byteLength,
        kh: await stSha(key),
        t: Date.now()
      };
      await kv.put('sa:' + id, buf);
      await kv.put('sm:' + id, JSON.stringify(meta));
      return stJson({ id, key, url: url.origin + '/story/s/' + id });
    }

    // ── 刪除 ──
    if (seg.length === 1 && m === 'DELETE') {
      const id = seg[0];
      if (!/^[a-z0-9]{6,16}$/.test(id)) return stErr('bad id');
      const raw = await kv.get('sm:' + id);
      if (!raw) return stJson({ ok: true });                       // 已經不在了
      const meta = JSON.parse(raw);
      const k = req.headers.get('X-Key') || '';
      if (!k || (await stSha(k)) !== meta.kh) return stErr('不能刪除別人的故事', 403);
      await kv.delete('sa:' + id);
      await kv.delete('sm:' + id);
      return stJson({ ok: true });
    }

    if (seg.length !== 2 || !(m === 'GET' || m === 'HEAD')) return stErr('not found', 404);
    const id = seg[1];
    if (!/^[a-z0-9]{6,16}$/.test(id)) return stErr('bad id', 400);

    // ── 音檔（支援 Range） ──
    if (seg[0] === 'a') {
      const raw = await kv.get('sm:' + id);
      const buf = raw ? await kv.get('sa:' + id, { type: 'arrayBuffer' }) : null;
      if (!buf) return stErr('故事不見了', 404);
      const meta = JSON.parse(raw);
      const total = buf.byteLength;
      const base = Object.assign({}, ST_CORS, {
        'Content-Type': meta.mime || 'audio/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=31536000, immutable'
      });
      const range = req.headers.get('Range');
      const rm = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (rm && (rm[1] || rm[2])) {
        let start, end;
        if (rm[1] === '') { start = Math.max(0, total - parseInt(rm[2], 10)); end = total - 1; }   // bytes=-500
        else { start = parseInt(rm[1], 10); end = rm[2] ? Math.min(parseInt(rm[2], 10), total - 1) : total - 1; }
        if (start >= total || start > end) {
          return new Response(null, { status: 416, headers: Object.assign(base, { 'Content-Range': 'bytes */' + total }) });
        }
        return new Response(m === 'HEAD' ? null : buf.slice(start, end + 1), {
          status: 206,
          headers: Object.assign(base, { 'Content-Range': 'bytes ' + start + '-' + end + '/' + total, 'Content-Length': String(end - start + 1) })
        });
      }
      return new Response(m === 'HEAD' ? null : buf, { headers: Object.assign(base, { 'Content-Length': String(total) }) });
    }

    // ── 收聽頁 ──
    if (seg[0] === 's') {
      const app = env.STORY_APP || 'https://kftseng2oo1.github.io/grandpa/';
      const raw = await kv.get('sm:' + id);
      if (!raw) {
        return new Response(stPage({ gone: true, app }), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
      const meta = JSON.parse(raw);
      return new Response(stPage({ meta, app, audio: url.origin + '/story/a/' + id, self: url.origin + '/story/s/' + id }), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' }
      });
    }
    return stErr('not found', 404);
  } catch (e) {
    return stErr(String(e && e.message || e), 500);
  }
}

function stPage(o) {
  const icon = o.app + 'icon-512.png';
  const head = (title, desc) =>
    '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta name="theme-color" content="#7a4a22"><title>' + title + '</title>' +
    '<meta property="og:type" content="website"><meta property="og:site_name" content="阿公說故事">' +
    '<meta property="og:title" content="' + title + '"><meta property="og:description" content="' + desc + '">' +
    '<meta property="og:image" content="' + stH(icon) + '"><meta name="twitter:card" content="summary">' +
    (o.self ? '<meta property="og:url" content="' + stH(o.self) + '">' : '') +
    '<link rel="apple-touch-icon" href="' + stH(o.app + 'apple-touch-icon.png') + '">' +
    '<style>' +
    ':root{--bg:#fbf4e6;--paper:#fffaf0;--ink:#3b2614;--soft:#7a5a3c;--brown:#7a4a22;--orange:#e07a2e;--line:#ead9bd}' +
    '*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}' +
    'html,body{margin:0;min-height:100%;background:var(--bg);color:var(--ink);font-family:-apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif}' +
    '.top{background:var(--brown);color:#fff;text-align:center;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;font-size:20px;font-weight:700;letter-spacing:2px}' +
    '.wrap{max-width:460px;margin:0 auto;padding:26px 18px calc(30px + env(safe-area-inset-bottom));text-align:center}' +
    '.av{width:150px;height:150px;border-radius:36px;box-shadow:0 8px 24px rgba(122,74,34,.25);display:block;margin:0 auto}' +
    '.em{font-size:44px;margin-top:16px;line-height:1}' +
    'h1{font-size:32px;margin:8px 0 4px;letter-spacing:1px}' +
    '.sub{font-size:20px;color:var(--soft)}' +
    '.ai{display:inline-block;margin-top:10px;background:#3f6f8f;color:#fff;font-size:15px;font-weight:700;border-radius:10px;padding:3px 10px}' +
    '.play{width:132px;height:132px;border-radius:50%;border:none;background:var(--orange);color:#fff;font-size:56px;margin:28px auto 8px;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 22px rgba(224,122,46,.45);cursor:pointer}' +
    '.play.on{background:#3f8f5a;box-shadow:0 8px 22px rgba(63,143,90,.4)}' +
    '.hint{font-size:18px;color:var(--soft);min-height:26px}' +
    '.bar{height:12px;background:var(--line);border-radius:999px;margin:22px 4px 8px;overflow:hidden;cursor:pointer}' +
    '.bar i{display:block;height:100%;width:0;background:var(--orange);border-radius:999px}' +
    '.tm{display:flex;justify-content:space-between;font-size:16px;color:var(--soft);font-variant-numeric:tabular-nums;padding:0 4px}' +
    '.card{background:var(--paper);border:2px solid var(--line);border-radius:26px;padding:24px 18px 20px;box-shadow:0 4px 14px rgba(90,55,20,.1)}' +
    '.foot{margin-top:26px;font-size:15px;color:var(--soft)}.foot a{color:var(--brown)}' +
    '</style></head><body><div class="top">📖 阿公說故事</div><div class="wrap">';
  if (o.gone) {
    return head('故事不見了', '這個故事已經被刪除了') +
      '<img class="av" src="' + stH(icon) + '" alt=""><h1 style="font-size:26px;margin-top:22px">這個故事不見了</h1>' +
      '<div class="sub">可能被阿公刪掉了，請阿公再傳一次 ❤️</div></div></body></html>';
  }
  const m = o.meta;
  const title = stH(m.emoji + ' ' + m.title);
  const desc = stH('阿公講故事給' + m.kid + '聽' + (m.ai ? '（AI 阿公聲音）' : '') + '，點開來聽 🎧' + (m.dur ? ' ' + stMmss(m.dur) : ''));
  return head(title, desc) +
    '<div class="card">' +
    '<img class="av" src="' + stH(icon) + '" alt="">' +
    '<div class="em">' + stH(m.emoji) + '</div>' +
    '<h1>' + stH(m.title) + '</h1>' +
    '<div class="sub">阿公講給 ' + stH(m.kid) + ' 聽 ❤️</div>' +
    (m.ai ? '<div class="ai">🤖 AI 阿公聲音</div>' : '') +
    '<button class="play" id="pb" aria-label="播放">▶</button>' +
    '<div class="hint" id="ht">按一下開始聽</div>' +
    '<div class="bar" id="bar"><i id="fill"></i></div>' +
    '<div class="tm"><span id="cur">0:00</span><span id="tot">' + (m.dur ? stMmss(m.dur) : '') + '</span></div>' +
    '</div>' +
    '<div class="foot">' + new Date(m.t + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '/') + ' 錄的・<a href="' + stH(o.app) + '">阿公說故事</a></div>' +
    '<audio id="au" preload="metadata" playsinline src="' + stH(o.audio) + '"></audio>' +
    '</div><script>(function(){' +
    'var au=document.getElementById("au"),pb=document.getElementById("pb"),ht=document.getElementById("ht"),fill=document.getElementById("fill"),cur=document.getElementById("cur"),tot=document.getElementById("tot"),bar=document.getElementById("bar");' +
    'function f(s){s=Math.max(0,Math.round(s||0));var r=s%60;return Math.floor(s/60)+":"+(r<10?"0":"")+r;}' +
    'function ui(on){pb.className=on?"play on":"play";pb.innerHTML=on?"❚❚":"▶";}' +
    'pb.addEventListener("click",function(){if(au.paused){var p=au.play();ht.textContent="阿公開始講囉…";if(p&&p["catch"])p["catch"](function(){ht.textContent="播放失敗，再按一次";ui(false);});}else{au.pause();}});' +
    'au.addEventListener("play",function(){ui(true);ht.textContent="🎧 正在聽";});' +
    'au.addEventListener("pause",function(){ui(false);if(!au.ended)ht.textContent="暫停中，再按一下繼續";});' +
    'au.addEventListener("ended",function(){ui(false);ht.textContent="講完了！要再聽一次嗎？";fill.style.width="100%";});' +
    'au.addEventListener("waiting",function(){ht.textContent="載入中…";});' +
    'au.addEventListener("playing",function(){ht.textContent="🎧 正在聽";});' +
    'au.addEventListener("loadedmetadata",function(){if(isFinite(au.duration)&&au.duration>0)tot.textContent=f(au.duration);});' +
    'au.addEventListener("timeupdate",function(){cur.textContent=f(au.currentTime);if(isFinite(au.duration)&&au.duration>0)fill.style.width=(au.currentTime/au.duration*100)+"%";});' +
    'au.addEventListener("error",function(){ht.textContent="這支手機播不了這個錄音 😅";});' +
    'bar.addEventListener("click",function(e){if(!isFinite(au.duration)||!au.duration)return;var r=bar.getBoundingClientRect();au.currentTime=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*au.duration;});' +
    '})();</script></body></html>';
}
