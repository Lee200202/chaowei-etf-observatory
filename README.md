# 潮位 ETF 觀測所

以證交所盤後資料觀察 ETF 價格水位、台灣加權指數與成交股數，並結合 EIA 布蘭特原油及中央銀行 USD/TWD 日資料。使用者可選擇觀察窗、黃金分割或等距刻度、自訂權重，並開啟 MA、布林通道、MACD、RSI、KD。分數是歷史相對位置，不是報酬預測。

- GitHub Pages：<https://lee200202.github.io/chaowei-etf-observatory/>
- Apps Script：同一份前端，見下方「Apps Script」。

## 資料與限制

- ETF 名錄來自[證交所 ETF e添富](https://www.twse.com.tw/zh/ETFortune/products)，`npm run catalog:update` 更新，含 009816 等新掛牌商品。上櫃 ETF 尚未加入。
- 日 K 來自證交所 `MI_INDEX`（type=0099P，每日收盤行情 ETF 表），大盤來自 `FMTQIK`。`npm run history:update` 把約十年（2016-10 起）的資料寫成 `pages-data/history/<代號>.json` 與 `market.json`，之後每天只補新的交易日。網頁開一檔 ETF 只讀一個檔案；快照落後最新交易日時，才向證交所補當月資料（每檔最多一次請求）。
- 分割／反分割由證交所的漲跌價差推算（前一日收盤 ÷ 當日參考價），之前的價格依比例還原；成交股數保留交易所公布的實際股數，調整紀錄列在檔案的 `adjustments`。新上市 ETF 只有上市後資料。含息口徑尚待校驗。
- 布蘭特原油來自 EIA 日表，USD/TWD 來自中央銀行開放資料，各保留最近約 2,700 筆。快照逾 14 天不計分。DXY 尚未提供；盤中價的公開展示開關預設關閉。
- 富果盤中報價的伺服器串接已備妥：金鑰只放在 Apps Script 指令碼屬性 `FUGLE_API_KEY`，另須在核對公開展示授權範圍後設定 `FUGLE_PUBLIC_DISPLAY_ENABLED=true` 才會對訪客顯示。每檔報價快取 240 秒、前端每 5 分鐘檢查一次；盤中當日 K 與水位均標為暫值，盤後歷史資料仍取自證交所。未啟用時不顯示盤中價。
- 量能採成交股數歷史百分位；使用者須自行選擇高量或低量分高。原油與 USD/TWD 的數值低分高，其它價格因子亦為低水位分高。
- 歷史行情與市場資料是每日靜態快照。網站每 5 分鐘檢查小型版本清單，變更時才讀新檔；同版資料由瀏覽器 HTTP 快取保留，切換 ETF 不會重複向交易所抓取十年資料。
- 市場刻度每 5 分鐘經 Apps Script `getLiveMarket`（Pages 以 JSONP `?api=live` 呼叫）取最新資料，整包快取 4 分鐘：盤中（09:01–16:00）讀證交所 `MI_5MINS_INDEX` 的加權指數與 `MI_5MINS` 的累計成交量；EIA 布蘭特與央行匯率直接讀官方來源。EIA 現貨日價本身約落後一週公布，央行匯率於收盤後公布；即時原油或盤中匯率需另取授權資料源。
- 盤中量能只和過去交易日「同一時刻」的累計成交量比較（`pages-data/history/intraday-volume.json`，每 5 分鐘一個刻度、約 600 個交易日，`npm run intraday:update` 每日補一天），不拿上午累計量對照整日成交量；同時段樣本不足 20 日時暫停量能計分。
- 成交量可選「原始張數」（交易所公布）或「拆分換算」（分割前乘上分割比例，方便前後比較）；預設原始張數。

## 回檔加碼回測

以分割還原後的日收盤價模擬，收盤價成交、可買零股，未計手續費、稅與配息。

- 比例回檔：自前高下跌 X% 首次買進，之後每再跌 Y% 加碼（最多 N 次）；自平均成本上漲 Z%，或突破前高 Z% 時全部賣出，賣出後重新追蹤高點。
- 黃金分割：以最近 N 日高低區間，回檔到所選位階（23.6%／38.2%／50%／61.8%／78.6%）逐次買進；回到區間高點或突破 127.2%／161.8% 擴展位時賣出。
- 報酬率以「最高同時投入資金」計算，並列出年化報酬、最大回落、同期間買進持有，以及不同參數的報酬率比較表。買賣點標在 K 線上，可關閉。

## Google 登入與個人設定

學校帳號 `s711333105@gm.ntpu.edu.tw` 擁有 Firebase 專案 `chaowei-etf-observatory`。主網站使用 Google 登入，並把追蹤 ETF、權重、外觀和最多 12 組命名方案存於台灣區域的 Cloud Firestore。登入前的追蹤與權重存於本機瀏覽器；登入後讀取既有雲端設定，首次登入則上傳目前本機設定。資料庫安全規則見 `firestore.rules`：每位使用者只可讀寫 `users/<自己的 UID>`。Apps Script 鏡像會引導使用者至 GitHub Pages 主網站登入。Firebase Web 設定是公開識別資料，絕不存放富果金鑰。

## 本機開發

需要 Node.js 20 以上。`npm run build:pages` 產生 `docs/`，可用任何靜態伺服器開啟。`worker/` 存放共用的頁面、樣式與前端程式（早期 Sites 版的 Worker 已不再維護）。

## GitHub Pages

工作流程於臺北時間週一至週五 18:30 依序更新 ETF 名錄、證交所歷史日 K 與大盤、EIA 與央行快照，提交後部署 `docs/`。快照過期逾 14 天時停止該因子計分。

## Apps Script

`npm run build:gas` 產生 `gas/`。Apps Script 版與 Pages 共用同一份前端；網頁在瀏覽器直接讀 GitHub Pages 的快照（CORS 開放），讀不到時才由 `readSnapshot` 代讀（只允許名錄、總經與歷史檔路徑）。更新流程：`clasp push --force` → `clasp create-version "說明"` → `clasp update-deployment <id> -V <版號> -d "說明"`。`npm run test:gas` 檢查代讀、路徑限制與快取。

Pages 的盤中報價以只讀 JSONP 呼叫同一個 Apps Script 部署；Google 官方 ContentService 會轉址到一次性網址。只允許 ETF 名錄內代號，絕不把金鑰寫進前端、GitHub 或 API 回應。公開展示權限與富果方案額度仍須由金鑰持有人確認；服務端開關預設關閉。

## 技術指標

圖表使用 TradingView Lightweight Charts 4.1.3（與 Stock 網站相同版本），紅漲綠跌，下方為成交量（張）。

- MA5／MA20／MA60：N 根收盤價的算術平均。
- 布林通道：MA20 ± 2 倍母體標準差；%B＝(收盤 − 下軌) ÷ (上軌 − 下軌)。
- MACD：DIF＝EMA12 − EMA26，DEA＝DIF 的 EMA9，柱狀體＝(DIF − DEA) × 2。
- RSI：14 期 Wilder 平滑。
- KD：9 期 RSV，K、D 各以 1/3 平滑，首日以 50 起算。

日、週、月 K 切換後重新計算。「技術面讀數」只描述最新一根 K 棒的狀態，不參與綜合分數。價位超出歷史高低點時，延伸分可超出核心分的 0–5 上下限；加權核心分仍限制在 0–5。
