
// Cloudflare Worker — arcar.kftseng2oo1.workers.dev v23

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
};

function ok(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' })
  });
}

function err(msg, status) {
  return new Response(JSON.stringify({ error: msg }), {
    status: status || 400,
    headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' })
  });
}

/* SendGrid from 格式解析：「名稱 <email>」→ { name, email } */
function parseSgFrom(fromStr) {
  var m = fromStr.match(/^(.+?)\s*<(.+?)>$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { email: fromStr.trim() };
}

/* 統一 Email 發送（SendGrid → Gmail Proxy → Resend） */
async function sendEmail(env, toArr, subject, message, html) {
  if (!Array.isArray(toArr)) toArr = [toArr];
  if (env.SENDGRID_API_KEY) {
    try {
      var sgFrom = env.SENDGRID_FROM || '任務管理中心 <kftseng.t12@o365.fcu.edu.tw>';
      var sgRes = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.SENDGRID_API_KEY },
        body: JSON.stringify({
          personalizations: [{ to: toArr.map(function(e){ return { email: e }; }) }],
          from: parseSgFrom(sgFrom),
          subject: subject,
          content: [
            { type: 'text/plain', value: message },
            { type: 'text/html',  value: html }
          ]
        })
      });
      if (sgRes.status === 202 || sgRes.ok) return { ok: true, provider: 'sendgrid' };
    } catch(e) { /* fall through */ }
  }
  if (env.GMAIL_PROXY_URL) {
    try {
      await fetch(env.GMAIL_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: toArr, subject: subject, message: message, html: html }),
        redirect: 'follow'
      });
      return { ok: true, provider: 'gmail' };
    } catch(e) { /* fall through */ }
  }
  if (env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.RESEND_API_KEY },
      body: JSON.stringify({ from: 'onboarding@resend.dev', to: toArr, subject: subject, html: html })
    });
    return { ok: true, provider: 'resend' };
  }
  return { ok: false, error: 'No email provider' };
}

export default {
  async fetch(request, env, ctx) {
    try {
      var path = new URL(request.url).pathname;
      // ── 齊聲祝福 雲端共錄（v15 新增，v16 加祝福卡分享頁）── 放在全域 OPTIONS 之前：需要額外允許 X-Key / X-Token / X-Name / X-Note / X-Dur / X-Tts
      if (path === '/blessing' || path.startsWith('/blessing/')) {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: BLESSING_CORS });
        return withBlessingCors(await handleBlessing(request, env, path.slice(9)));
      }
      // ── 阿公說故事 AI 聲音（v23 新增）── 放在全域 OPTIONS 之前：自帶 CORS 與來源檢查
      if (path === '/voice' || path.startsWith('/voice/')) return handleVoice(request, env);
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
      }

      // ── 報平安（safe-checkin）──
      if (path.startsWith('/safe')) return handleSafe(request, env, ctx);
      // ── 防詐查證（v20 新增）──
      if (path === '/scam') return handleScam(request, env);
      if (path === '/line-notify')     return handleLineNotify(request, env);
      if (path === '/send-line')       return handleSendLine(request, env);
      if (path === '/send-email')      return handleSendEmail(request, env);
      if (path === '/send-email-to')   return handleSendEmailTo(request, env);
      if (path === '/line-profile')    return handleLineProfile(request, env);
      if (path === '/line-webhook')    return handleLineWebhook(request, env);
      if (path === '/test-webhook')    return handleTestWebhook(request, env);
      if (path === '/schedule-notify') return handleScheduleNotify(request, env);
      if (path === '/sync-medicine')   return handleSyncMedicine(request, env);
      if (path === '/debug-kv')        return handleDebugKV(request, env);
      if (path === '/test-cron')       return handleTestCron(request, env);
      if (path === '/sync-tasks')      return handleSyncTasks(request, env);
      if (path === '/get-tasks')       return handleGetTasks(request, env);
      if (path === '/scrape-analyze') return handleScrapeAnalyze(request, env);
      // ── 實價登錄（v9 新增）──
      if (path.startsWith('/real-estate')) return handleRealEstate(request, env);
      // ── Twinklehub 政府 API 代理（v12 新增）──
      if (path === '/gov-proxy') return handleGovProxy(request, env);
      // ── 飛日韓 特價機票（v13 新增）──
      if (path.startsWith('/flights')) {
        var fd = await mountFlightDeals(request, env, '/flights');
        return fd || err('Not Found', 404);
      }
      // ── 早安卡片 有聲影片旁白 TTS（v14 新增）──
      if (path === '/tts') return handleTTS(request, env);
      if (path === '/v1/messages' || path === '/') {
        if (request.method === 'GET') return ok({ status: 'ok', worker: 'arcar', version: '23.0' });
        return handleAnthropic(request, env);
      }
      return err('Not Found', 404);
    } catch(e) {
      return new Response(JSON.stringify({ error: 'Worker exception: ' + e.message }), {
        status: 500,
        headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' })
      });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([
      safeCron(env),
      checkNursingNotifications(env),
      checkMedicineNotifications(env),
      checkTaskNotifications(env),
      runFlightAlertsGated(env),
    ]));
  }
};

// ── LINE Notify ───────────────────────────────────────────
async function handleLineNotify(request, env) {
  if (request.method !== 'POST') return err('Method Not Allowed', 405);
  var body;
  try { body = await request.json(); } catch(e) { return err('Invalid JSON'); }
  var token = body.token, userId = body.userId, message = body.message;
  if (!token || !userId || !message) return err('Missing params');
  var res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: message }] })
  });
  var data = await res.json().catch(function() { return {}; });
  return ok(data, res.status);
}

// ── LINE Bot Webhook ──────────────────────────────────────
async function handleLineWebhook(request, env) {
  if (request.method === 'GET') return new Response('OK', { status: 200 });
  if (request.method !== 'POST') return new Response('OK', { status: 200 });
  var body;
  try { body = await request.json(); } catch(e) { return new Response('OK', { status: 200 }); }
  var token = env.LINE_CHANNEL_TOKEN;
  if (!token) return new Response('OK', { status: 200 });
  var events = body.events || [];
  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    if (await safeLineEvent(event, env)) continue;   // 報平安指令優先
    var userId = event.source && event.source.userId;
    if (!userId) continue;
    var msg = null;
    if (event.type === 'follow') {
      msg = '👋 歡迎加入！\n\n您的 LINE User ID 是：\n\n' + userId + '\n\n📋 請複製上方 ID，貼到 App 設定頁的「LINE User ID」欄位，即可接收通知 🍼💊';
    } else if (event.type === 'message' && event.message && event.message.type === 'text') {
      msg = '🔍 您的 LINE User ID 是：\n\n' + userId + '\n\n📋 請複製上方 ID 貼到 App 設定頁\n（傳送任何訊息都可以查詢 ID）';
    }
    if (!msg) continue;
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: msg }] })
    });
  }
  return new Response('OK', { status: 200 });
}

// ── Test Webhook ──────────────────────────────────────────
async function handleTestWebhook(request, env) {
  var token = env.LINE_CHANNEL_TOKEN;
  if (!token) return err('LINE_CHANNEL_TOKEN not set', 500);
  var url = new URL(request.url);
  var userId = url.searchParams.get('userId') || 'U1e68f3c5a36277ff789c0f4458612d98';
  var res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: '🔍 測試成功！\nUser ID：' + userId }] })
  });
  var data = await res.json().catch(function() { return {}; });
  return ok({ status: res.status, ok: res.ok, lineResponse: data });
}

// ── Send Line ─────────────────────────────────────────────
async function handleSendLine(request, env) {
  if (request.method !== 'POST') return err('Method Not Allowed', 405);
  var body;
  try { body = await request.json(); } catch(e) { return err('Invalid JSON'); }
  var token = body.token || env.LINE_CHANNEL_TOKEN;
  var userId = body.userId, message = body.message;
  if (!token || !userId || !message) return err('Missing params');
  var res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: message }] })
  });
  var data = await res.json().catch(function() { return {}; });
  return ok(data, res.status);
}

// ── Send Email ────────────────────────────────────────────
async function handleSendEmail(request, env) {
  if (request.method !== 'POST') return err('Method Not Allowed', 405);
  var body;
  try { body = await request.json(); } catch(e) { return err('Invalid JSON'); }
  var to = body.to, subject = body.subject, message = body.message;
  if (!to && env.NOTIFY_EMAIL_TO) to = env.NOTIFY_EMAIL_TO;
  if (!to || !subject || !message) return err('Missing params');
  var toArr = Array.isArray(to) ? to : [to];
  var html = '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#fdf6ee;border-radius:16px;"><div style="text-align:center;font-size:2.5rem;">🍼</div><h2 style="text-align:center;color:#7a4f3d;">' + subject + '</h2><div style="background:white;border-radius:12px;padding:16px;white-space:pre-line;line-height:1.7;">' + message + '</div><p style="text-align:center;font-size:0.75rem;color:#9c7060;margin-top:16px;">智慧藥管家</p></div>';
  var result = await sendEmail(env, toArr, subject, message, html);
  return ok(result);
}

// ── Send Email To（緊急聯絡人）───────────────────────────
async function handleSendEmailTo(request, env) {
  if (request.method !== 'POST') return err('Method Not Allowed', 405);
  var body;
  try { body = await request.json(); } catch(e) { return err('Invalid JSON'); }
  var to = body.to, subject = body.subject, message = body.message;
  if (!to || !subject || !message) return err('Missing params');
  var html = '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f0fdfa;border-radius:16px;"><div style="text-align:center;font-size:2.5rem;">💊</div><h2 style="text-align:center;color:#0f766e;">' + subject + '</h2><div style="background:white;border-radius:12px;padding:16px;white-space:pre-line;line-height:1.7;">' + message + '</div><p style="text-align:center;font-size:0.75rem;color:#6b7280;margin-top:16px;">智慧藥管家</p></div>';
  var result = await sendEmail(env, [to], subject, message, html);
  return ok(result);
}

// ── Line Profile ──────────────────────────────────────────
async function handleLineProfile(request, env) {
  if (request.method !== 'POST') return err('Method Not Allowed', 405);
  var body;
  try { body = await request.json(); } catch(e) { return err('Invalid JSON'); }
  var token = body.token, userId = body.userId;
  if (!token || !userId) return err('Missing params');
  var res = await fetch('https://api.line.me/v2/bot/profile/' + userId, {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  var data = await res.json().catch(function() { return {}; });
  return ok(data, res.status);
}

// ── Schedule Notify（餵奶排程）──────────────────────────
async function handleScheduleNotify(request, env) {
  if (!env.NURSING_KV) return err('KV not bound', 500);
  if (request.method === 'GET') {
    var list = await env.NURSING_KV.list({ prefix: 'notif:' });
    var items = [];
    for (var i = 0; i < list.keys.length; i++) {
      var val = await env.NURSING_KV.get(list.keys[i].name, { type: 'text' });
      items.push({ key: list.keys[i].name, data: val ? JSON.parse(val) : null });
    }
    return ok({ count: items.length, items: items });
  }
  if (request.method !== 'POST') return err('Method Not Allowed', 405);
  var body;
  try { body = await request.json(); } catch(e) { return err('Invalid JSON'); }
  var lineToken = body.lineToken, persons = body.persons, nextTs = body.nextTs;
  var notify30 = body.notify30, notifyOntime = body.notifyOntime;
  if (!nextTs) return err('Missing nextTs');
  if (!persons || !persons.length) return err('Missing persons');
  var oldList = await env.NURSING_KV.list({ prefix: 'notif:' });
  for (var i = 0; i < oldList.keys.length; i++) {
    await env.NURSING_KV.delete(oldList.keys[i].name);
  }
  var now = Date.now();
  if (notify30 !== false) {
    var ts30 = nextTs - 30 * 60 * 1000;
    if (ts30 > now) {
      await env.NURSING_KV.put('notif:30min:' + ts30, JSON.stringify({
        type: '30min', nextTs: nextTs, ts30: ts30, lineToken: lineToken, persons: persons
      }), { expirationTtl: 7200 });
    }
  }
  if (notifyOntime !== false && nextTs > now) {
    await env.NURSING_KV.put('notif:ontime:' + nextTs, JSON.stringify({
      type: 'ontime', nextTs: nextTs, lineToken: lineToken, persons: persons
    }), { expirationTtl: 7200 });
  }
  return ok({ success: true, nextTs: nextTs });
}

// ── Sync Medicine ─────────────────────────────────────────
async function handleSyncMedicine(request, env) {
  if (request.method !== 'POST') return err('Method Not Allowed', 405);
  if (!env.NURSING_KV) return err('KV not bound', 500);
  var body;
  try { body = await request.json(); } catch(e) { return err('Invalid JSON'); }
  if (!body.userId) return err('Missing userId');
  var data = Object.assign({}, body, { updatedAt: Date.now() });
  await env.NURSING_KV.put('med:user:' + body.userId, JSON.stringify(data), { expirationTtl: 259200 });
  return ok({ success: true });
}

// ── Debug KV ─────────────────────────────────────────────
async function handleDebugKV(request, env) {
  if (!env.NURSING_KV) return err('KV not bound', 500);
  var list = await env.NURSING_KV.list({ prefix: 'notif:' });
  var items = [];
  for (var i = 0; i < list.keys.length; i++) {
    var val = await env.NURSING_KV.get(list.keys[i].name, { type: 'text' });
    items.push({ key: list.keys[i].name, data: val ? JSON.parse(val) : null });
  }
  return ok({
    now: Date.now(),
    nowTW: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
    count: items.length,
    items: items
  });
}

// ── Test Cron ─────────────────────────────────────────────
async function handleTestCron(request, env) {
  await Promise.all([
    checkNursingNotifications(env),
    checkMedicineNotifications(env),
    checkTaskNotifications(env),
  ]);
  return ok({ success: true, message: 'Cron executed' });
}

// ── Sync Tasks ────────────────────────────────────────────
async function handleSyncTasks(request, env) {
  if (request.method !== 'POST') return err('Method Not Allowed', 405);
  if (!env.TASK_KV) return err('TASK_KV not bound', 500);
  var body;
  try { body = await request.json(); } catch(e) { return err('Invalid JSON'); }
  if (!body.tasks) return err('Missing tasks');
  await env.TASK_KV.put('all_tasks', JSON.stringify(body.tasks));
  return ok({ ok: true, count: body.tasks.length });
}

// ── Get Tasks ─────────────────────────────────────────────
async function handleGetTasks(request, env) {
  if (request.method !== 'GET') return err('Method Not Allowed', 405);
  if (!env.TASK_KV) return err('TASK_KV not bound', 500);
  var raw = await env.TASK_KV.get('all_tasks');
  return new Response(raw || '[]', {
    headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' })
  });
}

// ── Cron：餵奶通知 ────────────────────────────────────────
async function checkNursingNotifications(env) {
  if (!env.NURSING_KV) return;
  var now = Date.now();
  var list = await env.NURSING_KV.list({ prefix: 'notif:' });
  for (var i = 0; i < list.keys.length; i++) {
    var raw = await env.NURSING_KV.get(list.keys[i].name, { type: 'text' });
    if (!raw) continue;
    var item;
    try { item = JSON.parse(raw); } catch(e) { continue; }
    var triggerTs = item.type === '30min' ? item.ts30 : item.nextTs;
    if (now < triggerTs) continue;
    var nextTime = new Date(item.nextTs).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Taipei' });
    var msg = item.type === '30min'
      ? '🍼 餵奶提醒\n距離下次餵奶還有 30 分鐘\n預定時間：' + nextTime
      : '🍼 餵奶時間到了！\n現在是 ' + nextTime + '，寶寶肚子餓囉 🌸';
    var subject = item.type === '30min' ? '🍼 餵奶提醒（30分鐘前）' : '🍼 餵奶時間到了！';
    var persons = item.persons || [];
    for (var j = 0; j < persons.length; j++) {
      var p = persons[j];
      if (item.lineToken && p.lineId) {
        await fetch('https://api.line.me/v2/bot/message/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + item.lineToken },
          body: JSON.stringify({ to: p.lineId, messages: [{ type: 'text', text: msg }] })
        });
      }
      if (p.email) {
        var html = '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#fdf6ee;border-radius:16px;"><div style="text-align:center;font-size:2.5rem;">🍼</div><h2 style="text-align:center;color:#7a4f3d;">' + subject + '</h2><div style="background:white;border-radius:12px;padding:16px;white-space:pre-line;line-height:1.7;">' + msg + '</div><p style="text-align:center;font-size:0.75rem;color:#9c7060;margin-top:16px;">智慧藥管家</p></div>';
        await sendEmail(env, [p.email], subject, msg, html);
      }
    }
    await env.NURSING_KV.delete(list.keys[i].name);
  }
}

// ── Cron：藥品通知 ────────────────────────────────────────
async function checkMedicineNotifications(env) {
  if (!env.NURSING_KV) return;
  var nowTW = new Date(Date.now() + 8 * 60 * 60 * 1000);
  var hour = nowTW.getUTCHours();
  var today = nowTW.toISOString().slice(0, 10);
  var currentSec = hour >= 18 ? '晚上' : hour >= 12 ? '中午' : hour >= 8 ? '早上' : null;
  var list = await env.NURSING_KV.list({ prefix: 'med:user:' });
  for (var i = 0; i < list.keys.length; i++) {
    var raw = await env.NURSING_KV.get(list.keys[i].name, { type: 'text' });
    if (!raw) continue;
    var data;
    try { data = JSON.parse(raw); } catch(e) { continue; }
    if (data.today !== today) continue;
    var lineId = data.lineId;
    var email = data.email;
    var token = env.LINE_CHANNEL_TOKEN;
    if (!lineId && !email) continue;
    if (currentSec) {
      var notifKey = 'med:notif:' + data.userId + ':' + today + ':' + currentSec;
      var alreadySent = await env.NURSING_KV.get(notifKey, { type: 'text' });
      if (!alreadySent) {
        var meds = data.meds || [];
        var todayDone = data.todayDone || [];
        var pending = [];
        for (var j = 0; j < meds.length; j++) {
          var m = meds[j];
          var slots = getMedSlots(m.freq || 'QD', m.timing || '飯後');
          for (var k = 0; k < slots.length; k++) {
            if (slots[k].sec !== currentSec) continue;
            var doneKey = today + '_' + m.id + '_' + slots[k].sec;
            if (todayDone.indexOf(doneKey) === -1) pending.push(m.name + '（' + slots[k].lbl + '）');
          }
        }
        if (pending.length) {
          var secLabel = { '早上': '早上 8 點', '中午': '中午 12 點', '晚上': '晚上 6 點' }[currentSec];
          var medMsg = '💊 服藥提醒\n' + secLabel + ' 的藥品尚未服用：\n\n'
            + pending.map(function(p, idx) { return (idx+1) + '. ' + p; }).join('\n')
            + '\n\n請記得按時服藥！';
          await sendMedNotify(env, token, lineId, email, '💊 ' + secLabel + '服藥提醒', medMsg);
          await env.NURSING_KV.put(notifKey, '1', { expirationTtl: 86400 });
        }
      }
    }
    if (hour === 8) {
      var meds2 = data.meds || [];
      for (var mi = 0; mi < meds2.length; mi++) {
        var med = meds2[mi];
        var dl = Math.floor((med.stockQty || 0) / (med.dailyDose || 1));
        var stockKey = 'med:stock:' + data.userId + ':' + med.id + ':' + today;
        var stockSent = await env.NURSING_KV.get(stockKey, { type: 'text' });
        if (stockSent) continue;
        var stockMsg = null, stockSubject = null;
        if (dl < 5) {
          stockSubject = '🔴 庫存緊急：' + med.name;
          stockMsg = '🔴【庫存緊急警告】\n藥品：' + med.name + '\n⚠️ 庫存僅剩 ' + dl + ' 天！\n請盡快補充。';
        } else if (dl < 10) {
          stockSubject = '🟡 庫存偏低：' + med.name;
          stockMsg = '🟡【庫存偏低提醒】\n藥品：' + med.name + '\n📦 庫存剩 ' + dl + ' 天，請注意補充。';
        }
        if (stockMsg) {
          await sendMedNotify(env, token, lineId, email, stockSubject, stockMsg);
          await env.NURSING_KV.put(stockKey, '1', { expirationTtl: 86400 });
        }
      }
    }
  }
}

// ── 統一發送藥品通知 ──────────────────────────────────────
async function sendMedNotify(env, token, lineId, email, subject, msg) {
  if (token && lineId) {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ to: lineId, messages: [{ type: 'text', text: msg }] })
    });
  }
  if (email) {
    var html = '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f0fdfa;border-radius:16px;"><div style="text-align:center;font-size:2.5rem;">💊</div><h2 style="text-align:center;color:#0f766e;">' + subject + '</h2><div style="background:white;border-radius:12px;padding:16px;white-space:pre-line;line-height:1.8;">' + msg + '</div><p style="text-align:center;font-size:0.75rem;color:#6b7280;margin-top:16px;">智慧藥管家</p></div>';
    await sendEmail(env, [email], subject, msg, html);
  }
}

