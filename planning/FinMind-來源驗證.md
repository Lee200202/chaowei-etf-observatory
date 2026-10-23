# FinMind 來源驗證（內部）

2026-10-23 以 Free 匿名額度抽查。執行 `npm run source:finmind:check`，可選擇在本機環境變數 `FINMIND_API_TOKEN` 放入自己的 token。程式不寫入網站資料檔，不輸出 token，也不把 FinMind 回應部署到 GitHub Pages。

| 資料 | FinMind 資料集 | 2026-10-23 實測 | 目前網站來源與處理 |
| --- | --- | --- | --- |
| Brent 現貨 | `CrudeOilPrices` / `Brent` | 最新 2026-10-20，115.22 美元／桶 | EIA 同日 115.22，無較新資料；網站油價水位另以 00642U ETF 代理，兩者不可混稱 |
| 0050 日 K | `TaiwanStockPrice` / `0050` | 最新 2026-10-22，收 106.90，成交 132,441,805 股 | 與證交所快取同日相同；維持證交所作公開價格正本 |
| 美元／新台幣 | `TaiwanExchangeRate` / `USD` | 2026-10-23 銀行即期買 32.455、賣 32.555 | 網站用央行匯率，兩者口徑不同；不可把買賣中價 32.505 當央行報價覆蓋 |

FinMind 文件說 `TaiwanStockPrice` 為盤後日資料，`CrudeOilPrices` 為延遲數個交易日的現貨日資料。每五分鐘查詢只能檢查是否有**新的來源時間戳**；若 `date` 沒變，就保留原日期與分數，不顯示「五分鐘新報價」。免費方案限非商業，公開即時報價展示及原始資料再散布另有限制。使用者決定先用 Free 作內部驗證，所以目前不切換公開網站來源，也不新增 FinMind 排程。

後續可優先評估：ETF 本身的法人、融資與外資持股歷史缺口，及 Brent 現貨交叉驗證。若要啟用公開展示，先核對方案與展示授權，再用伺服端保管 token、限制呼叫頻率、提供來源／原始日期／口徑、比對現有證交所和 EIA 數值；不將 token 或原始批次資料放在公開前端。

來源：[FinMind 完整資料集文件](https://finmind.github.io/llms-full.txt)、[方案與授權](https://finmind.github.io/en/Pricing/)、[FinMind API](https://api.finmindtrade.com/docs)。
