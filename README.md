# 阿公說故事 👴📖

阿公念故事給孫子聽的單檔 PWA。

- 📖 內建 8 個故事，大字提詞、一段一段念
- 🎙️ 邊念邊錄音，存在手機（IndexedDB）
- 🎧 播放錄音；🔗 上傳到 arcar 產生收聽連結，孫子用 LINE 點開就能聽
- ✨ AI 依主題現編新故事（經 arcar Worker）
- 🤖 阿公的 AI 聲音：錄 20 秒樣本，用阿里雲 CosyVoice 複製聲音，念新故事（雛形）
- ⚙️ 孫子名字、年紀、字體大小

## 🤖 AI 聲音後端（arcar /voice）

程式在 `worker/voice-route.js`，貼進 arcar 後：

1. fetch handler 加 `if (url.pathname.startsWith('/voice')) return handleVoice(request, env);`
2. `wrangler secret put DASHSCOPE_API_KEY`（阿里雲 Model Studio 國際版）
3. 選用：`VOICE_TOKEN`（App 設定頁填同一組）、`DASHSCOPE_BASE`、`VOICE_MODEL`（預設 cosyvoice-v3-plus）

| 路由 | 輸入 | 輸出 |
|---|---|---|
| POST /voice/clone | `{audio: data URI}` | `{voice_id}` |
| POST /voice/status | `{voice_id}` | `{status}` OK / DEPLOYING |
| POST /voice/tts | `{voice_id, text}` | audio/mpeg |
| POST /voice/delete | `{voice_id}` | `{ok}` |

線上版：https://kftseng2oo1.github.io/grandpa/

## 🔗 分享連結（arcar /story，v24）

程式在 `worker/story-route.js`，已合併在 `worker/arcar-worker_v24.js`。
KV 優先用 `STORY_KV`，沒綁就沿用 `BLESSING_KV`；上傳通行碼沿用 `VOICE_TOKEN`。

| 路由 | 說明 |
|---|---|
| POST /story | 上傳音檔 → `{id, key, url}` |
| GET /story/s/:id | 收聽頁（LINE 預覽卡片） |
| GET /story/a/:id | 音檔（支援 Range） |
| DELETE /story/:id | header `X-Key` 刪除 |