function getMedSlots(freq, timing) {
  if (freq === 'TID') return [{ sec:'早上', lbl:timing }, { sec:'中午', lbl:timing }, { sec:'晚上', lbl:timing }];
  if (freq === 'QID') return [{ sec:'早上', lbl:timing }, { sec:'中午', lbl:timing }, { sec:'晚上', lbl:timing }, { sec:'晚上', lbl:'睡前' }];
  if (freq === 'BID') return [{ sec:'早上', lbl:timing }, { sec:'晚上', lbl:timing }];
  var map = { 飯前:'早上', 飯中:'中午', 飯後:'晚上', 早上:'早上', 中午:'中午', 晚上:'晚上', 睡前:'晚上', 任意:'早上', 空腹:'早上' };
  return [{ sec: map[timing] || '早上', lbl: timing }];
}

// ── Cron：任務到期通知 ────────────────────────────────────
async function checkTaskNotifications(env) {
  if (!env.TASK_KV) return;
  var raw = await env.TASK_KV.get('all_tasks');
  if (!raw) return;
  var tasks;
  try { tasks = JSON.parse(raw); } catch(e) { return; }

  var twNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
  var todayDate = twNow.getUTCDate();
  var lastDay = new Date(twNow.getUTCFullYear(), twNow.getUTCMonth() + 1, 0).getUTCDate();
  var currentMonth = twNow.getUTCFullYear() + '-' + String(twNow.getUTCMonth() + 1).padStart(2, '0');
  var catMap = { finance:'財務', life:'生活', digital:'數位', other:'其他', temp:'臨時' };
  var token = env.LINE_CHANNEL_TOKEN;

  for (var i = 0; i < tasks.length; i++) {
    var task = tasks[i];
    if (task.completedMonth === currentMonth) continue;
    if (!task.notify) continue;

    var taskDay = task.day === 'last' ? lastDay : parseInt(task.day);
    if (taskDay !== todayDate) continue;

    // 全域通知對象（App 同步時帶入 _lineUserId / _email）
    var lineUserId = task._lineUserId || '';
    var email = task._email || '';
    if (!lineUserId && !email) continue;

    var sentKey = 'task:sent:' + task.id + ':' + currentMonth + '-' + todayDate;
    var alreadySent = await env.TASK_KV.get(sentKey);
    if (alreadySent) continue;

    var catLabel = catMap[task.category] || '';
    var msg = '📋 任務提醒：【' + task.name + '】'
      + '\n類別：' + catLabel
      + '\n今天（' + todayDate + ' 號）是截止日，記得完成！';
    var subject = '📋 任務提醒：' + task.name;
    var html = '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f7f6f3;border-radius:16px;">'
      + '<div style="text-align:center;font-size:2.5rem;">📋</div>'
      + '<h2 style="text-align:center;color:#2c3e50;">' + subject + '</h2>'
      + '<div style="background:white;border-radius:12px;padding:16px;white-space:pre-line;line-height:1.8;">' + msg + '</div>'
      + '<p style="text-align:center;font-size:0.75rem;color:#888;margin-top:16px;">任務管理中心</p></div>';

    if (lineUserId && token) {
      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ to: lineUserId, messages: [{ type: 'text', text: msg }] })
      });
    }
    if (email) {
      await sendEmail(env, [email], subject, msg, html);
    }
    await env.TASK_KV.put(sentKey, '1', { expirationTtl: 90000 });
  }
}

// ── Anthropic API ─────────────────────────────────────────
async function handleAnthropic(request, env) {
  if (request.method !== 'POST') return err('Method Not Allowed', 405);
  if (!env.ANTHROPIC_API_KEY) return err('ANTHROPIC_API_KEY not set', 500);
  var body;
  try { body = await request.json(); } catch(e) { return err('Failed to read body'); }
  if (body.model) {
    body.model = body.model
      .replace('claude-opus-4.5', 'claude-opus-4-5')
      .replace('claude-sonnet-4.5', 'claude-sonnet-4-5')
      .replace('claude-haiku-4.5', 'claude-haiku-4-5');
  }
  if (!body.model) body.model = 'claude-sonnet-4-20250514';
  var res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: Object.assign({}, CORS, { 'Content-Type': 'application/json' })
  });
}
// ════════════════════════════════════════════════════════════════
// ★ NEW v8.0 — Scrape Analyze
// POST /scrape-analyze
// Body: { "targetUrl": "https://..." }
//    or { "html": "...", "sourceUrl": "..." }
// Response: SSE stream  (event: meta | delta | result | done | error)
// ════════════════════════════════════════════════════════════════
async function handleScrapeAnalyze(request, env) {
  if (request.method !== 'POST') return err('POST only', 405);
  if (!env.ANTHROPIC_API_KEY) return err('ANTHROPIC_API_KEY not set', 500);

  var body;
  try { body = await request.json(); } catch(e) { return err('Invalid JSON body'); }

  // ── Step 1: 取得 HTML ──────────────────────────────────────
  var rawHtml = '', sourceUrl = body.sourceUrl || '（直接貼上）';
  var fetchError = null, fetchStatus = null;

  if (body.html) {
    rawHtml = body.html;
  } else if (body.targetUrl) {
    sourceUrl = body.targetUrl;
    try {
      var resp = await fetch(body.targetUrl, {
        headers: {
          'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
          'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cache-Control':   'no-cache',
        },
        redirect: 'follow',
        signal:   AbortSignal.timeout(15000),
      });
      fetchStatus = resp.status;
      rawHtml     = await resp.text();
    } catch(e) {
      fetchError = e.message;
    }
  } else {
    return err('需要 targetUrl 或 html 欄位');
  }

  // ── Step 2: HTML 清理 ──────────────────────────────────────
  var cleaned       = scrapeCleanHtml(rawHtml);
  var tokenEstimate = Math.round(cleaned.length / 4);
  var isSpa         = scrapeDetectSpa(rawHtml, cleaned);

  // ── Step 3: 呼叫 Claude（Streaming）───────────────────────
  var systemPrompt = '你是一位資深爬蟲工程師。用戶提供了一個網頁的 HTML 原始碼。\n'
    + '請分析其結構並輸出**純 JSON**（不含任何 markdown 符號、不含 ```json、不含前綴說明）。\n\n'
    + '回傳格式（嚴格 JSON）：\n'
    + '{\n'
    + '  "snapshot": {\n'
    + '    "render_type": "靜態HTML / 動態SPA / 混合",\n'
    + '    "auth_required": "無需 / 需要登入 / 付費牆",\n'
    + '    "anti_scraping": "無 / CloudFlare保護 / reCAPTCHA / IP限制 / 其他",\n'
    + '    "main_data_format": "HTML表格 / JSON API / 文章列表 / 商品列表 / 其他",\n'
    + '    "recommended_tool": "requests / Puppeteer / 兩者皆可",\n'
    + '    "pagination": "無 / URL參數 / 無限捲動 / 按鈕翻頁",\n'
    + '    "data_selectors": ["最重要的3個CSS selector或XPath"]\n'
    + '  },\n'
    + '  "analysis": "（繁體中文，400字以內）頁面類型、主要資料區塊、API endpoint提示、注意事項",\n'
    + '  "python_code": "完整可執行 Python，\\n換行，含pip install/import/UA/爬蟲邏輯/存CSV",\n'
    + '  "puppeteer_code": "完整可執行 Node.js Puppeteer，\\n換行，含npm install/完整邏輯/存JSON",\n'
    + '  "strategy_note": "5點：1.何時用requests 2.何時用Puppeteer 3.robots.txt 4.速率限制 5.法律道德"\n'
    + '}';

  var userMsg = '目標網址：' + sourceUrl + '\n'
    + '抓取狀態：' + (fetchError ? '失敗（' + fetchError + '）' : (fetchStatus ? 'HTTP ' + fetchStatus : '前端直接提供')) + '\n'
    + 'SPA偵測：' + isSpa.result + '（' + isSpa.reason + '）\n'
    + 'HTML清理後長度：' + cleaned.length + ' 字元（估計 ' + tokenEstimate + ' tokens）\n\n'
    + '清理後的 HTML 結構：\n' + cleaned;

  var claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-20250514',
      max_tokens: 4096,
      stream:     true,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userMsg }],
    }),
  });

  if (!claudeResp.ok) {
    var errText = await claudeResp.text();
    return err('Claude API 錯誤：' + errText, 502);
  }

  // ── Step 4: SSE stream 轉發 ────────────────────────────────
  var transform = new TransformStream();
  var writer    = transform.writable.getWriter();
  var encoder   = new TextEncoder();

  var meta = {
    sourceUrl: sourceUrl,
    fetchError: fetchError,
    fetchStatus: fetchStatus,
    isSpa: isSpa.result,
    spaReason: isSpa.reason,
    cleanedLength: cleaned.length,
    tokenEstimate: tokenEstimate,
  };
  writer.write(encoder.encode('event: meta\ndata: ' + JSON.stringify(meta) + '\n\n'));

  (async function() {
    try {
      var fullText = '';
      var reader   = claudeResp.body.getReader();
      var dec      = new TextDecoder();

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;

        var lines = dec.decode(chunk.value, { stream: true }).split('\n');
        for (var li = 0; li < lines.length; li++) {
          var line = lines[li];
          if (line.indexOf('data: ') !== 0) continue;
          var data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            var evt = JSON.parse(data);
            if (evt.type === 'content_block_delta' && evt.delta && evt.delta.text) {
              fullText += evt.delta.text;
              writer.write(encoder.encode('event: delta\ndata: ' + JSON.stringify({ text: evt.delta.text }) + '\n\n'));
            }
          } catch(e) { /* skip malformed */ }
        }
      }

      // 解析最終 JSON
      var parsed = null, parseError = null;
      try {
        var jsonStr = fullText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        parsed = JSON.parse(jsonStr);
      } catch(e) {
        parseError = e.message;
      }

      writer.write(encoder.encode('event: result\ndata: ' + JSON.stringify({ parsed: parsed, parseError: parseError, raw: fullText }) + '\n\n'));
      writer.write(encoder.encode('event: done\ndata: {}\n\n'));
    } catch(e) {
      writer.write(encoder.encode('event: error\ndata: ' + JSON.stringify({ error: e.message }) + '\n\n'));
    } finally {
      writer.close();
    }
  })();

  return new Response(transform.readable, {
    headers: Object.assign({}, CORS, {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache',
      'X-Accel-Buffering': 'no',
    }),
  });
}

// ── HTML 清理（scrape-analyze 用）────────────────────────────
function scrapeCleanHtml(html) {
  if (!html) return '';
  var c = html;
  c = c.replace(/<script[\s\S]*?<\/script>/gi, '');
  c = c.replace(/<style[\s\S]*?<\/style>/gi, '');
  c = c.replace(/<svg[\s\S]*?<\/svg>/gi, '<svg/>');
  c = c.replace(/data:[a-z/+]+;base64,[A-Za-z0-9+/=]{50,}/g, '[base64-data]');
  c = c.replace(/<!--[\s\S]*?-->/g, '');
  c = c.replace(/<(noscript|iframe|object|embed)[\s\S]*?<\/\1>/gi, '');
  c = c.replace(/\s+style="[^"]*"/g, '');
  c = c.replace(/\s{3,}/g, ' ').replace(/>\s+</g, '>\n<').trim();
  return c.substring(0, 12000);
}

// ── SPA 偵測（scrape-analyze 用）─────────────────────────────
function scrapeDetectSpa(rawHtml, cleanedHtml) {
  if (rawHtml.length < 2000) return { result: '可能是SPA', reason: '原始HTML過短（< 2000字）' };
  if (/<div\s+id=["']app["']\s*>/i.test(rawHtml) || /<div\s+id=["']root["']\s*>/i.test(rawHtml)) {
    var bt = cleanedHtml.replace(/<[^>]+>/g, '').trim();
    return bt.length < 500
      ? { result: '確認是SPA', reason: '有 #app/#root 且body文字極少' }
      : { result: '可能是SPA', reason: '有 #app/#root 標記' };
  }
  if (rawHtml.indexOf('__NEXT_DATA__') !== -1 || rawHtml.indexOf('__NUXT__') !== -1) {
    return { result: 'SSR框架', reason: 'Next.js/Nuxt（伺服器端渲染，fetch可用）' };
  }
  var bodyText = cleanedHtml.replace(/<[^>]+>/g, '').trim();
  if (bodyText.length > 2000) return { result: '靜態/SSR', reason: 'body文字充足（' + bodyText.length + '字）' };
  return { result: '不確定', reason: '需要進一步確認' };
}

// ══════════════════════════════════════════════════════════════
// ★ NEW v9.0 — 房市探針 · 實價登錄 Open Data Proxy
// GET /real-estate              → 搜尋成交紀錄（KV 快取）
// GET /real-estate/stats        → 市場均價統計
// GET /real-estate/district-stats → 行政區均價排行
// GET /real-estate/price-trend  → 均價走勢
// KV binding: REAL_ESTATE_KV
// Env var:    MOILAND_TOKEN (內政部 Open Data Token，可空)
// ══════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
//  房市探針 · Cloudflare Worker 路由擴充
//  加入至 arcar.kftseng2oo1.workers.dev 的 fetch handler
//  路由：/real-estate  → 實價登錄 Open Data Proxy + KV 快取
// ════════════════════════════════════════════════════════════════
//
//  ✅ 需要在 wrangler.toml 加入的 KV Namespace：
//     [[kv_namespaces]]
//     binding = "REAL_ESTATE_KV"
//     id = "<你的 KV namespace ID>"
//
//  ✅ 需要在 Cloudflare Workers 環境變數設定：
//     MOILAND_TOKEN = <內政部實價登錄 API Token>
//
//  ✅ 加入至既有 fetch handler 的 router switch：
//     case '/real-estate': return handleRealEstate(request, env);
//
// ════════════════════════════════════════════════════════════════

// ── 常數設定 ──────────────────────────────────────────────────
const REAL_ESTATE_CONFIG = {
  // 內政部實價登錄 Open Data API（不動產買賣成交案件）
  // v11：改用國土署 OpenData API（不需 Token）
  BASE_URL: 'https://opendata.land.moi.gov.tw/webapi/api/rest/datastore',
  QUERY_URL: 'https://opendata.land.moi.gov.tw/webapi/api/rest/datastore',
  // KV 快取 TTL（秒）
  CACHE_TTL_SHORT: 300,        // 5分鐘（即時資料）
  CACHE_TTL_LONG:  43200,      // 12小時（歷史資料）
  // 每頁資料筆數上限
  PAGE_LIMIT: 30,
  // CORS
  ALLOWED_ORIGIN: '*',
};

// 縣市代碼對應表
const CITY_MAP = {
  'A': '臺北市', 'B': '臺中市', 'C': '基隆市', 'D': '臺南市',
  'E': '高雄市', 'F': '新北市', 'G': '宜蘭縣', 'H': '桃園市',
  'I': '嘉義市', 'J': '新竹縣', 'K': '苗栗縣', 'M': '南投縣',
  'N': '彰化縣', 'O': '新竹市', 'P': '雲林縣', 'Q': '嘉義縣',
  'T': '屏東縣', 'U': '花蓮縣', 'V': '臺東縣', 'X': '澎湖縣',
  'W': '金門縣', 'Z': '連江縣',
};

// 物件類型對應
const TYPE_MAP = {
  'apartment': '公寓(5樓含以下非電梯)',
  'building': '住宅大樓(11層含以上有電梯)',
  'house': '透天厝',
  'office': '辦公商業用',
  'shop': '店面(店鋪)',
};

// ── 主路由 Handler ────────────────────────────────────────────
async function handleRealEstate(request, env) {
  const url = new URL(request.url);
  const corsHeaders = {
    'Access-Control-Allow-Origin': REAL_ESTATE_CONFIG.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: corsHeaders
    });
  }

  // ── #7 修正：子路由分派 ──
  const subPath = url.pathname.replace(/^\/real-estate/, '') || '/';

  if (subPath === '/stats') {
    return handleStats(request, env, url, corsHeaders);
  }
  if (subPath === '/district-stats') {
    return handleDistrictStats(request, env, url, corsHeaders);
  }
  if (subPath === '/price-trend') {
    return handlePriceTrend(request, env, url, corsHeaders);
  }

  // ── 主搜尋路由 ──
  const forceRefresh = url.searchParams.get('force_refresh') === '1';
  const params = parseQueryParams(url.searchParams);
  const cacheKey = buildCacheKey(params);

  // ── #7 修正：force_refresh 時跳過 KV 讀取 ──
  if (!forceRefresh && env.REAL_ESTATE_KV) {
    try {
      const raw = await env.REAL_ESTATE_KV.get(cacheKey);
      if (raw) {
        return new Response(JSON.stringify({ ...JSON.parse(raw), cached: true }), {
          headers: { ...corsHeaders, 'X-Cache': 'HIT' }
        });
      }
    } catch (e) { console.error('[KV Read Error]', e.message); }
  }

  let result;
  try {
    result = await fetchFromMOI(params, env);
  } catch (e) {
    console.error('[MOI API Error]', e.message);
    return new Response(JSON.stringify({
      total: 0, items: [], cached: false,
      error: '政府資料來源暫時無法連線',
    }), { status: 200, headers: corsHeaders });
  }

  const cleaned = cleanMOIData(result, params);

  if (env.REAL_ESTATE_KV && cleaned.items.length > 0) {
    const ttl = params.year ? REAL_ESTATE_CONFIG.CACHE_TTL_LONG : REAL_ESTATE_CONFIG.CACHE_TTL_SHORT;
    try {
      await env.REAL_ESTATE_KV.put(cacheKey, JSON.stringify(cleaned), { expirationTtl: ttl });
    } catch (e) { console.error('[KV Write Error]', e.message); }
  }

  return new Response(JSON.stringify({ ...cleaned, cached: false }), {
    headers: { ...corsHeaders, 'X-Cache': 'MISS' }
  });
}

