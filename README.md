# Pi Local Decider

把小型分類、任務路由與候選選擇交給本機 `decider-0.8b`，讓 pi 主模型專注於寫程式與複雜推理。
提供 `decider_classify` 工具、`/decider` 指令及 `local-decider` skill。

## 安裝與使用

先啟動你的模型服務，確認它支援 OpenAI 相容的 `/v1/chat/completions` 與 JSON schema。
在執行模型服務的同一台電腦安裝這份 checkout：

```bash
git clone https://github.com/clown1007/skills.git
cd skills
pi install "$PWD"
pi
```

本地路徑安裝使用目前 checkout，推送重構前也能使用。若 pi 已開啟，執行 `/reload`。
套件無需 `npm install`，不會下載或啟動模型。重構推送到 GitHub 後，可用：

```bash
pi install git:github.com/clown1007/skills
```

不呼叫主模型，直接顯示本機路由結果：

```text
/decider 幫我修正 Python 的 import error
```

例如顯示 `coding · decider-0.8b · 120 ms`，實際結果與時間以你的模型為準。
指令不會執行任務或切換 pi 主模型。

讓 pi 在工作中使用本機判斷：

```text
/skill:local-decider 把以下客服訊息分類成 billing、bug、feature 或 other，再整理 bug 清單：……
```

也可以告訴 pi：「先用 decider_classify 分類，再處理需要寫程式的項目」。工具參數：

```json
{
  "inputs": ["登入出現 500 錯誤", "想更改付款方式"],
  "choices": ["billing", "bug", "feature", "other"],
  "instructions": "billing 是帳務或付款；bug 是功能故障；feature 是新增功能；other 是其他明確需求。"
}
```

最多 20 個輸入，以最多兩個並行的獨立請求處理，保留原始索引。
自動加入 `unknown` 表示沒有合適選項或證據不足。逐項回傳 `category`、`model`、
`elapsedMs`、可用的 server `usage`，或 `error`。未知或錯誤項目由主模型接手。
模型沒有提供信心分數，本套件也不會推算。

## CLI 與設定

不經 pi 主模型的批次分類：

```bash
printf '%s\n' '{"inputs":["fix a Python error","draft a reply"],"choices":["coding","writing"],"instructions":"Classify the task."}' \
  | node bin/local-decider.mjs
```

任一項失敗會以非零狀態退出，保留其他成功結果。
啟動 pi 或 CLI 前可設定：

```bash
export DECIDER_BASE_URL=http://127.0.0.1:8731/v1
export DECIDER_MODEL=decider-0.8b
export DECIDER_TIMEOUT_MS=15000
pi
```

以上是預設值。URL 是含 `/v1` 的 API 根路徑，不是完整 chat/completions URL。
逾時允許 1–120000 ms；工具取消會中止請求。`DECIDER_API_KEY` 可選，僅用於
需要 Bearer 驗證的服務，不要把金鑰提交到 Git。

`127.0.0.1` 指執行 pi 的機器，雲端或容器中的 pi 無法用此位址連到你的個人電腦。
請在本機執行 pi，或自行設定可達端點。套件只傳送指定的輸入與分類指示，不傳整段聊天；
自訂遠端 URL 會收到這些輸入。

## 限制與開發

適合短訊息分類、簡單故障分流與從已提供的候選中選擇。不適合長文生成、複雜推理、
授權判斷，或根據標籤直接執行重要操作。JSON 合法不代表分類正確，請用代表性資料驗證。
weather 範例缺少 weather 類別，應提供適合的選項或允許 `unknown`。

`/decider` 和 CLI 可省去簡單分類的主模型呼叫；工具模式仍需要主模型發起呼叫與處理結果，
額外往返可能使單一簡單任務變慢。回傳耗時與 usage 方便比較，尚未實測你的模型加速或準確率。

```bash
npm test
npm pack --dry-run
```

測試使用模擬 HTTP 服務，真實模型需在本機用 CLI 或 `/decider` 驗證。
已驗證 `@mariozechner/pi-coding-agent@0.73.1` 與 `@earendil-works/pi-coding-agent@1.1.0`
的套件安裝、資源載入及工具參數驗證。Node.js 至少 20.6；後者要求至少 22.19。
pi manifest 只載入 `local-decider`。下方是保留的原始 TypeSafe 雲端技能說明；
它的 API 指示不適用於本機模型。

---

# 原始 TypeSafe Agent Skills

Agent skills for building with [TypeSafe](https://typesafe.ai): typed decisions and probabilities from System One models.

You can [read SKILL.md on GitHub](https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md) or fetch its [raw Markdown](https://raw.githubusercontent.com/typesafe-ai/skills/main/skills/typesafe-ai/SKILL.md).

## Install

### Claude Code plugin

Run in your terminal:

```bash
claude plugin marketplace add typesafe-ai/skills
claude plugin install typesafe@typesafe-ai
```

### Other agents via skills.sh

```bash
npx skills add typesafe-ai/skills --skill typesafe-ai
```

Select your agent when prompted. Installation is project-local by default; add `-g` to install globally.

See the [installation guide](https://docs.typesafe.ai/agent-skill#installation) for a prompt to copy to your agent, manual installation, and updates.

## Use

Ask your agent, for example:

> Use TypeSafe to route incoming support tickets by department, with human review for uncertain decisions.

In Claude Code, you can explicitly invoke the plugin skill with `/typesafe:typesafe-ai`.

| Skill | Purpose |
|---|---|
| [typesafe-ai](skills/typesafe-ai/SKILL.md) | Design TypeSafe workflows, find current docs and cookbooks, and compose typed judgments in code |

## License

[MIT](LICENSE).
