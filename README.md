# 潮位 ETF 觀測所

以證交所盤後資料觀察 ETF 價格水位、台灣加權指數與成交股數，並結合 EIA 布蘭特原油及中央銀行 USD/TWD 日資料。使用者可選擇觀察窗、黃金分割或等距刻度、自訂權重，並開啟 MA20、布林通道及 MACD。分數是歷史相對位置，不是報酬預測。

## 資料與限制

- ETF 名錄來自[證交所 ETF e添富](https://www.twse.com.tw/zh/ETFortune/products)，目前快照包含 242 檔證交所上市 ETF，含 009816。輸入 `npm run catalog:update` 可更新快照。上櫃 ETF 尚未加入。
- 日 K 與大盤資料來自證交所 `STOCK_DAY`、`FMTQIK`。首次載入 3 年並在背景補至 5 年；選 10 年時再分頁載入。新上市 ETF 僅有上市後的資料。0050 的 2025 年拆分前價格已按 1:4 調整；其餘商品拆分及含息口徑尚待校驗。
- 布蘭特原油來自 EIA 日表；失敗時使用註明日期的快照，超過 14 天不計分。USD/TWD 來自中央銀行開放資料。DXY 和盤中即時價尚未提供。
- 量能採成交股數歷史百分位；使用者須自行選擇高量或低量分高。原油與 USD/TWD 的數值低分高，其它價格因子亦為低水位分高。

## 本機開發

需要 Node.js 20 以上。執行 `npm run build`、`npm run validate`、`npm run dev`，然後開啟 `http://127.0.0.1:4173/`。`worker/` 是 Sites Worker 原始碼；`dist/` 是產物。

## Apps Script

執行 `npm run build:gas` 產生 `gas/Code.gs`、`gas/Index.html` 與 `gas/appsscript.json`。這個版本在 Apps Script 內用 `google.script.run` 呼叫同帳號的後端，不依賴 Sites。若要在自己的 Google 帳號部署，使用 `clasp create --type webapp --title '潮位 ETF 觀測所' --rootDir gas`，重新執行 `npm run build:gas`，接著 `clasp push --force`、`clasp deploy`。請用實際 `/exec` 網址驗證外部帳號可存取；Google Workspace 管理員可能限制公開存取。

## 技術指標

- MA20：20 根收盤價的算術平均。
- 布林通道：20 期平均線 ± 2 倍母體標準差。
- MACD：EMA12 − EMA26，訊號線為 DIF 的 EMA9，柱狀圖為 DIF − 訊號線。日、週、月資料切換後重新計算。

技術指標預設關閉，也不參與綜合分數。價位超出歷史高低點時，延伸分可超出核心分的 0–5 上下限；加權核心分仍限制在 0–5。