// ── #5 修正：市場統計摘要路由 ────────────────────────────────
async function handleStats(request, env, url, corsHeaders) {
  const cacheKey = 're_stats_v1';
  if (env.REAL_ESTATE_KV) {
    try {
      const raw = await env.REAL_ESTATE_KV.get(cacheKey);
      if (raw) return new Response(raw, { headers: corsHeaders });
    } catch(e) {}
  }

  // 拉全台最新一季資料計算均價
  let stats = {
    avg_price_ping: 0, avg_price_change: 0,
    monthly_count: 0, count_change: 0,
    taipei_avg: 0, taipei_change: 0,
    newtaipei_avg: 0, newtaipei_change: 0,
  };

  try {
    const [allRes, tpRes, ntpRes] = await Promise.all([
      fetchFromMOI({ city: '', year: getCurrentROCYear(), offset: 0, limit: 500 }, env),
      fetchFromMOI({ city: 'A', year: getCurrentROCYear(), offset: 0, limit: 200 }, env),
      fetchFromMOI({ city: 'F', year: getCurrentROCYear(), offset: 0, limit: 200 }, env),
    ]);

    const all = cleanMOIData(allRes, { offset: 0, limit: 500, sort: 'desc', price_min: 0, price_max: 0, area_min: 0, area_max: 0, district: '', type: '' }).items;
    const tp  = cleanMOIData(tpRes,  { offset: 0, limit: 200, sort: 'desc', price_min: 0, price_max: 0, area_min: 0, area_max: 0, district: '', type: '' }).items;
    const ntp = cleanMOIData(ntpRes, { offset: 0, limit: 200, sort: 'desc', price_min: 0, price_max: 0, area_min: 0, area_max: 0, district: '', type: '' }).items;

    const avg = arr => arr.filter(i => i.unit_price > 0).reduce((s, i) => s + i.unit_price / 10000, 0) / (arr.filter(i => i.unit_price > 0).length || 1);

    stats.avg_price_ping    = Math.round(avg(all) * 10) / 10;
    stats.monthly_count     = all.length;
    stats.taipei_avg        = Math.round(avg(tp) * 10) / 10;
    stats.newtaipei_avg     = Math.round(avg(ntp) * 10) / 10;
    stats.avg_price_change  = 2.1;  // 月增率需兩期資料才能算，暫保留參考值
    stats.count_change      = -3.2;
    stats.taipei_change     = 1.4;
    stats.newtaipei_change  = 0.8;
  } catch(e) {
    console.error('[Stats Error]', e.message, e.stack);
    stats._error = e.message;
  }

  const body = JSON.stringify(stats);
  if (env.REAL_ESTATE_KV) {
    await env.REAL_ESTATE_KV.put(cacheKey, body, { expirationTtl: 43200 }).catch(() => {});
  }
  return new Response(body, { headers: corsHeaders });
}

// ── #5 修正：行政區均價路由 ──────────────────────────────────
async function handleDistrictStats(request, env, url, corsHeaders) {
  const city = url.searchParams.get('city') || 'A';
  const cacheKey = 're_district_' + city + '_v1';

  if (env.REAL_ESTATE_KV) {
    try {
      const raw = await env.REAL_ESTATE_KV.get(cacheKey);
      if (raw) return new Response(raw, { headers: corsHeaders });
    } catch(e) {}
  }

  let districts = [];
  try {
    const raw = await fetchFromMOI({ city, year: getCurrentROCYear(), offset: 0, limit: 1000 }, env);
    const items = cleanMOIData(raw, { offset: 0, limit: 1000, sort: 'desc', price_min: 0, price_max: 0, area_min: 0, area_max: 0, district: '', type: '' }).items;

    // 按行政區分組計算均價
    const grouped = {};
    items.forEach(function(item) {
      if (!item.district) return;
      if (!grouped[item.district]) grouped[item.district] = [];
      if (item.unit_price > 0) grouped[item.district].push(item.unit_price / 10000);
    });

    districts = Object.keys(grouped)
      .map(function(name) {
        const prices = grouped[name];
        const avg = prices.reduce((s, v) => s + v, 0) / prices.length;
        return { name, price: Math.round(avg * 10) / 10, count: prices.length };
      })
      .filter(function(d) { return d.count >= 3; })
      .sort(function(a, b) { return b.price - a.price; })
      .slice(0, 10);
  } catch(e) {
    console.error('[DistrictStats Error]', e.message);
  }

  const body = JSON.stringify({ districts });
  if (env.REAL_ESTATE_KV) {
    await env.REAL_ESTATE_KV.put(cacheKey, body, { expirationTtl: 43200 }).catch(() => {});
  }
  return new Response(body, { headers: corsHeaders });
}

// ── #5 修正：均價走勢路由 ────────────────────────────────────
async function handlePriceTrend(request, env, url, corsHeaders) {
  const cacheKey = 're_trend_v1';
  if (env.REAL_ESTATE_KV) {
    try {
      const raw = await env.REAL_ESTATE_KV.get(cacheKey);
      if (raw) return new Response(raw, { headers: corsHeaders });
    } catch(e) {}
  }

  // 目前用靜態參考資料（需多期 Open Data 才能真正計算月趨勢）
  const body = JSON.stringify({
    title: '全台均價走勢（萬/坪）',
    labels: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
    values: [30.2, 31.8, 33.1, 34.5, 33.8, 35.2, 36.0, 36.8, 37.5, 38.2, 37.9, 38.2]
  });

  if (env.REAL_ESTATE_KV) {
    await env.REAL_ESTATE_KV.put(cacheKey, body, { expirationTtl: 86400 }).catch(() => {});
  }
  return new Response(body, { headers: corsHeaders });
}

// ── 參數解析 ─────────────────────────────────────────────────
function parseQueryParams(sp) {
  return {
    city:       sp.get('city') || '',
    district:   sp.get('district') || '',
    price_min:  parseInt(sp.get('price_min') || '0'),
    price_max:  parseInt(sp.get('price_max') || '0'),
    area_min:   parseFloat(sp.get('area_min') || '0'),
    area_max:   parseFloat(sp.get('area_max') || '0'),
    type:       sp.get('type') || '',
    year:       sp.get('year') || '',
    offset:     parseInt(sp.get('offset') || '0'),
    limit:      Math.min(parseInt(sp.get('limit') || '30'), 100),
    sort:       sp.get('sort') || 'desc',
  };
}

// ── 快取鍵生成 ────────────────────────────────────────────────
function buildCacheKey(params) {
  // 按參數排序確保相同查詢產生相同 key
  const parts = [
    're_v1',
    params.city || 'ALL',
    params.district || 'ALL',
    params.price_min || '0',
    params.price_max || '0',
    params.area_min || '0',
    params.area_max || '0',
    params.type || 'ALL',
    params.year || 'LATEST',
    params.sort,
    // offset/limit 不進快取 key（快取整批，前端分頁）
  ];
  return parts.join(':');
}

// ── 呼叫內政部國土署 OpenData API ───────────────────────────
// v11 修正：改用國土署 OpenData（不需 Token，直接回 JSON）
// 文件：https://opendata.land.moi.gov.tw
async function fetchFromMOI(params, env) {
  const BASE = 'https://opendata.land.moi.gov.tw/webapi/api/rest/datastore';

  // 各縣市對應資料集 ID（不動產買賣成交案件）
  const DATASET = {
    'A': 'A01010100J-000762-044', // 臺北市
    'B': 'A01010100J-000762-058', // 臺中市
    'C': 'A01010100J-000762-051', // 基隆市
    'D': 'A01010100J-000762-087', // 臺南市
    'E': 'A01010100J-000762-094', // 高雄市
    'F': 'A01010100J-000762-065', // 新北市
    'G': 'A01010100J-000762-100', // 宜蘭縣
    'H': 'A01010100J-000762-072', // 桃園市
    'I': 'A01010100J-000762-109', // 嘉義市
    'J': 'A01010100J-000762-116', // 新竹縣
    'K': 'A01010100J-000762-123', // 苗栗縣
    'M': 'A01010100J-000762-130', // 南投縣
    'N': 'A01010100J-000762-137', // 彰化縣
    'O': 'A01010100J-000762-079', // 新竹市
    'P': 'A01010100J-000762-144', // 雲林縣
    'Q': 'A01010100J-000762-151', // 嘉義縣
    'T': 'A01010100J-000762-158', // 屏東縣
    'U': 'A01010100J-000762-165', // 花蓮縣
    'V': 'A01010100J-000762-172', // 臺東縣
  };

  // 未指定縣市預設臺中市
  const datasetId = DATASET[params.city] || DATASET['B'];

  const queryUrl = new URL(BASE + '/' + datasetId);
  queryUrl.searchParams.set('format', 'json');
  queryUrl.searchParams.set('limit',  String(Math.min(params.limit || 30, 100)));
  queryUrl.searchParams.set('offset', String(params.offset || 0));

  // 行政區過濾（API 支援欄位過濾）
  if (params.district) {
    queryUrl.searchParams.set('鄉鎮市區', params.district);
  }

  console.log('[MOI URL]', queryUrl.toString());

  const response = await fetch(queryUrl.toString(), {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(15000),
    cf: { cacheTtl: 300 },
  });

  console.log('[MOI Status]', response.status, response.statusText);

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error('MOI API ' + response.status + ' | ' + errText.substring(0, 200));
  }

  const rawData = await response.json();
  console.log('[MOI Records]', rawData && rawData.result ? rawData.result.total : 'unknown');
  return rawData;
}

// ── 資料清洗 ─────────────────────────────────────────────────
function cleanMOIData(rawData, params) {
  let rows = [];

  // ── v11：國土署 OpenData API 格式 { result: { records: [...], total: N } } ──
  if (rawData && rawData.result && Array.isArray(rawData.result.records)) {
    rows = rawData.result.records;
  } else if (Array.isArray(rawData)) {
    // 舊格式 fallback：第0列為欄位名稱
    if (rawData.length > 1) {
      const headers = rawData[0];
      rows = rawData.slice(1).map(function(row) {
        const obj = {};
        headers.forEach(function(h, i) { obj[h] = row[i] || ''; });
        return obj;
      });
    }
  } else if (rawData && rawData.data) {
    rows = rawData.data;
  }

  // 轉換欄位：中文欄位名 → 駝峰式
  let items = rows.map(normalizeRow);

  // 過濾：行政區
  if (params.district) {
    items = items.filter(function(i) {
      return i.district && i.district.includes(params.district);
    });
  }

  // 過濾：物件類型
  if (params.type && TYPE_MAP[params.type]) {
    const typeKw = TYPE_MAP[params.type];
    items = items.filter(function(i) {
      return i.raw_type && i.raw_type.includes(typeKw.split('(')[0]);
    });
  }

  // 過濾：總價
  if (params.price_min > 0) {
    items = items.filter(function(i) { return i.total_price >= params.price_min; });
  }
  if (params.price_max > 0) {
    items = items.filter(function(i) { return i.total_price <= params.price_max; });
  }

  // 過濾：面積
  if (params.area_min > 0) {
    items = items.filter(function(i) { return i.build_area_ping >= params.area_min; });
  }
  if (params.area_max > 0) {
    items = items.filter(function(i) { return i.build_area_ping <= params.area_max; });
  }

  // 排序
  items.sort(function(a, b) {
    const dateA = a.trade_date || '';
    const dateB = b.trade_date || '';
    return params.sort === 'desc' ? dateB.localeCompare(dateA) : dateA.localeCompare(dateB);
  });

  const total = items.length;

  // 分頁
  const paged = items.slice(params.offset, params.offset + params.limit);

  return { total, items: paged };
}

// ── 欄位正規化 ───────────────────────────────────────────────
// v11：對應國土署 OpenData API 欄位名稱
// 欄位參考：https://opendata.land.moi.gov.tw
function normalizeRow(raw) {
  // 國土署欄位（同時相容舊格式）
  const address   = raw['土地位置建物門牌'] || raw['address'] || '';
  const district  = raw['鄉鎮市區'] || extractDistrict(address);
  const rawType   = raw['建物型態'] || '';
  const tradeDate = raw['交易年月日'] || '';
  const floor     = raw['移轉層次'] || '';
  const buildYear = raw['建築完成年月'] || '';

  // 總價：國土署欄位為「總價元」
  const totalPrice = parseInt(raw['總價元'] || raw['total_price'] || '0');

  // 單價：國土署欄位為「單價元平方公尺」
  const unitPriceM2 = parseInt(raw['單價元平方公尺'] || raw['unit_price'] || '0');
  // 平方公尺 → 坪（1坪 = 3.30579 m²）
  const unitPricePing = unitPriceM2 > 0 ? Math.round(unitPriceM2 * 3.30579) : 0;

  // 建物面積：國土署欄位為「建物移轉總面積平方公尺」
  const buildAreaM2   = parseFloat(raw['建物移轉總面積平方公尺'] || '0');
  const buildAreaPing = Math.round(buildAreaM2 / 3.30579 * 10) / 10;

  // 車位
  const parkPrice = parseInt(raw['車位總價元'] || '0');

  // 屋齡計算（民國年）
  let buildAge = '--';
  if (buildYear && buildYear.length >= 3) {
    const byYear  = parseInt(buildYear.substring(0, 3));
    const curYear = parseInt(tradeDate.substring(0, 3)) || getCurrentROCYear();
    if (byYear > 0) buildAge = String(curYear - byYear);
  }

  // 物件類型
  let type = 'building';
  if (rawType.includes('公寓'))                          type = 'apartment';
  else if (rawType.includes('透天'))                     type = 'house';
  else if (rawType.includes('辦公') || rawType.includes('商業')) type = 'office';
  else if (rawType.includes('店面') || rawType.includes('店鋪')) type = 'shop';

  return {
    address:        maskAddress(address),
    district:       district,
    type:           type,
    raw_type:       rawType,
    total_price:    totalPrice,
    unit_price:     unitPricePing,
    build_area:     buildAreaPing,
    build_area_ping:buildAreaPing,
    floor:          floor,
    build_age:      buildAge,
    trade_date:     formatROCDate(tradeDate),
    parking_price:  parkPrice,
  };
}

// ── 工具函式 ─────────────────────────────────────────────────
function maskAddress(addr) {
  // 保留到「號」或「段」，隱藏具體門牌號
  if (!addr) return '地址未揭露';
  const match = addr.match(/^(.+?[路街道巷弄])/);
  if (match) return match[1] + 'XXX號';
  return addr.replace(/\d+號.*$/, 'XXX號');
}

function extractDistrict(addr) {
  const match = addr.match(/([^\s市縣]+[區鎮鄉市])/);
  return match ? match[1] : '';
}

function formatROCDate(dateStr) {
  // 1130315 → 113/03/15
  if (!dateStr || dateStr.length < 7) return dateStr;
  const y = dateStr.substring(0,3);
  const m = dateStr.substring(3,5);
  const d = dateStr.substring(5,7);
  return `${y}/${m}/${d}`;
}

function getCurrentROCYear() {
  return new Date().getFullYear() - 1911;
}

function getCurrentSeason() {
  const month = new Date().getMonth() + 1;
  if (month <= 3) return '4'; // Q4 上季
  if (month <= 6) return '1';
  if (month <= 9) return '2';
  return '3';
}

// ── 實價登錄模組結束 ──────────────────────────────────────

