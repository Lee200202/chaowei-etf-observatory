# C　資料來源、爬取與時效

## C1　時間與缺值

保留來源、商品、單位、實際資料時間、本站檢查時間、發布頻率。每五分鐘檢查不代表上游每五分鐘發布；date沒變不改今天。盤中暫值與正式收盤分開；缺值／過期暫停因子，不用其他商品冒充。2026-10-25為週日，10/22快照不應直接當故障或稱週日盤中。

## C2　ETF與大盤

名錄由TWSE ETF e添富整理，筆數隨更新變。歷史 `pages-data/history/<code>.json` 的rows為日期、開高低收、成交股數，主要由MI_INDEX每日ETF表累積，最早約2016-10；`market.json`為大盤。STOCK_DAY可補最新月，不表示已存入歷史正本。富果報價經GAS金鑰取得，前端約五分鐘檢查、伺服快取約240秒；公開展示開關與實際時間需核對，不輸出金鑰。

大盤盤中用MI_5MINS_INDEX與MI_5MINS，盤後FMTQIK作日正本／後備。上午累計量只比歷史同時刻，不比全天；同時刻樣本不足則不計分。股數顯示張除1000；拆分換算另標，不因價格已還原就默認量也還原。

## C3　油價與匯率

目前計分是FinMind `CrudeOilPrices`／Brent現貨日序列 `oil-spot.json`，美元／桶。Yahoo `BZ=F` 為另列的期貨延遲價，不混進現貨歷史。`brent.json`的TAIFEX BRF近月結算為新台幣／桶；舊EIA、00642U代理和BRF不可混稱現貨。USD/TWD採央行收盤；FinMind銀行買賣價或中價不是央行成交收盤。

查 `gas-src/MarketSources.gs`、`pages-src/live-layer.js`、`scripts/update-oil-spot.mjs`。token有效不代表所有資料集即時或可公開；依當時方案核對。失敗保留正本，不重設別的程式共用token。官方：[原油](https://finmind.github.io/tutor/Materials/)、[技術資料](https://finmind.github.io/tutor/TaiwanMarket/Technical/)、[API](https://api.finmindtrade.com/docs)。

## C4　籌碼與大戶

ETF法人、外陸資持有量、融資融券以TWSE盤後為主。買賣超是流量，持有量是庫存，不可互換。400／1000張是TDCC每週集保分布，不是每日法人交易，也不能推定政府持有。選兩年但僅累積一年要註明，不能補缺週。

## C5　八大官股

HiStock圖的 `loadChart(...)` 內 `SumMoney` 是億元淨額，`Price` 是加權指數，不是ETF本身持股或個股Top30。時間戳直接取UTC日，不再加8小時。2026-10-23已驗收樣本123日、2026-04-27至10-22，屬當時快照而非永久保證。

`BankHistory.gs` 平日約20:00每天最多一次嘗試；失敗留舊值及錯誤，不當日反覆抓。Google觸發器不是整秒保證。日期upsert：新日追加、同日修正、不刪累積舊日。可看網頁不等於有轉載授權；歷史商務範文不直接當已簽約。依當次有效範圍判定公開／內部。

## C6　來源驗收

0050、0056、00878、009816各抽末兩日OHLCV，核對排序、OHLC合法、量非負、分割紀錄。官股抽四日比同源原圖，核對億元正負、UTC日、合併無重複。原油核對商品／幣別／時間，不拿ETF元價替換美元。API診斷只輸出狀態、日期、筆數及必要公開樣本，不輸出token或個人設定。
