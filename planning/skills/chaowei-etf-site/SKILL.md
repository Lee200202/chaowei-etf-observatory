---
name: chaowei-etf-site
description: 設計、修改或診斷潮位 ETF 觀測所的分頁、卡片、動畫、行情來源、水位評分、資金分批、波段、策略白板與固定訓練驗證，並依實際程式與公開部署驗收。用於此 ETF 網站；盤勢有據 Stock 專案及一般投資建議不在此技能範圍。
---

# 潮位網站設計與驗收

以問題選擇下列規格，不必每次讀全部文件。這些是可追溯的產品規格與診斷路徑，不代表額外發布、帳號或資料授權。新指示優先於歷史偏好。

## 定位專案

目前工作副本為 `C:/Users/user/桌面/個股黃金比例/site`，遠端為 `Lee200202/chaowei-etf-observatory`。先確認 cwd、Git 狀態與最新 commit；專案可能同時由其他工具更新，不覆蓋未提交工作。`worker/`、`pages-src/`、`gas-src/` 是來源；`docs/` 和 `gas/` 為建置輸出。不要只改生成檔。

## 依問題讀取

| 使用者要做什麼 | 讀取規格 |
| --- | --- |
| 分頁、簡化流程、功能範圍 | [A 架構與流程](references/architecture.md) |
| 字級、卡片、動畫、FAQ、手機／平板 | [B 視覺與互動](references/design-motion.md) |
| 報價不更新、原油／官股／融資、爬取 | [C 資料來源與時效](references/market-data.md) |
| 分數方向、常態分布、權重套用 | [D 評分與方案](references/scoring.md) |
| 平均只持股3%、進場金額、回測 | [E 策略與資金](references/strategies.md) |
| 峰谷、標記、量測、技術指標、千分策略 | [F 技術研究與量測](references/wave-measurement.md) |
| 歷史當下、訓練／驗證、歷史水位 | [G 歷史驗證](references/training-validation.md) |
| 登入、同步、快取、速度 | [H 會員與效能](references/membership-performance.md) |
| 實機截圖、測試、Pages／Apps Script | [I 驗收與發布](references/qa-release.md) |
| 不知道先查哪裡、可引用的診斷步驟 | [J 故障索引](references/diagnostic-playbook.md) |

每份規格以 A1、B2、E3 等識別碼定位。回答可寫「依 E2 資金分批」，再引用來源檔、測試或截圖。不要把文件規定當成已執行的測試。

## 共用工作方式

先辨識呈現、資料、衍生公式或現金帳問題，再修正。計算變更用手算、資金恆等式與真實資料交叉核對；版面變更實際點選與截圖。缺資料保留缺值與來源日期，不補造歷史或將輪詢時間當報價時間。修改後說明結果、驗證範圍及剩餘限制。

主張已部署時須有 commit／Actions／原 Apps Script 部署的證據，不能只以本機畫面交付。發布依當次任務授權，不因呼叫技能取得新授權。

## 同源 HTML 手冊

```powershell
python -X utf8 C:/Users/user/.codex/skills/chaowei-etf-site/scripts/render_handbook.py --output C:/Users/user/桌面/個股黃金比例/site/outputs/潮位網站技能與驗收手冊.html
```

程式或部署改變時，先更新相關段落及日期，再產生手冊。不要將2026-10-25的快照永久當成即時現況。