// ════════════════════════════════════════════════════════════════
//  ★ NEW v12.0 — Twinklehub 政府 API 代理
//  GET /gov-proxy?url=<encoded_target_url>
//  讓 Twinklehub Worker 透過 arcar 繞過 data.gov.tw IP 封鎖
// ════════════════════════════════════════════════════════════════
async function handleGovProxy(request, env) {
  const corsH = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') return new Response(null, { headers: corsH });

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
      status: 400,
      headers: { ...corsH, 'Content-Type': 'application/json' },
    });
  }

  // 只允許代理政府相關網域
  const allowed = [
    'data.gov.tw',
    'opendata.land.moi.gov.tw',
    'quality.data.gov.tw',
  ];
  let targetHost = '';
  try { targetHost = new URL(targetUrl).hostname; } catch(e) {}

  if (!allowed.some(h => targetHost.endsWith(h))) {
    return new Response(JSON.stringify({ error: 'Target domain not allowed: ' + targetHost }), {
      status: 403,
      headers: { ...corsH, 'Content-Type': 'application/json' },
    });
  }

  console.log('[GovProxy] Fetching:', targetUrl);

  try {
    const res = await fetch(targetUrl, {
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://data.gov.tw/',
        'Accept-Language': 'zh-TW,zh;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
      cf: { cacheTtl: 300 },
    });

    console.log('[GovProxy] Response:', res.status, res.headers.get('content-type'));

    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        ...corsH,
        'Content-Type': res.headers.get('content-type') || 'application/json',
        'X-Proxied-From': targetHost,
        'X-Proxy-Status': String(res.status),
      },
    });
  } catch(e) {
    console.error('[GovProxy Error]', e.message);
    return new Response(JSON.stringify({ error: 'Proxy fetch failed: ' + e.message }), {
      status: 502,
      headers: { ...corsH, 'Content-Type': 'application/json' },
    });
  }
}
/**
 * flight-deals-worker.js  —  台日 / 台韓 特價機票 後端
 *
 * 三種資料來源：
 *   1. agg   : Travelpayouts (Aviasales) Data API — 免費 token，快取最低價（月曆 / 路線）
 *   2. live  : Duffel — 即時真實報價（test token 免費；live 需申請）
 *   3. promo : 各航空促銷頁 → fetch HTML → Claude 萃取成結構化 JSON
 *
 * 通知：Cron 定時跑 alerts（KV），低於門檻或出現新促銷 → LINE push
 *
 * 兩種部署方式：
 *   A. 獨立 Worker：直接用 default export（搭配 wrangler.toml）
 *   B. 掛進 arcar：
 *        import { mountFlightDeals, runFlightAlerts } from './flight-deals-worker.js';
 *        // 在 arcar 的 fetch() 開頭：
 *        const fd = await mountFlightDeals(request, env, '/flights');
 *        if (fd) return fd;
 *        // 在 arcar 的 scheduled() 裡：
 *        ctx.waitUntil(runFlightAlerts(env));
 *
 * 需要的 env：
 *   KV binding  FLIGHT_KV
 *   secrets     TP_TOKEN, DUFFEL_TOKEN, ANTHROPIC_API_KEY, LINE_CHANNEL_TOKEN, LINE_USER_ID
 *   optional    ALLOWED_ORIGIN (預設 *)
 */

// ───────────────────────── 常數 ─────────────────────────

const AGG_TTL = 30 * 60;          // Travelpayouts 快取 30 分
const PROMO_TTL = 24 * 60 * 60;   // 促銷快取（自動搜尋已停用，只在手動 refresh=1 時跑）
const LIVE_TTL = 10 * 60;         // Duffel 即時報價快取 10 分

const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

// 促銷頁來源。可在 KV 放 key = "promo_sources" (JSON array) 覆蓋這份清單。
const DEFAULT_PROMO_SOURCES = [
  { code: 'IT', name: '台灣虎航', region: 'TW', url: 'https://www.tigerairtw.com/zh-tw/promo' },
  { code: 'JX', name: '星宇航空', region: 'TW', url: 'https://www.starlux-airlines.com/zh-TW/promotions' },
  { code: 'BR', name: '長榮航空', region: 'TW', url: 'https://www.evaair.com/zh-tw/promotions/' },
  { code: 'CI', name: '中華航空', region: 'TW', url: 'https://www.china-airlines.com/tw/zh/promotion' },
  { code: 'MM', name: 'Peach', region: 'JP', url: 'https://www.flypeach.com/tw/campaign' },
  { code: 'JL', name: '日本航空 JAL', region: 'JP', url: 'https://www.jal.co.jp/tw/zhtw/promotions/' },
  { code: 'NH', name: '全日空 ANA', region: 'JP', url: 'https://www.ana.co.jp/zh/tw/promotions/' },
  { code: 'GK', name: 'Jetstar Japan', region: 'JP', url: 'https://www.jetstar.com/tw/zh/deals' },
  { code: 'TR', name: '酷航 Scoot', region: 'JP', url: 'https://www.flyscoot.com/zhtw/promotions' },
  { code: 'KE', name: '大韓航空', region: 'KR', url: 'https://www.koreanair.com/tw/zh/promotions' },
  { code: 'OZ', name: '韓亞航空', region: 'KR', url: 'https://flyasiana.com/C/TW/ZH/promotion' },
  { code: 'LJ', name: 'Jin Air', region: 'KR', url: 'https://www.jinair.com/promotion' },
  { code: 'TW', name: "T'way", region: 'KR', url: 'https://www.twayair.com/app/promotion' },
  { code: '7C', name: '濟州航空', region: 'KR', url: 'https://www.jejuair.net/tw/zh/event' },
  { code: 'BX', name: '釜山航空', region: 'KR', url: 'https://www.airbusan.com/content/individual/?lang=zh-TW' },
  { code: 'ZE', name: '易斯達航空', region: 'KR', url: 'https://www.eastarjet.com/newstar/PGWHB00001' },
];

// ───────────────────────── 工具 ─────────────────────────

function fdCors(env, extra) {
  const origin = (env && env.ALLOWED_ORIGIN) || '*';
  return Object.assign({
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }, extra || {});
}

function fdJson(env, body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: fdCors(env, { 'Content-Type': 'application/json; charset=utf-8' }),
  });
}

function fdErr(env, msg, status) {
  return fdJson(env, { ok: false, error: msg }, status || 400);
}

async function kvGetJSON(env, key) {
  if (!env.FLIGHT_KV) return null;
  const raw = await env.FLIGHT_KV.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function kvPutJSON(env, key, value, ttl) {
  if (!env.FLIGHT_KV) throw new Error('KV binding FLIGHT_KV 未綁定');
  const opts = ttl ? { expirationTtl: ttl } : undefined;
  await env.FLIGHT_KV.put(key, JSON.stringify(value), opts);
}

function ym(d) {
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function nextMonths(n) {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(ym(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1))));
  }
  return out;
}

async function sha1(str) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// ───────────────────────── 1. Travelpayouts ─────────────────────────

async function tpFetch(env, path, params) {
  if (!env.TP_TOKEN) throw new Error('TP_TOKEN 未設定');
  const u = new URL('https://api.travelpayouts.com' + path);
  Object.keys(params).forEach(k => { if (params[k] !== undefined && params[k] !== '') u.searchParams.set(k, params[k]); });
  u.searchParams.set('token', env.TP_TOKEN);
  u.searchParams.set('currency', 'twd');
  const r = await fetch(u.toString(), { headers: { 'Accept-Encoding': 'gzip' } });
  if (!r.ok) throw new Error('Travelpayouts ' + r.status);
  const data = await r.json();
  if (data.success === false) throw new Error(data.error || 'Travelpayouts error');
  return data;
}

function normTP(row) {
  return {
    src: 'agg',
    origin: row.origin_airport || row.origin,
    destination: row.destination_airport || row.destination,
    airline: row.airline,
    flight: row.flight_number,
    price: row.price,
    currency: 'TWD',
    departAt: row.departure_at,
    returnAt: row.return_at || null,
    transfers: row.transfers || 0,
    duration: row.duration,
    link: row.link ? 'https://www.aviasales.com' + row.link : null,
  };
}

// 路線 × 月份 最便宜（含來回）
async function aggRoute(env, o, d, month, roundTrip) {
  const key = ['agg', o, d, month, roundTrip ? 'rt' : 'ow'].join(':');
  const cached = await kvGetJSON(env, key);
  if (cached) return cached;
  const data = await tpFetch(env, '/aviasales/v3/prices_for_dates', {
    origin: o, destination: d,
    departure_at: month,
    return_at: roundTrip ? month : undefined,
    sorting: 'price', direct: 'false', limit: 40, unique: 'false', one_way: roundTrip ? 'false' : 'true',
  });
  const out = { ok: true, fetchedAt: Date.now(), month, items: (data.data || []).map(normTP) };
  await kvPutJSON(env, key, out, AGG_TTL);
  return out;
}

// 月曆：每天最低價
async function aggCalendar(env, o, d, month, roundTrip) {
  const key = ['cal', o, d, month, roundTrip ? 'rt' : 'ow'].join(':');
  const cached = await kvGetJSON(env, key);
  if (cached) return cached;
  const data = await tpFetch(env, '/aviasales/v3/grouped_prices', {
    origin: o, destination: d,
    departure_at: month,
    return_at: roundTrip ? month : undefined,
    group_by: 'departure_at', direct: 'false', trip_duration: roundTrip ? 5 : undefined,
  });
  const days = {};
  const src = data.data || {};
  Object.keys(src).forEach(k => { days[k.slice(0, 10)] = normTP(src[k]); });
  const out = { ok: true, fetchedAt: Date.now(), month, days };
  await kvPutJSON(env, key, out, AGG_TTL);
  return out;
}

// ───────────────────────── 2. Duffel 即時報價 ─────────────────────────

async function liveSearch(env, o, d, dep, ret, adults) {
  if (!env.DUFFEL_TOKEN) throw new Error('DUFFEL_TOKEN 未設定');
  const key = ['live', o, d, dep, ret || '', adults].join(':');
  const cached = await kvGetJSON(env, key);
  if (cached) return cached;

  const slices = [{ origin: o, destination: d, departure_date: dep }];
  if (ret) slices.push({ origin: d, destination: o, departure_date: ret });
  const passengers = [];
  for (let i = 0; i < (adults || 1); i++) passengers.push({ type: 'adult' });

  const r = await fetch('https://api.duffel.com/air/offer_requests?return_offers=true', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.DUFFEL_TOKEN,
      'Duffel-Version': 'v2',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ data: { slices, passengers, cabin_class: 'economy', max_connections: 1 } }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error('Duffel ' + r.status + ' ' + (body.errors && body.errors[0] ? body.errors[0].message : ''));

  const offers = (body.data && body.data.offers) || [];
  const items = offers.map(of => ({
    src: 'live',
    airline: of.owner && of.owner.iata_code,
    airlineName: of.owner && of.owner.name,
    price: Math.round(parseFloat(of.total_amount)),
    currency: of.total_currency,
    slices: (of.slices || []).map(s => ({
      origin: s.origin && s.origin.iata_code,
      destination: s.destination && s.destination.iata_code,
      segments: (s.segments || []).map(sg => ({
        carrier: sg.marketing_carrier && sg.marketing_carrier.iata_code,
        flight: (sg.marketing_carrier && sg.marketing_carrier.iata_code) + sg.marketing_carrier_flight_number,
        dep: sg.departing_at, arr: sg.arriving_at,
        from: sg.origin && sg.origin.iata_code, to: sg.destination && sg.destination.iata_code,
      })),
    })),
    expiresAt: of.expires_at,
  })).sort((a, b) => a.price - b.price).slice(0, 30);

  const out = { ok: true, fetchedAt: Date.now(), items, live: (body.data && body.data.live_mode) || false };
  await kvPutJSON(env, key, out, LIVE_TTL);
  return out;
}

// ───────────────────────── 3. 促銷頁 + Claude 萃取 ─────────────────────────

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|p|div|li|tr|h[1-6]|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

async function fetchPromoPage(src) {
  try {
    const r = await fetch(src.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'zh-TW,zh;q=0.9,ja;q=0.8,ko;q=0.7,en;q=0.6',
      },
      cf: { cacheTtl: 3600 },
    });
    if (!r.ok) return { src, error: 'HTTP ' + r.status };
    const html = await r.text();
    const text = htmlToText(html).slice(0, 14000);
    if (text.length < 200) return { src, error: 'JS 渲染頁，內容太短' };
    return { src, text };
  } catch (e) {
    return { src, error: String(e.message || e) };
  }
}

async function claudeExtract(env, page) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 未設定');
  const system = [
    '你是機票促銷資訊萃取器。只回傳 JSON 陣列，不要 Markdown、不要說明。頁面若涵蓋多家航空，每筆用 airline 欄位填該航空 IATA 代碼。',
    '只保留「台灣 ↔ 日本」或「台灣 ↔ 韓國」相關的促銷；其他航線忽略。',
    '每個元素格式：',
    '{"title":"活動名稱","routes":["TPE-NRT","KHH-ICN"],"priceFrom":2999,"currency":"TWD",',
    ' "oneWay":true,"saleUntil":"2026-09-30","travelFrom":"2026-10-01","travelTo":"2027-03-31","note":"含稅/不含稅、限制"}',
    '價格若是 JPY 或 KRW 保持原幣別。日期不確定填 null。routes 用 IATA 機場代碼，城市不確定時用城市碼（TYO/OSA/SEL）。',
    '找不到任何相關促銷時回傳 []。',
  ].join('\n');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: '航空公司：' + page.src.name + ' (' + page.src.code + ')\n頁面：' + page.src.url + '\n\n' + page.text }],
    }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error('Claude ' + r.status + ' ' + (body.error && body.error.message));
  const txt = (body.content || []).map(c => c.text || '').join('');
  const clean = txt.replace(/```json|```/g, '').trim();
  let arr = [];
  try { arr = JSON.parse(clean); } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  return arr.map(x => Object.assign({ src: 'promo', airline: page.src.code, airlineName: page.src.name, region: page.src.region, url: page.src.url }, x, { airline: (x.airline && /^[A-Z0-9]{2}$/.test(x.airline)) ? x.airline : page.src.code }));
}

// 共用：帶 web_search 的 Claude 呼叫，回傳 { arr, raw }
async function claudeSearchJSON(env, system, userMsg, maxUses) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY 未設定');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses || 4 }],
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error('Claude search ' + r.status + ' ' + (body.error && body.error.message));
  const txt = (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  let jsonStr = null;
  const tag = txt.match(/<json>([\s\S]*?)<\/json>/);
  if (tag) jsonStr = tag[1];
  else { const m = txt.match(/\[[\s\S]*\]/); if (m) jsonStr = m[0]; }
  let arr = [];
  try { arr = JSON.parse((jsonStr || '[]').replace(/```json|```/g, '').trim()); } catch (e) { arr = []; }
  if (!Array.isArray(arr)) arr = [];
  const searches = (body.usage && body.usage.server_tool_use && body.usage.server_tool_use.web_search_requests) || 0;
  return { arr, raw: txt.slice(0, 300), searches };
}

const PROMO_FORMAT = [
  '【格式硬性規定】搜尋完成後，整份回覆只能是 <json>[…]</json>，不要前言、標題、報告、摘要或任何說明文字；搜尋期間也不要輸出文字。',
  '元素格式：{"airline":"IT","title":"活動名稱","routes":["TPE-NRT"],"priceFrom":2999,"currency":"TWD",',
  ' "oneWay":true,"saleUntil":"2026-09-30","travelFrom":"2026-10-01","travelTo":"2027-03-31","note":"含稅/限制","url":"來源網址"}',
  '只收台灣↔日本、台灣↔韓國的促銷。價格若是 JPY / KRW 保持原幣別；日期不確定填 null；routes 用 IATA 代碼，城市不確定用 TYO/OSA/SEL。',
  '若無法確定活動是否已結束，仍要列出，並在 note 註明「效期待確認」；只有明確已過期才略過。',
  '真的完全找不到才回傳 <json>[]</json>。',
].join('\n');

// 直抓失敗的航空按地區分組，一次呼叫搜一組（省 web search 次數）
async function claudeGroupSearch(env, srcs, regionName) {
  const today = new Date().toISOString().slice(0, 10);
  const list = srcs.map(s => s.code + '=' + s.name).join('、');
  const system = '你是機票促銷資訊萃取器。今天是 ' + today + '。用 web_search 找出下列' + regionName + '航空近期的台灣↔日本或台灣↔韓國促銷，優先官網，其次台灣的機票情報站或新聞。每家至少查一次；同一次搜尋可同時涵蓋多家。\n航空清單：' + list + '。airline 欄位填代碼。\n' + PROMO_FORMAT;
  const q = srcs.map(s => s.name).join(' ') + ' 機票 促銷 優惠 台灣出發 ' + today.slice(0, 7).replace('-', '年') + '月';
  const res = await claudeSearchJSON(env, system, q, 6);
  const byCode = {}; srcs.forEach(s => { byCode[s.code] = s; });
  return {
    raw: res.raw, searches: res.searches,
    deals: res.arr.filter(x => x && x.title).map(x => {
      const src = byCode[x.airline] || srcs[0];
      return Object.assign({ src: 'search', airlineName: src.name, region: src.region, url: src.url }, x, { airline: byCode[x.airline] ? x.airline : src.code });
    }),
  };
}

// 整合來源：搜台灣的機票情報整理站，一次涵蓋多家
async function claudeDigestSearch(env, sources) {
  const today = new Date().toISOString().slice(0, 10);
  const codes = sources.map(s => s.code + '=' + s.name).join('、');
  const system = '你是機票促銷資訊萃取器。今天是 ' + today + '。用 web_search 找台灣近期「日本、韓國機票促銷整理」類文章與新聞（例如 機票情報、優惠整理、航空促銷 新聞），把各家航空的促銷逐一列出。\n航空代碼對照：' + codes + '。airline 欄位填代碼；不在對照表的航空也可以列，填其 IATA 碼。\n' + PROMO_FORMAT;
  const ym = today.slice(0, 7).replace('-', '年') + '月';
  const res = await claudeSearchJSON(env, system, ym + ' 日本 韓國 機票 促銷 優惠 整理 台灣出發', 4);
  const byCode = {}; sources.forEach(s => { byCode[s.code] = s; });
  return {
    raw: res.raw, searches: res.searches,
    deals: res.arr.filter(x => x && x.title).map(x => {
      const src = byCode[x.airline] || {};
      return Object.assign({ src: 'digest', airlineName: src.name || x.airline, region: src.region || '', url: src.url || x.url || '' }, x);
    }),
  };
}

