# H　會員、同步與效能

## H1　權限

訪客看公開行情、基本水位、選檔、本機外觀；登入解鎖波段、圖釘、籌碼明細、策略／白板研究與帳號保存等實際gate功能。GAS鏡像引導主站登入，不在測試時注入會員旗標。CSS模糊不等於資料權限；Firestore以UID隔離讀寫。

## H2　同步

雲端前去undefined、NaN／Infinity、循環與不支援型態，保留合法0／false／空字串。不存DOM、圖表實例、API金鑰。失敗留本機草稿，區分已存本機／已同步並可重試，不能報成功。帳號載入不無提示覆蓋白板。來源 `firestore.rules`、`cloud-sync.js`、`identity-layer.js`；[官方規則](https://firebase.google.com/docs/firestore/security/rules-conditions)。

## H3　快取

十年K由排程整理每檔一快照，不每次開頁抓120月份。IndexedDB先讀後台比版，HTTP快取／記憶體去重配合。鍵包含標的、版本、末正式日期、還原基準；改基準失效，不混暫K進正式研究。token有效、API可取、資料有存、頁面有顯示四層分驗。

## H4　運算

極值單調佇列O(N)；前k高低均價保持排名平均定義，不為快改普通極值。尋優Worker保留批次fallback、取消及過期結果保護。切ETF舊請求不覆新檔；resize重套範圍；離屏／背景動畫不持續重算。

## H5　速度測法

分記冷快取、熱快取、API次數、下載完、首圖與全因子完成時間，寫裝置／瀏覽器／網路，多次取中位。Node0.5ms不等手機全頁30ms，不承諾固定毫秒或零延遲。關閉IndexedDB仍可走網路；同版切回ETF不重抓十年；末日變動後分數一起刷新。

## H6　憑證

診斷只輸出是否設置、回應碼、最新日、筆數及必要公開樣本，不輸出token／私人設定。共用token不代重設。Firebase Web識別可公開，服務帳戶私鑰與富果／FinMind token不行。登入／MFA按既有授權流程，不在手冊存帳號憑證。
