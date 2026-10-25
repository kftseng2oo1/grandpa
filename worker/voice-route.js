/**
 * arcar /voice 路由 — 阿公說故事 AI 聲音（阿里雲 CosyVoice 聲音複製）
 *
 * 整合方式（貼進 arcar 的 Worker）：
 *   1. 把本檔的函式貼進 arcar（或 import { handleVoice } from './voice-route.js'）
 *   2. 在 fetch handler 的「最前面」加（一定要在 arcar 全域 OPTIONS / CORS 處理之前）：
 *        if (url.pathname.startsWith('/voice')) return handleVoice(request, env);
 *   3. 設定 secret：
 *        wrangler secret put DASHSCOPE_API_KEY      （阿里雲 Model Studio 國際版 API Key）
 *        wrangler secret put VOICE_TOKEN            （選用：App 設定頁要填同一組通行碼）
 *   4. 選用變數（vars）：
 *        DASHSCOPE_BASE  預設 https://dashscope-intl.aliyuncs.com/api/v1  （新加坡區）
 *        VOICE_MODEL     預設 cosyvoice-v3-plus（新加坡區另有 cosyvoice-v3-flash，較便宜）
 *
 * API（全部 POST JSON，有設 VOICE_TOKEN 時每個請求都要帶 token 欄位）：
 *   /voice/clone   { audio: "data:audio/wav;base64,...", prefix?: "agong" } → { voice_id }
 *   /voice/status  { voice_id }                                           → { status }  OK / DEPLOYING / 其他=失敗
 *   /voice/tts     { voice_id, text }                                     → audio/mpeg 音檔
 *   /voice/delete  { voice_id }                                           → { ok: true }
 *
 * 注意：複製出來的聲音綁定建立時的 VOICE_MODEL，之後換模型要重新建立。
 */

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
  const base = (env.DASHSCOPE_BASE || 'https://dashscope-intl.aliyuncs.com/api/v1').replace(/\/+$/, '');
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

export async function handleVoice(request, env) {
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