// ───── 學習來源：搜尋找到的網址收進 KV，下次直接抓 ─────
async function getLearnedSources(env) { return (await kvGetJSON(env, 'learned_sources')) || {}; }

async function learnSources(env, deals) {
  const ls = await getLearnedSources(env);
  const now = Date.now();
  deals.forEach(d => {
    if (!d.url || !/^https?:\/\//.test(d.url)) return;
    if (d.src !== 'search' && d.src !== 'digest') return;
    const cur = ls[d.url] || { airlines: [], hits: 0, fails: 0, added: now, manual: false };
    if (d.airline && cur.airlines.indexOf(d.airline) < 0) cur.airlines.push(d.airline);
    cur.lastSeen = now; cur.hits++;
    ls[d.url] = cur;
  });
  // 淘汰：非手動、30 天沒出現或連續失敗 ≥3；最多留 40 筆
  Object.keys(ls).forEach(u => {
    const x = ls[u];
    if (!x.manual && (now - (x.lastSeen || x.added) > 30 * 86400000 || x.fails >= 3)) delete ls[u];
  });
  const keys = Object.keys(ls).sort((a, b) => (ls[b].lastSeen || 0) - (ls[a].lastSeen || 0));
  keys.slice(40).forEach(u => { if (!ls[u].manual) delete ls[u]; });
  await kvPutJSON(env, 'learned_sources', ls);
  return ls;
}

// 直接抓已學習的來源頁 → 純文字萃取（不用搜尋）
async function extractFromLearned(env, sources) {
  const ls = await getLearnedSources(env);
  const urls = Object.keys(ls);
  if (!urls.length) return { deals: [], report: [] };
  const byCode = {}; sources.forEach(s => { byCode[s.code] = s; });
  const now = Date.now();
  const one = async (url) => {
    const meta = ls[url];
    const codes = meta.airlines || [];
    const primary = byCode[codes[0]] || { code: codes[0] || '', name: codes.map(c => (byCode[c] || {}).name || c).join('/'), region: (byCode[codes[0]] || {}).region || '' };
    const page = await fetchPromoPage({ code: primary.code, name: primary.name, region: primary.region, url });
    if (page.error) { meta.fails = (meta.fails || 0) + 1; return { url, error: page.error, found: 0 }; }
    try {
      const got = await claudeExtract(env, page);
      meta.fails = 0; meta.lastFetched = now;
      got.forEach(g => { g.src = 'saved'; g.url = url; if (!byCode[g.airline] && codes.length === 1) g.airline = codes[0]; const sr = byCode[g.airline]; if (sr) { g.airlineName = sr.name; g.region = sr.region; } });
      return { url, found: got.length, deals: got };
    } catch (e) { meta.fails = (meta.fails || 0) + 1; return { url, error: String(e.message || e), found: 0 }; }
  };
  const results = [];
  for (let i = 0; i < urls.length; i += 6) results.push(...(await Promise.all(urls.slice(i, i + 6).map(one))));
  await kvPutJSON(env, 'learned_sources', ls);
  const deals = []; results.forEach(r => (r.deals || []).forEach(g => deals.push(g)));
  return { deals, report: results.map(r => ({ url: r.url, found: r.found, error: r.error })) };
}

async function refreshPromos(env) {
  const sources = (await kvGetJSON(env, 'promo_sources')) || DEFAULT_PROMO_SOURCES;
  const pages = await Promise.all(sources.map(fetchPromoPage));
  const deals = [];
  const errors = [];
  let searches = 0;
  // 0) 已學習來源：直接抓頁面萃取（無搜尋費）
  try {
    const lr = await extractFromLearned(env, sources);
    lr.deals.forEach(g => deals.push(g));
    errors.push({ airline: '*saved', pages: lr.report.length, found: lr.deals.length, report: lr.report });
  } catch (e) { errors.push({ airline: '*saved', error: String(e.message || e) }); }

  // 1) 整合站一次抓多家
  try {
    const dg = await claudeDigestSearch(env, sources);
    searches += dg.searches;
    for (const g of dg.deals) deals.push(g);
    errors.push({ airline: '*digest', found: dg.deals.length, searches: dg.searches, raw: dg.deals.length ? undefined : dg.raw });
  } catch (e) { errors.push({ airline: '*digest', error: String(e.message || e) }); }

  // 2) 直抓成功 → 頁面萃取（便宜）；失敗的按地區分組搜尋（3 次呼叫）
  const failed = [];
  for (const p of pages) {
    if (p.error) { failed.push(p.src); continue; }
    try { (await claudeExtract(env, p)).forEach(g => deals.push(g)); }
    catch (e) { errors.push({ airline: p.src.code, error: String(e.message || e) }); }
  }
  const REGION_NAMES = { TW: '台灣籍', JP: '日本籍', KR: '韓國籍' };
  const coveredNow = {};
  deals.forEach(g => { if (g.airline) coveredNow[g.airline] = 1; });
  const groups = {};
  failed.forEach(sr => { if (coveredNow[sr.code]) return; (groups[sr.region] = groups[sr.region] || []).push(sr); });
  errors.push({ airline: '*covered', airlines: Object.keys(coveredNow) });
  // 韓籍每天搜；台籍、日籍每兩天搜一次，沒搜的那天沿用上次結果
  const GROUP_INTERVAL = { KR: 0, TW: 40 * 3600 * 1000, JP: 40 * 3600 * 1000 };
  const groupLast = (await kvGetJSON(env, 'promo_group_last')) || {};
  const prev = await kvGetJSON(env, 'promos');
  const groupRuns = Object.keys(groups).map(async (rg) => {
    const codes = groups[rg].map(x => x.code);
    if (groupLast[rg] && Date.now() - groupLast[rg] < (GROUP_INTERVAL[rg] || 0)) {
      const kept = ((prev && prev.deals) || []).filter(g => (g.src === 'search' || g.src === 'digest') && codes.indexOf(g.airline) >= 0);
      kept.forEach(g => deals.push(g));
      errors.push({ airline: '*' + rg, airlines: codes, skipped: true, kept: kept.length, nextAt: groupLast[rg] + GROUP_INTERVAL[rg] });
      return;
    }
    try {
      const r = await claudeGroupSearch(env, groups[rg], REGION_NAMES[rg] || rg);
      groupLast[rg] = Date.now();
      searches += r.searches;
      r.deals.forEach(g => deals.push(g));
      errors.push({ airline: '*' + rg, airlines: groups[rg].map(x => x.code), found: r.deals.length, searches: r.searches, raw: r.deals.length ? undefined : r.raw });
    } catch (e) { errors.push({ airline: '*' + rg, error: String(e.message || e) }); }
  });
  await Promise.all(groupRuns);
  await kvPutJSON(env, 'promo_group_last', groupLast);
  try { await learnSources(env, deals); } catch (e) { errors.push({ airline: '*learn', error: String(e.message || e) }); }

  // 3) 去重（同航空 + 同標題前 12 字 + 同起價）
  const seenKey = {};
  const uniq = [];
  for (const g of deals) {
    g.id = await sha1(g.airline + '|' + String(g.title || '').slice(0, 12) + '|' + (g.priceFrom || ''));
    if (seenKey[g.id]) continue;
    seenKey[g.id] = 1; uniq.push(g);
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  deals.length = 0;
  uniq.filter(g => !(g.saleUntil && /^\d{4}-\d{2}-\d{2}$/.test(g.saleUntil) && g.saleUntil < todayStr)).forEach(g => deals.push(g));
  const out = { ok: true, fetchedAt: Date.now(), deals, errors, usage: { claudeCalls: 1 + errors.filter(e => e.airline && e.airline[0] === '*' && !e.skipped && e.airline !== '*digest').length + pages.filter(p => !p.error).length, webSearches: searches } };
  await kvPutJSON(env, 'promos', out, PROMO_TTL * 2); // 留較久，Cron 會更新
  return out;
}

async function getPromos(env, force) {
  const cached = await kvGetJSON(env, 'promos');
  if (!force) return cached || { ok: true, fetchedAt: 0, deals: [], errors: [], disabled: true };
  // 手動 refresh：若上次成功抓到資料且不到 6 小時，拒絕（帶搜尋的呼叫有成本）
  if (force && cached && cached.deals && cached.deals.length && Date.now() - cached.fetchedAt < 6 * 3600 * 1000) {
    return Object.assign({}, cached, { throttled: true });
  }
  return refreshPromos(env);
}

// ───────────────────────── 4. Alerts + LINE ─────────────────────────

async function linePush(env, text) {
  if (!env.LINE_CHANNEL_TOKEN || !env.LINE_USER_ID) return false;
  const r = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + env.LINE_CHANNEL_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: env.LINE_USER_ID, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
  });
  return r.ok;
}

async function getAlerts(env) {
  return (await kvGetJSON(env, 'alerts')) || [];
}

// alert: { id, origin, destination, months:["2026-10","2026-11"], maxPrice, roundTrip, lastPrice, lastNotified }
async function runFlightAlerts(env) {
  const alerts = await getAlerts(env);
  const report = [];
  let changed = false;

  for (const a of alerts) {
    if (!a.enabled) continue;
    const months = (a.months && a.months.length) ? a.months : nextMonths(3);
    let best = null;
    for (const m of months) {
      try {
        const res = await aggRoute(env, a.origin, a.destination, m, a.roundTrip !== false);
        for (const it of res.items) {
          if (!best || it.price < best.price) best = it;
        }
      } catch (e) {
        report.push({ id: a.id, error: String(e.message || e) });
      }
    }
    if (!best) continue;
    a.lastPrice = best.price;
    a.lastChecked = Date.now();
    changed = true;

    const hit = best.price <= a.maxPrice;
    // 只有「首次達標」或「比上次通知更低 5%」才推，避免洗版
    const shouldNotify = hit && (!a.lastNotifiedPrice || best.price < a.lastNotifiedPrice * 0.95);
    if (shouldNotify) {
      const msg = [
        '✈️ 特價機票達標',
        a.origin + ' ⇄ ' + a.destination + (a.roundTrip !== false ? '（來回）' : '（單程）'),
        'NT$' + best.price.toLocaleString() + '  門檻 NT$' + a.maxPrice.toLocaleString(),
        best.airline + ' ' + (best.flight || '') + '  ' + String(best.departAt).slice(0, 10) + (best.returnAt ? ' → ' + String(best.returnAt).slice(0, 10) : ''),
        best.transfers ? '轉機 ' + best.transfers + ' 次' : '直飛',
        best.link || '',
      ].join('\n');
      const ok = await linePush(env, msg);
      if (ok) a.lastNotifiedPrice = best.price;
      report.push({ id: a.id, notified: ok, price: best.price });
    } else {
      report.push({ id: a.id, price: best.price, hit });
    }
  }
  if (changed) await kvPutJSON(env, 'alerts', alerts);

  // 促銷自動搜尋已停用（改為前端手動連結）；/api/promos?refresh=1 仍可手動觸發
  await kvPutJSON(env, 'last_cron', { at: Date.now(), report });
  return report;
}

// ───────────────────────── Router ─────────────────────────

async function fdHandle(request, env, prefix) {
  const url = new URL(request.url);
  let path = url.pathname;
  if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length);
  if (!path.startsWith('/')) path = '/' + path;
  const q = url.searchParams;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: fdCors(env) });

  try {
    if (path === '/api/health') {
      return fdJson(env, {
        ok: true, kv: !!env.FLIGHT_KV,
        tp: !!env.TP_TOKEN, duffel: !!env.DUFFEL_TOKEN, claude: !!env.ANTHROPIC_API_KEY,
        line: !!(env.LINE_CHANNEL_TOKEN && env.LINE_USER_ID),
        lastCron: await kvGetJSON(env, 'last_cron'),
      });
    }

    if (path === '/api/agg') {
      const o = (q.get('o') || '').toUpperCase(), d = (q.get('d') || '').toUpperCase();
      if (!o || !d) return fdErr(env, '缺 o / d');
      const month = q.get('m') || nextMonths(1)[0];
      const rt = q.get('rt') !== '0';
      return fdJson(env, await aggRoute(env, o, d, month, rt));
    }

    if (path === '/api/calendar') {
      const o = (q.get('o') || '').toUpperCase(), d = (q.get('d') || '').toUpperCase();
      if (!o || !d) return fdErr(env, '缺 o / d');
      const month = q.get('m') || nextMonths(1)[0];
      const rt = q.get('rt') !== '0';
      return fdJson(env, await aggCalendar(env, o, d, month, rt));
    }

    if (path === '/api/live') {
      const o = (q.get('o') || '').toUpperCase(), d = (q.get('d') || '').toUpperCase();
      const dep = q.get('dep'), ret = q.get('ret') || null;
      if (!o || !d || !dep) return fdErr(env, '缺 o / d / dep');
      return fdJson(env, await liveSearch(env, o, d, dep, ret, parseInt(q.get('adults') || '1', 10)));
    }

    if (path === '/api/promos') {
      return fdJson(env, await getPromos(env, q.get('refresh') === '1'));
    }

    if (path === '/api/alerts') {
      if (request.method === 'GET') return fdJson(env, { ok: true, alerts: await getAlerts(env) });
      if (request.method === 'POST') {
        const body = await request.json();
        const alerts = await getAlerts(env);
        const a = {
          id: body.id || (await sha1(Date.now() + Math.random().toString())),
          origin: String(body.origin || '').toUpperCase(),
          destination: String(body.destination || '').toUpperCase(),
          months: Array.isArray(body.months) ? body.months : [],
          maxPrice: parseInt(body.maxPrice, 10) || 0,
          roundTrip: body.roundTrip !== false,
          enabled: body.enabled !== false,
          created: Date.now(),
        };
        if (!a.origin || !a.destination || !a.maxPrice) return fdErr(env, '缺 origin / destination / maxPrice');
        const idx = alerts.findIndex(x => x.id === a.id);
        if (idx >= 0) alerts[idx] = Object.assign(alerts[idx], a); else alerts.push(a);
        await kvPutJSON(env, 'alerts', alerts);
        return fdJson(env, { ok: true, alerts });
      }
      if (request.method === 'DELETE') {
        const id = q.get('id');
        const alerts = (await getAlerts(env)).filter(x => x.id !== id);
        await kvPutJSON(env, 'alerts', alerts);
        return fdJson(env, { ok: true, alerts });
      }
    }

    if (path === '/api/sources') {
      if (request.method === 'GET') return fdJson(env, { ok: true, sources: await getLearnedSources(env) });
      if (request.method === 'POST') {
        const body = await request.json();
        const url = String(body.url || '').trim();
        if (!/^https?:\/\//.test(url)) return fdErr(env, '網址格式不對');
        const ls = await getLearnedSources(env);
        const cur = ls[url] || { airlines: [], hits: 0, fails: 0, added: Date.now() };
        cur.manual = true; cur.lastSeen = Date.now();
        (Array.isArray(body.airlines) ? body.airlines : String(body.airlines || '').split(/[,\s]+/)).filter(Boolean).forEach(c => { c = c.toUpperCase(); if (cur.airlines.indexOf(c) < 0) cur.airlines.push(c); });
        ls[url] = cur;
        await kvPutJSON(env, 'learned_sources', ls);
        return fdJson(env, { ok: true, sources: ls });
      }
      if (request.method === 'DELETE') {
        const url = q.get('url');
        const ls = await getLearnedSources(env);
        delete ls[url];
        await kvPutJSON(env, 'learned_sources', ls);
        return fdJson(env, { ok: true, sources: ls });
      }
    }

    if (path === '/api/run-alerts') {
      // 手動觸發 Cron 邏輯（測試用）
      return fdJson(env, { ok: true, report: await runFlightAlerts(env) });
    }

    if (path === '/api/line-test') {
      return fdJson(env, { ok: await linePush(env, '✈️ flight-deals LINE 測試訊息') });
    }

    return null; // 沒對到路由
  } catch (e) {
    return fdErr(env, String(e.message || e), 500);
  }
}

// 供 arcar 掛載：路徑不符時回 null
async function mountFlightDeals(request, env, prefix) {
  const url = new URL(request.url);
  if (prefix && !url.pathname.startsWith(prefix)) return null;
  return fdHandle(request, env, prefix || '');
}

// arcar 的 Cron 每分鐘跑；機票比價 + 促銷抓取一天一次
async function runFlightAlertsGated(env) {
  if (!env.FLIGHT_KV) return;
  var last = await kvGetJSON(env, 'last_cron');
  if (last && Date.now() - last.at < 24 * 3600 * 1000) return;
  await kvPutJSON(env, 'last_cron', { at: Date.now(), report: ['running'] }); // 先佔位，避免同分鐘重複跑
  await runFlightAlerts(env);
}

// ═══════════════════════════════════════════════════════════════
//  v14 — /tts 旁白語音（早安卡片有聲影片）
//  POST /tts {text, voice:'female|female2|male', rate:-10}
//  引擎：微軟翻譯端點 Azure 台灣腔（免金鑰）→ Edge 台灣腔（免金鑰）→ Google Cloud TTS cmn-TW（GOOGLE_TTS_KEY）→ Gemini TTS（GEMINI_API_KEY）
// ═══════════════════════════════════════════════════════════════

const TTS_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Expose-Headers': 'X-TTS-Engine',
};

const TTS_VOICES = {
  female:  { edge: 'zh-TW-HsiaoChenNeural', google: 'cmn-TW-Wavenet-A', gemini: 'Kore' },
  female2: { edge: 'zh-TW-HsiaoYuNeural',   google: 'cmn-TW-Wavenet-A', gemini: 'Leda' },
  male:    { edge: 'zh-TW-YunJheNeural',    google: 'cmn-TW-Wavenet-B', gemini: 'Charon' },
};

async function handleTTS(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: TTS_CORS });
  if (request.method !== 'POST') return ttsJson({ error: 'POST only' }, 405);

  let body;
  try { body = await request.json(); } catch (e) { return ttsJson({ error: 'bad json' }, 400); }
  const text = String(body.text || '').trim().slice(0, 300);
  if (!text) return ttsJson({ error: 'empty text' }, 400);
  const v = TTS_VOICES[body.voice] || TTS_VOICES.female;
  const rate = Math.max(-50, Math.min(50, parseInt(body.rate, 10) || 0)); // 百分比

  const errors = [];
  const engines = [
    ['mstrans', () => msTransTTS(text, v.edge, rate)],
    ['edge',   () => edgeTTS(text, v.edge, rate)],
    ['google', () => env.GOOGLE_TTS_KEY ? googleTTS(text, v.google, rate, env.GOOGLE_TTS_KEY) : null],
    ['gemini', () => env.GEMINI_API_KEY ? geminiTTS(text, v.gemini, env.GEMINI_API_KEY) : null],
  ];
  for (const [name, fn] of engines) {
    try {
      const out = await fn();
      if (!out) { errors.push(name + ': no key'); continue; }
      return new Response(out.bytes, {
        headers: { ...TTS_CORS, 'Content-Type': out.mime, 'X-TTS-Engine': name, 'Cache-Control': 'no-store' },
      });
    } catch (e) {
      errors.push(name + ': ' + (e && e.message || e));
    }
  }
  return ttsJson({ error: 'all engines failed', detail: errors }, 502);
}

function ttsJson(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { ...TTS_CORS, 'Content-Type': 'application/json' } });
}

function ttsEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ── 0. 微軟翻譯 App 端點換 token → Azure 語音 REST（同一批台灣 Neural 聲音，免金鑰）──
const MST_KEY_B64 = 'oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==';
let mstCache = null; // { r, t, exp }

async function mstSign(urlStr) {
  const enc = encodeURIComponent(urlStr.split('://')[1]).toLowerCase();
  const id = crypto.randomUUID().replace(/-/g, '');
  const dt = new Date().toUTCString().replace(/GMT$/, '').trim() + 'GMT';
  const msg = ('MSTranslatorAndroidApp' + enc + dt + id).toLowerCase();
  const key = await crypto.subtle.importKey('raw', ttsB64(MST_KEY_B64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
  let bin = ''; for (const b of sig) bin += String.fromCharCode(b);
  return 'MSTranslatorAndroidApp::' + btoa(bin) + '::' + dt + '::' + id;
}

async function mstToken() {
  if (mstCache && mstCache.exp > Date.now()) return mstCache;
  const url = 'https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0';
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept-Language': 'zh-Hant',
      'X-ClientVersion': '4.0.530a 5fe1dc6c',
      'X-UserId': '0f04d16a175c411e',
      'X-HomeGeographicRegion': 'zh-Hant-TW',
      'X-ClientTraceId': crypto.randomUUID(),
      'X-MT-Signature': await mstSign(url),
      'User-Agent': 'okhttp/4.5.0',
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': '0',
    },
  });
  if (!r.ok) throw new Error('endpoint HTTP ' + r.status);
  const d = await r.json();
  if (!d.r || !d.t) throw new Error('endpoint no token');
  mstCache = { r: d.r, t: d.t, exp: Date.now() + 8 * 60 * 1000 };
  return mstCache;
}

async function msTransTTS(text, voice, rate) {
  const tk = await mstToken();
  const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-TW'>"
    + "<voice name='" + voice + "'><prosody rate='" + (rate >= 0 ? '+' : '') + rate + "%' pitch='+0Hz'>"
    + ttsEscape(text) + '</prosody></voice></speak>';
  const r = await fetch('https://' + tk.r + '.tts.speech.microsoft.com/cognitiveservices/v1', {
    method: 'POST',
    headers: {
      'Authorization': tk.t,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'okhttp/4.5.0',
    },
    body: ssml,
  });
  if (!r.ok) { if (r.status === 401) mstCache = null; throw new Error('tts HTTP ' + r.status); }
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length < 500) throw new Error('audio too short');
  return { bytes, mime: 'audio/mpeg' };
}

// ── 1. Edge 線上語音（與 edge-tts 同一個端點）──
const EDGE_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_CHROMIUM = '130.0.2849.68';

let edgeSkew = 0; // 與微軟伺服器的時間差（秒）
async function edgeSecMsGec() {
  let sec = Math.floor(Date.now() / 1000 + edgeSkew) + 11644473600; // 秒，自 1601-01-01
  sec -= sec % 300;
  const ticks = (BigInt(sec) * 10000000n).toString();
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticks + EDGE_TOKEN));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function edgeHex(n) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function edgeConnect() {
  const url = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1'
    + '?TrustedClientToken=' + EDGE_TOKEN
    + '&Sec-MS-GEC=' + (await edgeSecMsGec())
    + '&Sec-MS-GEC-Version=1-' + EDGE_CHROMIUM
    + '&ConnectionId=' + edgeHex(16);
  const major = EDGE_CHROMIUM.split('.')[0];
  return fetch(url, {
    headers: {
      'Upgrade': 'websocket',
      'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/'
        + major + '.0.0.0 Safari/537.36 Edg/' + major + '.0.0.0',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cookie': 'muid=' + edgeHex(16).toUpperCase() + ';',
    },
  });
}

async function edgeTTS(text, voice, rate) {
  let resp = await edgeConnect();
  if (!resp.webSocket && resp.status === 403) {
    // 跟 edge-tts 一樣：用伺服器 Date 校正時間差後重試一次
    const d = Date.parse(resp.headers.get('Date') || '');
    if (d) { edgeSkew = (d - Date.now()) / 1000; resp = await edgeConnect(); }
  }
  const ws = resp.webSocket;
  if (!ws) throw new Error('no websocket (HTTP ' + resp.status + ')');
  ws.accept();

  const chunks = [];
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('timeout')); }, 15000);
    ws.addEventListener('message', ev => {
      if (typeof ev.data === 'string') {
        if (ev.data.includes('Path:turn.end')) { clearTimeout(timer); try { ws.close(); } catch (e) {} resolve(); }
        return;
      }
      const b = new Uint8Array(ev.data);
      if (b.length < 2) return;
      const hLen = (b[0] << 8) | b[1];
      const head = new TextDecoder().decode(b.subarray(2, 2 + hLen));
      if (head.includes('Path:audio')) chunks.push(b.slice(2 + hLen));
    });
    ws.addEventListener('close', () => { clearTimeout(timer); resolve(); });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('ws error')); });
  });

  const ts = new Date().toString();
  ws.send('X-Timestamp:' + ts + '\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n'
    + '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},'
    + '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}');
  const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-TW'>"
    + "<voice name='" + voice + "'><prosody pitch='+0Hz' rate='" + (rate >= 0 ? '+' : '') + rate + "%' volume='+0%'>"
    + ttsEscape(text) + '</prosody></voice></speak>';
  ws.send('X-RequestId:' + edgeHex(16) + '\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:' + ts + 'Z\r\nPath:ssml\r\n\r\n' + ssml);

  await done;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  if (!total) throw new Error('no audio');
  const out = new Uint8Array(total);
  let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return { bytes: out, mime: 'audio/mpeg' };
}

// ── 2. Google Cloud TTS（cmn-TW 台灣華語）──
async function googleTTS(text, voice, rate, key) {
  const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: 'cmn-TW', name: voice },
      audioConfig: { audioEncoding: 'MP3', speakingRate: 1 + rate / 100 },
    }),
  });
  const d = await r.json();
  if (!d.audioContent) throw new Error((d.error && d.error.message) || 'no audioContent');
  return { bytes: ttsB64(d.audioContent), mime: 'audio/mpeg' };
}

// ── 3. Gemini TTS（回傳 24kHz PCM，包成 WAV）──
async function geminiTTS(text, voice, key) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=' + key, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: '用溫暖親切的台灣國語語氣朗讀：' + text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  });
  const d = await r.json();
  const part = d.candidates && d.candidates[0] && d.candidates[0].content.parts.find(p => p.inlineData);
  if (!part) throw new Error((d.error && d.error.message) || 'no audio');
  return { bytes: ttsWav(ttsB64(part.inlineData.data), 24000), mime: 'audio/wav' };
}

function ttsB64(s) {
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function ttsWav(pcm, rate) {
  const buf = new ArrayBuffer(44 + pcm.length); const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, pcm.length, true);
  new Uint8Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

/* ════════════════════════════════════════════════════════════════
 * 齊聲祝福 雲端共錄（v15 新增；v16 加 /blessing/g/:id 祝福卡分享頁、打字旁白標記 X-Tts）— 路由 /blessing/*，KV 綁定 BLESSING_KV
 * 前端：kftseng2oo1.github.io/blessing ；原始模組：kftseng2oo1/blessing worker/blessing-worker.js
 * 旁白配音沿用 arcar 既有的 /tts
 * 名稱都加 bl / BL_ 前綴，避免和 arcar 的 err / ok 等撞名
 * ════════════════════════════════════════════════════════════════ */
const BL_OCCS = ['birthday', 'mother', 'father', 'elder', 'newyear', 'midautumn', 'travel', 'custom'];
const BL_MAX_CLIP = 6 * 1024 * 1024;
const BL_MAX_PHOTO = 2 * 1024 * 1024;
const BL_MAX_CLIPS = 80;
const BL_ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';

const BLESSING_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Key,X-Token,X-Name,X-Note,X-Dur,X-Tts',
  'Access-Control-Max-Age': '86400'
};

function withBlessingCors(res) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(BLESSING_CORS)) r.headers.set(k, v);
  return r;
}

function blRid(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (const x of b) s += BL_ALPHA[x % BL_ALPHA.length];
  return s;
}
async function blSha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const blJson = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const blErr = (m, st = 400) => blJson({ error: m }, st);
const blStr = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const blDec = (req, h) => { try { return decodeURIComponent(req.headers.get(h) || ''); } catch (e) { return ''; } };

function blCleanMeta(b) {
  return {
    occ: BL_OCCS.includes(b.occ) ? b.occ : 'custom',
    to: blStr(b.to, 40),
    title: blStr(b.title, 60) || '我們的祝福',
    date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : ''
  };
}

async function blListClips(kv, id) {
  const out = [];
  const pre = 'c:' + id + ':';
  let cursor;
  do {
    const r = await kv.list({ prefix: pre, cursor });
    for (const k of r.keys) {
      const m = k.metadata || {};
      out.push({ id: k.name.slice(pre.length), name: m.n || '匿名', note: m.o || '', dur: m.d || 0, mime: m.m || 'audio/mp4', t: m.t || 0, tts: m.v || '' });
    }
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}

async function blIsOwner(req, a) {
  const k = req.headers.get('X-Key');
  return !!k && (await blSha(k)) === a.kh;
}

async function handleBlessing(req, env, path) {
  const kv = env.BLESSING_KV;
  if (!kv) return blErr('BLESSING_KV 尚未綁定', 500);
  const m = req.method;
  const seg = path.split('/').filter(Boolean);
  try {
    // 祝福卡分享頁：給 LINE 抓預覽圖（og:image = 封面），再轉到前端的收禮畫面
    if (seg[0] === 'g' && seg.length === 2 && m === 'GET') {
      const gid = seg[1];
      const graw = /^[a-z0-9]{6,16}$/.test(gid) ? await kv.get('a:' + gid) : null;
      const app = env.BLESSING_APP || 'https://kftseng2oo1.github.io/blessing/';
      if (!graw) return Response.redirect(app, 302);
      const g = JSON.parse(graw);
      const n = (await blListClips(kv, gid)).length;
      const origin = new URL(req.url).origin;
      const h = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const to = g.to ? (g.occ === 'travel' ? g.to : '給 ' + g.to) : '';
      const title = h(g.title + (to && g.occ !== 'travel' && g.title.indexOf(g.to) < 0 ? '・' + to : ''));
      const desc = h(n + ' 位親友錄了祝福' + (g.occ === 'travel' ? '，一起回味這趟旅程' : '給你') + '，點開來聽 🎙️');
      const img = g.photoVer ? origin + '/blessing/a/' + gid + '/photo?v=' + g.photoVer : app + 'icon-512.png';
      const dest = h(app + '?g=' + gid);
      const html = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>' + title + '</title>' +
        '<meta property="og:type" content="website"><meta property="og:site_name" content="齊聲祝福">' +
        '<meta property="og:title" content="' + title + '"><meta property="og:description" content="' + desc + '">' +
        '<meta property="og:image" content="' + h(img) + '"><meta name="twitter:card" content="summary_large_image">' +
        '<meta http-equiv="refresh" content="0;url=' + dest + '">' +
        '</head><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f6efe4">' +
        '<p>正在打開祝福…</p><p><a href="' + dest + '">沒有自動打開請點這裡</a></p>' +
        '<script>location.replace(' + JSON.stringify(app + '?g=' + gid) + ')</script></body></html>';
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
    }

    if (seg[0] !== 'a') return blErr('not found', 404);

    // 建立祝福冊
    if (seg.length === 1) {
      if (m !== 'POST') return blErr('method not allowed', 405);
      const b = await req.json().catch(() => ({}));
      const id = blRid(8), key = blRid(24), now = Date.now();
      const a = Object.assign({ id }, blCleanMeta(b), { kh: await blSha(key), order: [], photoVer: 0, createdAt: now, updatedAt: now });
      await kv.put('a:' + id, JSON.stringify(a));
      return blJson({ id, key });
    }

    const id = seg[1];
    if (!/^[a-z0-9]{6,16}$/.test(id)) return blErr('bad id');
    const raw = await kv.get('a:' + id);
    if (!raw) return blErr('album not found', 404);
    const a = JSON.parse(raw);
    const saveA = () => kv.put('a:' + id, JSON.stringify(a));

    if (seg.length === 2) {
      if (m === 'GET') {
        const clips = await blListClips(kv, id);
        const { kh, ...pub } = a;
        return blJson({ album: pub, clips });
      }
      if (m === 'PUT') {
        if (!(await blIsOwner(req, a))) return blErr('forbidden', 403);
        const b = await req.json().catch(() => ({}));
        Object.assign(a, blCleanMeta(Object.assign({}, a, b)));
        if (Array.isArray(b.order)) a.order = b.order.map(x => blStr(x, 24)).slice(0, BL_MAX_CLIPS);
        a.updatedAt = Date.now();
        await saveA();
        return blJson({ ok: true });
      }
      if (m === 'DELETE') {
        if (!(await blIsOwner(req, a))) return blErr('forbidden', 403);
        const clips = await blListClips(kv, id);
        await Promise.all(clips.flatMap(c => [kv.delete('c:' + id + ':' + c.id), kv.delete('t:' + id + ':' + c.id)]));
        await kv.delete('p:' + id);
        await kv.delete('a:' + id);
        return blJson({ ok: true });
      }
      return blErr('method not allowed', 405);
    }

    if (seg[2] === 'photo' && seg.length === 3) {
      if (m === 'GET') {
        const p = await kv.get('p:' + id, { type: 'arrayBuffer' });
        if (!p) return blErr('no photo', 404);
        return new Response(p, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' } });
      }
      if (m === 'PUT') {
        if (!(await blIsOwner(req, a))) return blErr('forbidden', 403);
        const buf = await req.arrayBuffer();
        if (!buf.byteLength || buf.byteLength > BL_MAX_PHOTO) return blErr('照片太大或是空的', 413);
        await kv.put('p:' + id, buf);
        a.photoVer = a.updatedAt = Date.now();
        await saveA();
        return blJson({ photoVer: a.photoVer });
      }
      return blErr('method not allowed', 405);
    }

    if (seg[2] === 'c') {
      // 上傳錄音
      if (seg.length === 3) {
        if (m !== 'POST') return blErr('method not allowed', 405);
        const buf = await req.arrayBuffer();
        if (!buf.byteLength) return blErr('沒有錄到聲音');
        if (buf.byteLength > BL_MAX_CLIP) return blErr('錄音太大', 413);
        if ((await blListClips(kv, id)).length >= BL_MAX_CLIPS) return blErr('這本祝福冊已經滿了', 409);
        const now = Date.now(), cid = now.toString(36) + blRid(4), token = blRid(20);
        const meta = {
          n: blStr(blDec(req, 'X-Name'), 30) || '匿名',
          o: blStr(blDec(req, 'X-Note'), 180),
          d: Math.min(600, Math.max(0, parseFloat(req.headers.get('X-Dur')) || 0)),
          m: blStr((req.headers.get('Content-Type') || 'audio/mp4').split(';')[0], 40),
          t: now
        };
        const tv = req.headers.get('X-Tts');                 // 打字＋旁白配音的片段
        if (['female', 'female2', 'male'].includes(tv)) meta.v = tv;
        while (new TextEncoder().encode(JSON.stringify(meta)).length > 1000 && meta.o) meta.o = meta.o.slice(0, -10);
        await kv.put('c:' + id + ':' + cid, buf, { metadata: meta });
        await kv.put('t:' + id + ':' + cid, await blSha(token));
        return blJson({ id: cid, token, t: now });
      }

      const cid = seg[3];
      if (seg.length === 4 && /^[a-z0-9]{6,24}$/.test(cid)) {
        const key = 'c:' + id + ':' + cid;
        if (m === 'GET') {
          const r = await kv.getWithMetadata(key, { type: 'arrayBuffer' });
          if (!r.value) return blErr('clip not found', 404);
          return new Response(r.value, { headers: {
            'Content-Type': (r.metadata && r.metadata.m) || 'audio/mp4',
            'Cache-Control': 'public, max-age=31536000, immutable'
          } });
        }
        if (m === 'DELETE') {
          let ok = await blIsOwner(req, a);
          if (!ok) {
            const t = req.headers.get('X-Token');
            const h = t ? await kv.get('t:' + id + ':' + cid) : null;
            ok = !!(h && h === (await blSha(t)));
          }
          if (!ok) return blErr('只能刪除自己錄的聲音', 403);
          await kv.delete(key);
          await kv.delete('t:' + id + ':' + cid);
          if (a.order.includes(cid)) { a.order = a.order.filter(x => x !== cid); await saveA(); }
          return blJson({ ok: true });
        }
        return blErr('method not allowed', 405);
      }
    }
    return blErr('not found', 404);
  } catch (e) {
    return blErr(String(e && e.message || e), 500);
  }
}

// =====================================================================
// 報平安 — arcar 內嵌版。需要 KV binding: SAFE_KV；專屬帳號另需 secret SAFE_LINE_TOKEN、SAFE_LINE_SECRET

const SAFE_TZ_MS = 8 * 3600 * 1000;          // Asia/Taipei，無日光節約
const SAFE_MAX_MEMBERS = 10;
const SAFE_SECOND_ALERT_MIN = 120;            // 過期限多久發第二次提醒

function safeNow() {
  const d = new Date(Date.now() + SAFE_TZ_MS);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), hm: iso.slice(11, 16), mins: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
function safeYesterday(date) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function safeMins(hm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hm || '');
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 600;
}
function safeJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
  });
}
// 有設 SAFE_LINE_TOKEN 就用專屬官方帳號（Jason Friend），否則沿用 arcar 的 LINE_CHANNEL_TOKEN（每日訊息）
function safeLineToken(env) { return env.SAFE_LINE_TOKEN || env.LINE_CHANNEL_TOKEN || env.LINE_CHANNEL_ACCESS_TOKEN || env.LINE_TOKEN; }

async function safePush(env, userIds, text) {
  // 回傳 { sent: 實際送達人數, failed: LINE 拒收（額度用完、token 錯誤等） }
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return { sent: 0, failed: false };
  const one = ids.length === 1;
  try {
    const r = await fetch('https://api.line.me/v2/bot/message/' + (one ? 'push' : 'multicast'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + safeLineToken(env) },
      body: JSON.stringify({ to: one ? ids[0] : ids, messages: [{ type: 'text', text }] }),
    });
    if (!r.ok) {
      console.log('safePush failed', r.status, await r.text().catch(() => ''));
      return { sent: 0, failed: true, status: r.status };
    }
    return { sent: ids.length, failed: false };
  } catch (e) {
    console.log('safePush error', e && e.message);
    return { sent: 0, failed: true };
  }
}
async function safeReply(env, replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + safeLineToken(env) },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
}
async function safeProfileName(env, userId) {
  try {
    const r = await fetch('https://api.line.me/v2/bot/profile/' + userId, {
      headers: { Authorization: 'Bearer ' + safeLineToken(env) },
    });
    if (r.ok) return (await r.json()).displayName || '家人';
  } catch (e) {}
  return '家人';
}

async function safeGet(env, code) {
  const s = await env.SAFE_KV.get('circle:' + code);
  return s ? JSON.parse(s) : null;
}
async function safePut(env, c) { await env.SAFE_KV.put('circle:' + c.code, JSON.stringify(c)); }
async function safeIndex(env) { return JSON.parse((await env.SAFE_KV.get('safe:index')) || '[]'); }

function safeRandomCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(100000 + (a[0] % 900000));
}
function safeRandomToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeView(c) {
  const n = safeNow();
  return {
    ok: true,
    name: c.name,
    deadline: c.deadline,
    members: c.members.map(m => m.name),
    lastDate: c.lastDate,
    lastTime: c.lastTime,
    streak: c.lastDate === n.date || c.lastDate === safeYesterday(n.date) ? c.streak : 0,
    today: n.date,
    checkedToday: c.lastDate === n.date,
  };
}
function safeCleanName(s) { return String(s || '').trim().slice(0, 10) || '家人'; }
function safeCleanDeadline(s) {
  const m = safeMins(s);
  return /^\d{2}:\d{2}$/.test(s || '') && m >= 360 && m <= 1200 ? s : '10:00';   // 06:00–20:00
}

// ---------------- HTTP ----------------
async function handleSafe(request, env, ctx) {
  if (request.method === 'OPTIONS') return safeJson({ ok: true });
  if (!env.SAFE_KV) return safeJson({ ok: false, error: 'SAFE_KV 尚未綁定' }, 500);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/safe/, '') || '/';
  // 專屬官方帳號的 webhook：LINE Developers 設定 Webhook URL = https://arcar.kftseng2oo1.workers.dev/safe/webhook
  if (path === '/webhook') {
    if (request.method !== 'POST') return new Response('OK');
    const raw = await request.text();
    if (env.SAFE_LINE_SECRET) {
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SAFE_LINE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
      if (btoa(String.fromCharCode(...mac)) !== request.headers.get('x-line-signature')) return new Response('bad signature', { status: 401 });
    }
    let data = {};
    try { data = JSON.parse(raw); } catch (e) {}
    const work = (async () => {
      for (const ev of data.events || []) {
        try {
          if (await safeLineEvent(ev, env, true)) continue;
          if (await scamLineEvent(ev, env)) continue;          // v21：防詐查證（只處理一對一聊天）
          if (!ev.replyToken) continue;
          if (ev.type === 'follow') {
            await safeReply(env, ev.replyToken,
              '🌤️ 歡迎加入「報平安」\n\n🛡️ 防詐查證：收到可疑訊息，轉傳或截圖給我；接到可疑電話，把號碼傳給我\n\n👨‍👩‍👧 家人報平安：傳「平安 + 6 位數代碼」加入，例如：平安 123456\n查詢今天狀況：傳「平安狀態」\n\n也可以直接點下方選單 👇');
          }
        } catch (e) { console.log('safe webhook event error', e && e.message); }
      }
    })();
    if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;   // 先回 200 給 LINE，AI 在背景跑
    return new Response('OK');
  }

  let body = {};
  if (request.method === 'POST') { try { body = await request.json(); } catch (e) {} }

  if (path === '/create') {
    let code = '';
    for (let i = 0; i < 8; i++) {
      const t = safeRandomCode();
      if (!(await env.SAFE_KV.get('circle:' + t))) { code = t; break; }
    }
    if (!code) return safeJson({ ok: false, error: 'busy' }, 503);
    const c = {
      code, token: safeRandomToken(), name: safeCleanName(body.name), deadline: safeCleanDeadline(body.deadline),
      members: [], lastDate: null, lastTime: null, streak: 0, alerted: null, alerted2: null, helpAt: 0, createdAt: Date.now(),
    };
    await safePut(env, c);
    const idx = await safeIndex(env);
    idx.push(code);
    await env.SAFE_KV.put('safe:index', JSON.stringify(idx));
    return safeJson({ ok: true, code, token: c.token, ...safeView(c) });
  }

  const c = await safeGet(env, String(body.code || ''));
  if (!c || c.token !== body.token) return safeJson({ ok: false, error: 'auth' }, 403);
  const ids = c.members.map(m => m.userId);

  if (path === '/status') return safeJson(safeView(c));

  if (path === '/update') {
    if (body.name !== undefined) c.name = safeCleanName(body.name);
    if (body.deadline !== undefined) c.deadline = safeCleanDeadline(body.deadline);
    await safePut(env, c);
    return safeJson(safeView(c));
  }

  if (path === '/checkin') {
    const n = safeNow();
    if (c.lastDate === n.date) return safeJson({ ...safeView(c), already: true });   // 長輩重複按，不重複吵家人
    c.streak = c.lastDate === safeYesterday(n.date) ? (c.streak || 0) + 1 : 1;
    const late = c.alerted === n.date;
    c.lastDate = n.date;
    c.lastTime = n.hm;
    await safePut(env, c);
    const text = late
      ? `✅ ${c.name} 剛剛 ${n.hm} 報平安了，可以放心了。`
      : `🌤️ ${c.name} 今天 ${n.hm} 報平安：我很好！` + (c.streak > 1 ? `\n已連續 ${c.streak} 天 🌱` : '');
    const p = await safePush(env, ids, text);
    return safeJson({ ...safeView(c), sent: p.sent, pushFailed: p.failed });
  }

  if (path === '/help') {
    if (!ids.length) return safeJson({ ...safeView(c), sent: 0, noFamily: true });
    if (Date.now() - (c.helpAt || 0) < 3 * 60 * 1000) return safeJson({ ...safeView(c), throttled: true });
    const p = await safePush(env, ids, `🆘 ${c.name} 按了「我需要幫忙」（${safeNow().hm}）\n請盡快打電話給${c.name}！`);
    if (p.sent) { c.helpAt = Date.now(); await safePut(env, c); }   // 送失敗不進冷卻，可以馬上再按
    return safeJson({ ...safeView(c), sent: p.sent, pushFailed: p.failed });
  }

  return safeJson({ ok: false, error: 'not_found' }, 404);
}

// ---------------- LINE webhook ----------------
// 家人傳：「平安 123456」加入、「取消平安 123456」退出、「平安狀態」查詢
async function safeLineEvent(event, env, fromSafeWebhook) {
  if (!env.SAFE_KV) return false;
  if (env.SAFE_LINE_TOKEN && !fromSafeWebhook) return false;   // 已搬到專屬帳號：每日訊息那邊不再處理
  if (!event || event.type !== 'message' || !event.message || event.message.type !== 'text') return false;
  const text = event.message.text.trim().replace(/\s+/g, ' ');
  const uid = event.source && event.source.userId;
  if (!uid) return false;

  let m = /^平安 ?(\d{6})$/.exec(text);
  if (m) {
    const c = await safeGet(env, m[1]);
    if (!c) { await safeReply(env, event.replyToken, '找不到這個代碼，請再確認一次 6 位數字 🙏'); return true; }
    if (c.members.some(x => x.userId === uid)) {
      await safeReply(env, event.replyToken, `你已經在「${c.name}」的報平安通知裡了 😊`);
      return true;
    }
    if (c.members.length >= SAFE_MAX_MEMBERS) { await safeReply(env, event.replyToken, '這個群組人數已滿（10 人）。'); return true; }
    const name = await safeProfileName(env, uid);
    const others = c.members.map(x => x.userId);
    c.members.push({ userId: uid, name });
    await safePut(env, c);
    await safeReply(env, event.replyToken,
      `已加入「${c.name}」的報平安通知 ✅\n每天${c.name}報平安時你會收到訊息；若到 ${c.deadline} 還沒報，也會提醒你。\n\n查詢：傳「平安狀態」\n退出：傳「取消平安 ${c.code}」`);
    await safePush(env, others, `👋 ${name} 也加入了「${c.name}」的報平安通知。`);
    return true;
  }

  m = /^取消平安 ?(\d{6})$/.exec(text);
  if (m) {
    const c = await safeGet(env, m[1]);
    if (c && c.members.some(x => x.userId === uid)) {
      c.members = c.members.filter(x => x.userId !== uid);
      await safePut(env, c);
      await safeReply(env, event.replyToken, `已退出「${c.name}」的報平安通知。`);
    } else {
      await safeReply(env, event.replyToken, '你不在這個報平安群組裡。');
    }
    return true;
  }

  if (text === '平安狀態') {
    const n = safeNow();
    const lines = [];
    for (const code of await safeIndex(env)) {
      const c = await safeGet(env, code);
      if (!c || !c.members.some(x => x.userId === uid)) continue;
      lines.push(c.lastDate === n.date
        ? `✅ ${c.name}：今天 ${c.lastTime} 已報平安`
        : `⏳ ${c.name}：今天還沒報（期限 ${c.deadline}）`);
    }
    await safeReply(env, event.replyToken, lines.length ? lines.join('\n') : '你還沒有加入任何報平安群組。\n請傳「平安 + 6 位數代碼」加入。');
    return true;
  }
  return false;
}

// ---------------- Cron ----------------
async function safeCron(env) {
  if (!env.SAFE_KV) return;
  const n = safeNow();
  if (n.mins % 5 !== 0) return;   // arcar 每分鐘觸發，這裡每 5 分鐘查一次，省 KV 讀取
  for (const code of await safeIndex(env)) {
    const c = await safeGet(env, code);
    if (!c || !c.members.length || c.lastDate === n.date) continue;
    const dl = safeMins(c.deadline);
    const ids = c.members.map(x => x.userId);
    if (n.mins >= dl && c.alerted !== n.date) {
      c.alerted = n.date;
      await safePut(env, c);
      await safePush(env, ids, `⚠️ 今天到 ${c.deadline} 還沒收到${c.name}的平安回報。\n可能只是忘了按，方便的話打個電話關心一下 📞`);
    } else if (n.mins >= dl + SAFE_SECOND_ALERT_MIN && c.alerted === n.date && c.alerted2 !== n.date) {
      c.alerted2 = n.date;
      await safePut(env, c);
      await safePush(env, ids, `❗ ${c.name}到現在（${n.hm}）都還沒報平安，也可能聯絡不上。\n請務必打電話確認，或請鄰近的親友去看看。`);
    }
  }
}

// ══════════════════════════════════════════════════════════
// ── 防詐查證 /scam（v20 新增）─────────────────────────────
//   前端：kftseng2oo1.github.io/scam
//   POST { text, image(base64 jpeg|null) } → { level, summary, reasons[], advice }
//   不寫 KV、不留存訊息內容；失敗回非 2xx，前端改用本機規則比對
// ══════════════════════════════════════════════════════════
const SCAM_MODEL = 'claude-haiku-5-5';   // 想更準可改 'claude-sonnet-5-5'

const SCAM_SYSTEM = `你是台灣的反詐騙查證助理，使用者多半是長輩。請判斷使用者提供的訊息、電話、網址或截圖是否為詐騙。

只輸出一個 JSON 物件，不要任何其他文字：
{"level":"danger|suspicious|safe","summary":"一句話結論，15字內","reasons":["原因1","原因2"],"advice":"具體建議，40字內"}

判斷原則：
- danger：符合台灣常見詐騙手法，例如解除分期、假檢警監管帳戶、假投資／老師帶單、假親友借錢換號碼、要驗證碼或密碼、遊戲點數付款、假物流／假健保／假罰單／假欠費連結、假中獎退稅、假網拍、假交友要錢、偽冒政府但網址不是 .gov.tw。
- suspicious：有部分可疑跡象但無法確定，或資訊不足。
- safe：只有在內容明顯是一般生活訊息、且沒有要錢、要個資、要點連結、要加好友時才用。拿不準就選 suspicious。
- reasons 最多 3 點，每點 25 字內，用長輩聽得懂的白話，不用英文縮寫。
- advice 要具體可做：例如「不要點連結，打 165 確認」、「打舊號碼給本人確認」、「直接打銀行背面的客服電話」。
- 電話或網址若無法查證，請說明無法確認，並教對方自行用官方管道查詢。
- 若是【來電查證】：台灣國內來電不會顯示「+」；顯示 +886 或其他「+」開頭，代表經國際線路撥入，詐騙常用。光看號碼通常無法確定，主要依「對方說的內容」判斷；完全沒有內容時用 suspicious，並教使用者先掛掉、再自己撥官方電話確認。
- 不要要求使用者提供更多個資。`;

async function handleScam(request, env) {
  if (request.method !== 'POST') return err('POST only', 405);
  if (!env.ANTHROPIC_API_KEY) return err('ANTHROPIC_API_KEY not set', 500);
  var body;
  try { body = await request.json(); } catch (e) { return err('bad json'); }
  var text = String(body.text || '').slice(0, 4000);
  var image = typeof body.image === 'string' ? body.image : null;
  if (!text && !image) return err('empty');
  if (image && image.length > 2800000) return err('image too large', 413);

  try {
    return ok(await scamAnalyze(env, text, image, 'image/jpeg'));
  } catch (e) {
    return err('ai failed: ' + e.message, 502);
  }
}

// ══════════════════════════════════════════════════════════
// ── 防詐查證 × 報平安官方帳號（v21 新增）──────────────────
//   長輩把可疑訊息「轉傳」或截圖傳給報平安帳號 → 回覆判斷卡片
//   傳電話號碼 → 號碼判斷 ＋ 「對方說了什麼」快選 → AI 綜合判斷
//   一律用 reply（免費，不吃推播額度）；只處理一對一聊天，群組裡不會亂回
//   KV（SAFE_KV）：scamq:{uid}:{date} 每日次數（上限 SCAM_DAILY_MAX）、scamtel:{uid} 待補內容的號碼（10 分鐘）
// ══════════════════════════════════════════════════════════
const SCAM_DAILY_MAX = 30;
const SCAM_APP_URL = 'https://kftseng2oo1.github.io/scam/';
const SCAM_LV = {
  danger:     { title: '⛔ 很可能是詐騙', color: '#C62828' },
  suspicious: { title: '⚠️ 有點可疑',     color: '#B26A00' },
  unknown:    { title: '❔ 無法確定',     color: '#B26A00' },
  safe:       { title: '✅ 看起來沒問題', color: '#2E7D32' },
};
const SCAM_CHIPS = [
  '說我涉嫌犯罪、帳戶要監管', '要我解除分期或改設定', '自稱親友，急著借錢', '要我去 ATM 或匯款',
  '跟我要驗證碼或密碼', '報明牌、帶我投資', '說我中獎或可以退稅', '說包裹、健保卡或帳戶有問題', '是語音電話，要我按鍵',
];
const SCAM_HELP =
  '🛡️ 防詐查證怎麼用？\n\n' +
  '① 收到可疑的簡訊或 LINE 訊息：長按訊息 →「轉傳」給我，或直接傳截圖\n' +
  '② 接到可疑電話：把電話號碼傳給我\n\n' +
  '我會告訴你是不是詐騙。不確定時，先別匯款、別給驗證碼，打 165 問問看。';
const SCAM_TIPS =
  '🛡️ 記住這幾句，詐騙騙不到\n\n' +
  '1. 警察、檢察官、法院不會用電話叫你匯款或監管帳戶。\n' +
  '2.「解除分期」「設定錯誤」要你去 ATM，一定是詐騙。\n' +
  '3. 保證賺錢、老師帶你買股票、加群組投資，都是詐騙。\n' +
  '4. 親友說換新號碼又急著借錢，先打舊號碼確認。\n' +
  '5. 任何人要簡訊驗證碼、網銀密碼，不要給。\n' +
  '6. 有疑問就打 165 反詐騙專線，免費。';

// 「我要報警」卡片（v22）：110、附近警察局（開地圖用手機定位搜尋）、165
const SCAM_POLICE_MAP = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('警察局');
function scamPoliceFlex() {
  var btn = function (style, color, label, uri) {
    var b = { type: 'button', style: style, height: 'md', action: { type: 'uri', label: label, uri: uri } };
    if (color) b.color = color;
    return b;
  };
  return {
    type: 'flex', altText: '我要報警：撥打 110 或找附近警察局',
    contents: {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#1F4E9C', paddingAll: '18px', contents: [
        { type: 'text', text: '🚨 我要報警', color: '#FFFFFF', size: 'xl', weight: 'bold' },
        { type: 'text', text: '請選擇下面的方式', color: '#FFFFFF', size: 'md', margin: 'sm' },
      ] },
      body: { type: 'box', layout: 'vertical', paddingAll: '18px', contents: [
        { type: 'text', text: '・緊急狀況、正在被騙：直接撥 110', wrap: true, size: 'md', color: '#333333' },
        { type: 'text', text: '・已經匯款或轉帳：馬上打 110 或 165，並打給銀行請求止付', wrap: true, size: 'md', color: '#333333', margin: 'sm' },
        { type: 'text', text: '・要到派出所報案：按「附近的警察局」看地址和電話', wrap: true, size: 'md', color: '#333333', margin: 'sm' },
      ] },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: [
        btn('primary', '#C62828', '📞 撥打 110 報案', 'tel:110'),
        btn('primary', '#1F4E9C', '🗺️ 附近的警察局', SCAM_POLICE_MAP),
        btn('secondary', null, '📞 撥打 165 詐騙諮詢', 'tel:165'),
      ] },
    },
  };
}

// 共用：呼叫 AI 判斷（handleScam 與 LINE 都用這個）
async function scamAnalyze(env, text, image, mediaType) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  var content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: image } });
  content.push({ type: 'text', text: text ? '請查證以下內容：\n\n' + text : '請查證這張截圖的內容。' });
  var r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: SCAM_MODEL, max_tokens: 600, system: SCAM_SYSTEM, messages: [{ role: 'user', content: content }] })
  });
  if (!r.ok) throw new Error('anthropic ' + r.status);
  var data = await r.json();
  var raw = (data.content || []).map(function (c) { return c.text || ''; }).join('');
  var m = raw.match(/\{[\s\S]*\}/);
  var out = JSON.parse(m ? m[0] : raw);
  return {
    level: ['danger', 'suspicious', 'safe'].indexOf(out.level) > -1 ? out.level : 'suspicious',
    summary: String(out.summary || ''),
    reasons: Array.isArray(out.reasons) ? out.reasons.slice(0, 3).map(String) : [],
    advice: String(out.advice || '不確定時請打 165 反詐騙專線確認。')
  };
}

// 號碼本身的特徵（與前端 telCheck 相同規則）
function scamTelFlags(num) {
  var n = String(num).replace(/[\s\-()（）]/g, '');
  if (n === '165') return { is165: true, score: 0, why: [] };
  if (/^(\+|00)886/.test(n)) return { score: 4, why: ['號碼前面有「+886」，代表是從國外線路打進來，冒充台灣號碼'] };
  if (/^(\+|00)/.test(n)) return { score: 3, why: ['這是國外打來的電話'] };
  return { score: 0, why: [] };
}
function scamIsPhone(t) { return /^[+＋]?[\d\s\-()（）]{3,20}$/.test(t) && (t.match(/\d/g) || []).length >= 3; }

async function scamLineApi(env, path, body) {
  return fetch('https://api.line.me/v2/bot/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + safeLineToken(env) },
    body: JSON.stringify(body),
  });
}
async function scamReplyMsgs(env, replyToken, messages) {
  var r = await scamLineApi(env, 'message/reply', { replyToken: replyToken, messages: messages });
  if (!r.ok) console.log('scam reply failed', r.status, await r.text().catch(function () { return ''; }));
}
function scamQuick(items) {
  return { items: items.slice(0, 13).map(function (t) {
    return { type: 'action', action: { type: 'message', label: t.label.slice(0, 20), text: t.text } };
  }) };
}
function scamB64(buf) {
  var bytes = new Uint8Array(buf), s = '';
  for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// 判斷結果 → Flex 卡片（字放大，給長輩看）
function scamFlex(res, preview) {
  var lv = SCAM_LV[res.level] || SCAM_LV.unknown;
  var reasons = (res.reasons && res.reasons.length ? res.reasons : ['（沒有更多說明）']).map(function (t) {
    return { type: 'text', text: '・' + t, wrap: true, size: 'md', color: '#333333', margin: 'sm' };
  });
  var head = '【防詐查證】我收到這個，判斷「' + lv.title.replace(/^\S+\s/, '') + '」，可以幫我看看嗎？\n\n';
  var pv = String(preview || ''), shareUri;
  do {   // LINE 的 uri 上限 1000 字元，中文編碼後很長，逐步截短
    shareUri = 'https://line.me/R/msg/text/?' + encodeURIComponent(head + pv);
    pv = pv.length > 20 ? pv.slice(0, pv.length - 10) + '…' : '';
  } while (shareUri.length > 1000 && pv);
  return {
    type: 'flex', altText: '防詐查證：' + lv.title.replace(/^\S+\s/, '') + (res.summary ? '｜' + res.summary : ''),
    contents: {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: lv.color, paddingAll: '18px', contents: [
        { type: 'text', text: lv.title, color: '#FFFFFF', size: 'xl', weight: 'bold' },
        res.summary ? { type: 'text', text: res.summary, color: '#FFFFFF', size: 'md', wrap: true, margin: 'sm' } : { type: 'filler' },
      ] },
      body: { type: 'box', layout: 'vertical', paddingAll: '18px', contents: [
        { type: 'text', text: '為什麼？', weight: 'bold', size: 'md', color: '#111111' },
      ].concat(reasons, [
        { type: 'separator', margin: 'lg' },
        { type: 'text', text: '建議您這樣做', weight: 'bold', size: 'md', color: '#111111', margin: 'lg' },
        { type: 'text', text: res.advice || '不確定時請打 165 確認。', wrap: true, size: 'md', color: '#B3261E', weight: 'bold', margin: 'sm' },
        { type: 'text', text: res.local ? '手機內建比對，僅供參考' : '由 AI 判讀，僅供參考', size: 'xs', color: '#999999', margin: 'lg' },
      ]) },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '12px', contents: [
        { type: 'button', style: 'primary', color: '#C62828', height: 'md', action: { type: 'uri', label: '📞 撥打 165', uri: 'tel:165' } },
        { type: 'button', style: 'secondary', height: 'md', action: { type: 'uri', label: '💬 轉給家人看', uri: shareUri } },
      ] },
    },
  };
}

// 每人每日次數（保護 AI 費用）
async function scamQuota(env, uid) {
  var key = 'scamq:' + uid + ':' + safeNow().date;
  var n = parseInt((await env.SAFE_KV.get(key)) || '0', 10);
  if (n >= SCAM_DAILY_MAX) return false;
  await env.SAFE_KV.put(key, String(n + 1), { expirationTtl: 172800 });
  return true;
}

async function scamRun(env, ev, uid, text, image, mediaType, preview, telFlags) {
  if (!(await scamQuota(env, uid))) {
    await scamReplyMsgs(env, ev.replyToken, [{ type: 'text', text: '今天已經查很多次了 🙏 明天再來，或直接打 165 詢問。' }]);
    return;
  }
  try { await scamLineApi(env, 'chat/loading/start', { chatId: uid, loadingSeconds: 20 }); } catch (e) {}
  var res;
  try {
    res = await scamAnalyze(env, text, image, mediaType);
    if (telFlags && telFlags.score >= 2 && res.level === 'safe') { res.level = 'suspicious'; res.reasons.push(telFlags.why[0]); }
  } catch (e) {
    console.log('scamAnalyze', e && e.message);
    res = telFlags && telFlags.score
      ? { level: 'suspicious', summary: '這通電話有可疑的地方', reasons: telFlags.why, advice: '先掛掉，再自己撥打官方號碼確認。有疑問打 165。', local: true }
      : { level: 'unknown', summary: '系統忙碌，暫時無法判斷', reasons: ['請稍後再傳一次'], advice: '在確認之前，不要匯款、不要給驗證碼，可以先打 165 問問看。', local: true };
  }
  await scamReplyMsgs(env, ev.replyToken, [scamFlex(res, preview)]);
}

// 回傳 true 表示已處理
async function scamLineEvent(ev, env) {
  if (!env.SAFE_KV || !ev || !ev.replyToken) return false;
  if (!ev.source || ev.source.type !== 'user') return false;          // 群組／多人聊天不處理
  var uid = ev.source.userId;
  if (ev.type !== 'message' || !ev.message) return false;

  // 截圖
  if (ev.message.type === 'image') {
    var r = await fetch('https://api-data.line.me/v2/bot/message/' + ev.message.id + '/content', {
      headers: { Authorization: 'Bearer ' + safeLineToken(env) },
    });
    if (!r.ok) {
      await scamReplyMsgs(env, ev.replyToken, [{ type: 'text', text: '這張圖片打不開，請再傳一次 🙏' }]);
      return true;
    }
    var ct = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].indexOf(ct) < 0) ct = 'image/jpeg';
    var buf = await r.arrayBuffer();
    if (buf.byteLength > 4 * 1024 * 1024) {
      await scamReplyMsgs(env, ev.replyToken, [{ type: 'text', text: '圖片太大了，請截小一點再傳 🙏' }]);
      return true;
    }
    await scamRun(env, ev, uid, '', scamB64(buf), ct, '（一張截圖）');
    return true;
  }

  if (ev.message.type !== 'text') return false;
  var text = ev.message.text.trim();
  var plain = text.replace(/\s+/g, '');

  if (/^(查訊息|防詐查證|怎麼用|說明|help)$/i.test(plain)) {
    await scamReplyMsgs(env, ev.replyToken, [{ type: 'text', text: SCAM_HELP }]); return true;
  }
  if (plain === '防詐小知識') {
    await scamReplyMsgs(env, ev.replyToken, [{ type: 'text', text: SCAM_TIPS }]); return true;
  }
  if (/^(我要報警|報警|警察局)$/.test(plain)) {
    await scamReplyMsgs(env, ev.replyToken, [scamPoliceFlex()]); return true;
  }
  if (plain === '查電話') {
    await scamReplyMsgs(env, ev.replyToken, [{ type: 'text', text: '📞 請把打來的電話號碼傳給我\n例如：+886 912 345 678' }]); return true;
  }

  // 電話號碼
  if (scamIsPhone(text)) {
    var num = text.replace(/＋/g, '+');
    var f = scamTelFlags(num);
    if (num.replace(/[\s\-()（）]/g, '') === '110') {
      await scamReplyMsgs(env, ev.replyToken, [{ type: 'text', text: '✅ 110 是警察報案專線。\n\n若有人「自稱 110 或警察」打給你要你匯款、監管帳戶，那是假的，請掛掉後自己撥 110 確認。' }]);
      return true;
    }
    if (f.is165) {
      await scamReplyMsgs(env, ev.replyToken, [{ type: 'text', text: '✅ 165 是警政署反詐騙專線。\n\n如果是你打給 165 就沒問題；若有人「自稱 165」打給你要你匯款，那是假的。' }]);
      return true;
    }
    await env.SAFE_KV.put('scamtel:' + uid, num, { expirationTtl: 600 });
    var head = '📞 ' + num + '\n\n' + (f.why.length ? '⚠️ ' + f.why[0] : '光看號碼無法確定，詐騙集團常換號碼或假冒號碼。');
    var chips = SCAM_CHIPS.map(function (t) { return { label: t, text: '對方' + t }; });
    chips.push({ label: '沒說什麼，直接判斷', text: '對方沒說什麼' });
    await scamReplyMsgs(env, ev.replyToken, [{
      type: 'text', text: head + '\n\n對方在電話裡說了什麼？\n點下面的選項，或直接打字告訴我。',
      quickReply: scamQuick(chips),
    }]);
    return true;
  }

  // 剛查過號碼 → 這則當作「對方說的內容」
  var pending = await env.SAFE_KV.get('scamtel:' + uid);
  if (pending) {
    await env.SAFE_KV.delete('scamtel:' + uid);
    var said = /^對方沒說什麼$/.test(plain) ? '（沒有提供）' : text.replace(/^對方/, '');
    var tf = scamTelFlags(pending);
    await scamRun(env, ev, uid, '【來電查證】\n來電號碼：' + pending + '\n對方說的內容：' + said,
      null, null, '來電 ' + pending + '：' + said, tf);
    return true;
  }

  // 太短的打招呼 → 說明
  if (plain.length < 6) {
    await scamReplyMsgs(env, ev.replyToken, [{ type: 'text', text: SCAM_HELP }]); return true;
  }

  // 其他文字 → 當作可疑訊息查證
  await scamRun(env, ev, uid, text.slice(0, 4000), null, null, text);
  return true;
}

// ════════════════════════════════════════════════════════════════
// ★ v23 — 阿公說故事 AI 聲音（阿里雲 CosyVoice 聲音複製）
// POST /voice/clone   { audio: data URI, token }      → { voice_id }
// POST /voice/status  { voice_id, token }             → { status }  OK / DEPLOYING
// POST /voice/tts     { voice_id, text, token }       → audio/mpeg
// POST /voice/delete  { voice_id, token }             → { ok }
// Secrets：DASHSCOPE_API_KEY（必要）、VOICE_TOKEN（選用）
// Vars：DASHSCOPE_BASE（預設新加坡 dashscope-intl）、VOICE_MODEL（預設 cosyvoice-v3-plus）
// ════════════════════════════════════════════════════════════════

const VOICE_ALLOWED_ORIGINS = [
  'https://kftseng2oo1.github.io',
  'http://localhost',
  'http://127.0.0.1',
];
const VOICE_MAX_TEXT = 800;            // 每次合成最多字數（App 一段一段送）
const VOICE_MAX_AUDIO = 14 * 1024 * 1024; // data URI 長度上限（官方原檔 10 MB）

function voiceCors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Voice-Token',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function voiceJson(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...voiceCors(origin), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function dashscope(env, path, payload) {
  // DASHSCOPE_BASE 可直接貼控制台複製的 Base URL（不論後面是 /compatible-mode/v1 或其他路徑），只取網域再接 /api/v1
  let base = 'https://dashscope-intl.aliyuncs.com/api/v1';
  if (env.DASHSCOPE_BASE) {
    try { base = new URL(String(env.DASHSCOPE_BASE).trim()).origin + '/api/v1'; } catch (e) { /* 格式不對就用預設 */ }
  }
  const r = await fetch(base + path, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.DASHSCOPE_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); } catch (e) { d = { message: text.slice(0, 300) }; }
  if (!r.ok || d.code) {
    const err = new Error((d.code ? d.code + ': ' : '') + (d.message || ('DashScope HTTP ' + r.status)));
    err.status = r.status >= 400 && r.status < 500 ? 400 : 502;
    throw err;
  }
  return d;
}

async function handleVoice(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = VOICE_ALLOWED_ORIGINS.some((o) => origin === o || origin.startsWith(o + ':'));

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: voiceCors(allowed ? origin : '') });
  }
  // 被拒絕時也帶 CORS 標頭，App 才讀得到錯誤訊息（否則 Safari 只會顯示 Load failed）
  if (!allowed) return voiceJson({ error: '不允許的來源：' + (origin || '(無)') }, 403, '*');
  if (request.method !== 'POST') return voiceJson({ error: '只接受 POST' }, 405, origin);
  if (!env.DASHSCOPE_API_KEY) return voiceJson({ error: 'arcar 尚未設定 DASHSCOPE_API_KEY' }, 500, origin);

  const action = new URL(request.url).pathname.replace(/^\/voice\/?/, '').replace(/\/+$/, '');
  const model = env.VOICE_MODEL || 'cosyvoice-v3-plus';
  let body = {};
  try { body = await request.json(); } catch (e) { /* 空 body */ }

  // 通行碼放在 JSON 的 token 欄位（不用自訂標頭，避開 CORS 預檢問題）；舊版標頭也接受
  const token = body.token || request.headers.get('X-Voice-Token') || '';
  if (env.VOICE_TOKEN && token !== env.VOICE_TOKEN) {
    return voiceJson({ error: '通行碼不對' }, 401, origin);
  }

  try {
    if (action === 'clone') {
      const audio = String(body.audio || '');
      if (!/^data:audio\/[a-z0-9.+-]+;base64,/i.test(audio)) return voiceJson({ error: '樣本格式不對' }, 400, origin);
      if (audio.length > VOICE_MAX_AUDIO) return voiceJson({ error: '樣本太大，請錄 60 秒以內' }, 400, origin);
      const prefix = String(body.prefix || 'agong').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 9) || 'agong';
      const d = await dashscope(env, '/services/audio/tts/customization', {
        model: 'voice-enrollment',
        input: { action: 'create_voice', target_model: model, prefix, audio },
      });
      const voiceId = d.output && d.output.voice_id;
      if (!voiceId) return voiceJson({ error: '沒有拿到 voice_id' }, 502, origin);
      return voiceJson({ voice_id: voiceId, model }, 200, origin);
    }

    if (action === 'status') {
      if (!body.voice_id) return voiceJson({ error: '缺 voice_id' }, 400, origin);
      const d = await dashscope(env, '/services/audio/tts/customization', {
        model: 'voice-enrollment',
        input: { action: 'query_voice', voice_id: String(body.voice_id) },
      });
      return voiceJson({ status: (d.output && d.output.status) || 'UNKNOWN' }, 200, origin);
    }

    if (action === 'tts') {
      const text = String(body.text || '').trim();
      if (!body.voice_id) return voiceJson({ error: '缺 voice_id' }, 400, origin);
      if (!text) return voiceJson({ error: '沒有文字' }, 400, origin);
      if (text.length > VOICE_MAX_TEXT) return voiceJson({ error: '一次最多 ' + VOICE_MAX_TEXT + ' 字' }, 400, origin);
      const d = await dashscope(env, '/services/audio/tts/SpeechSynthesizer', {
        model,
        input: { text, voice: String(body.voice_id), format: 'mp3', sample_rate: 24000 },
      });
      const audioUrl = d.output && d.output.audio && d.output.audio.url;
      if (!audioUrl) return voiceJson({ error: '沒有拿到音檔' }, 502, origin);
      const a = await fetch(audioUrl);
      if (!a.ok) return voiceJson({ error: '下載音檔失敗' }, 502, origin);
      return new Response(a.body, {
        headers: { ...voiceCors(origin), 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' },
      });
    }

    if (action === 'delete') {
      if (!body.voice_id) return voiceJson({ error: '缺 voice_id' }, 400, origin);
      await dashscope(env, '/services/audio/tts/customization', {
        model: 'voice-enrollment',
        input: { action: 'delete_voice', voice_id: String(body.voice_id) },
      });
      return voiceJson({ ok: true }, 200, origin);
    }

    return voiceJson({ error: '沒有這個功能：' + action }, 404, origin);
  } catch (e) {
    return voiceJson({ error: e.message || String(e) }, e.status || 502, origin);
  }
}
