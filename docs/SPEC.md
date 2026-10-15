# TinyCanvas：完整產品與技術規格書

> 版本日期：2026-10-12（個人版範圍，第 4 版：補齊座標系、旋轉、容器邊界情況、各類型欄位、圖片讀取、離線範圍、字型、效能驗收方式，並統一快捷鍵）

## 1. 專案概述

TinyCanvas 是一個**個人使用**的視覺化白板，可在無限畫布上繪製流程圖與線框圖。

**開發方式**：本規格是交給 Claude Code 實作的依據。所有技術選型都已定案為單一選項，實作時不再另行選擇。部署方式見第 11 節，開發流程與里程碑見第 12 節。

**產品定位**：核心價值是「速度」。預設樣式就很好看、物件會自動對齊、操作以鍵盤為主，使用者幾乎不需要調整格式。

**使用情境**：

- 自架在個人 VM 上，供本人（或少數幾個各自獨立的帳號）使用
- 不公開販售，也不做正式上線（GA）
- 沒有收費方案、計費、稽核或 AI 整合

**本期範圍**：

- Web 應用，支援 Chrome / Edge / Safari / Firefox 最新兩版，介面為繁體中文
- 前後端以 Docker Compose 打包，部署在單台 VM
- 無限畫布（Board）：流程圖、線框圖、文字、表格、圖片可以混在同一張畫布上
- 匯出 PNG
- 個人檔案管理、唯讀分享連結、版本歷史

本期不實作的項目見第 6 節。

**品牌注意事項**：名稱、Logo、配色、圖示與介面視覺都必須自行設計，不可以複製其他產品的介面。例外：預設調色盤的 15 個顏色依使用者指定（見第 4.1 節），介面元件的外觀仍為自行設計。系統主色為 `#0087DC`（按鈕、選取框、連結、線框圖強調色、Logo）。

## 2. 功能總覽與分期

| 模組         | 主要功能                                                           | 分期 |
| ------------ | ------------------------------------------------------------------ | ---- |
| 畫布核心     | 無限畫布、平移縮放、選取、對齊、群組/解除群組、複製貼上、復原/重做 | MVP  |
| 流程圖       | 形狀、連線、自動連接、快速延伸、區塊、自動排版                     | MVP  |
| 文字         | 自由文字、標題文字                                                 | MVP  |
| 檔案管理     | 資料夾（含分頁資料夾）、搜尋、垃圾桶                               | MVP  |
| 儲存與一致性 | 自動儲存、多分頁/多裝置內容一致、離線暫存                          | MVP  |
| 分享與匯出   | 唯讀分享連結、匯出 PNG                                             | MVP  |
| 線框圖       | UI 元件庫、裝置框、wireflow 連線                                   | V1   |
| 表格         | 畫布內表格                                                         | V1   |
| 版本歷史     | 自動快照、命名版本、預覽、還原                                     | V1   |

## 3. 畫布核心（Board Engine）

畫布是整個產品的地基。所有圖形元件都建立在同一套物件模型上，只是類型不同，因此可以自由混合使用。關鍵驗收指標：畫布上有 5,000 個物件時，平移與縮放仍要維持 60 fps。

### 3.1 畫布操作

- 無限畫布，縮放範圍 10%–400%。觸控板用雙指平移、捏合縮放；滑鼠用滾輪加 Mod 縮放；按住空白鍵拖曳可以平移
- 本文件中的 **Mod** 鍵：macOS 上是 Cmd，其他平台是 Ctrl。所有快捷鍵都以 Mod 定義，不另寫平台別版本
- 提供水平與垂直捲軸、「縮放至全部」、「縮放至選取」，以及可開關的小地圖
- 畫布背景色為 `#F3F5F8`（使用者指定），顯示點狀格線，物件的位置與尺寸會自動吸附格線（按住 Alt 可暫時停用）

### 3.2 物件通用行為

- 選取：點選、Shift 多選、框選
- 拖曳建立物件或縮放時，選取範圍右下角顯示「寬 × 高」（整數像素）
- 變形：移動、縮放、旋轉。下列物件不可旋轉：線框圖元件、區塊（含裝置框）、表格、連線
- 旋轉與縮放的組合規則：
    - 物件以自身中心旋轉，`rotation` 為角度（度），`x/y/w/h` 是未旋轉時的框
    - 群組本身不存旋轉角度（`rotation` 恆為 0）。旋轉群組時，直接改寫每個子物件的位置與 `rotation`，使其繞群組中心旋轉
    - 群組內只要有任何 `rotation ≠ 0` 的子物件（含巢狀），該群組只能等比縮放，避免子物件需要斜切才能表達
- 複製、貼上、重複（Mod+D）：跨畫布貼上時保留樣式；從外部貼上純文字時轉成文字物件；貼上圖片時自動上傳
- 「複製一份」（浮動工具列與右鍵選單）：按下後副本的預覽跟著游標移動，副本整體外接框的左上角對齊游標（與拖曳移動相同：顯示智慧對齊參考線並吸附附近物件的邊與中心、等距提示，否則吸附格線；按住 Alt 停用）；在畫布上點按左鍵即在該位置建立副本並選取（一次復原，套用區塊的拖入規則），按 Esc 或右鍵取消。預覽期間不寫入文件。快捷鍵 Mod+D 仍為立即在原物件旁複製
- 浮動工具列：拖曳物件、折線線段或連線端點（移動超過 3 px 才算拖曳）期間隱藏，放開後再顯示；單擊不會讓工具列消失
- 對齊：智慧對齊參考線、等距分佈提示、對齊/分佈工具列。選取兩個以上非連線物件時，浮動工具列只顯示靠左 / 水平置中 / 靠右、靠上 / 垂直置中 / 靠下、水平 / 垂直等距分佈（三個以上才可用）、群組與「更多」；樣式改用「更多」裡的複製 / 套用樣式。只選一個群組時，浮動工具列外層顯示解除群組
- 拖曳移動時的等距提示：與上下（左右）鄰居的間距，等於鄰居與再上一個（下一個）物件的間距時，吸附並標出這一串相等的間距（例如三個方塊上下排列）；位在兩個鄰居正中間時標出兩邊的間距。鄰居指另一軸範圍有重疊的物件。提示線畫在間距中央、兩端有短橫槓，可與對齊線同時出現；與對齊線（例如中心對齊線）重疊時往右（橫線往下）移開 12 px；同一個方向上對齊與等距都能吸附時取較近的一個，按住 Alt 停用
- 拖曳移動時，物件的左 / 中 / 右與上 / 中 / 下只要與其他物件的邊或中心重合，每一條都顯示參考線（例如同寬物件上下排列時左、中、右三條同時出現），參考線延伸涵蓋所有重合的物件
- 浮動工具列放在選取範圍上方；有旋轉把手時再往上移，不蓋住把手；上方空間不足時改放下方
- 調整大小時，移動中的邊也會吸附附近物件的邊與中心並顯示智慧對齊參考線（等比縮放時，跟著改變的另一軸重合時也會顯示），否則吸附格線；旋轉過的物件與按住 Alt 時不吸附
- 層級：上移、下移、移到最上、移到最下；可鎖定物件
- 樣式面板：預設調色盤加自訂顏色、邊框、字型大小、對齊方式；提供「複製樣式」與「套用樣式」

### 3.3 容器：群組與區塊

畫布上有兩種容器：**群組**（沒有外觀，只是把物件綁在一起）與**區塊**（有外框與標題的可見容器，見第 4.1 節）。兩者共用同一套 `parentId` 機制，規則如下。

**座標系**

- 所有物件的 `x/y` 一律是**畫布絕對座標**，不是相對於容器的座標。空間索引、命中測試、連線路由都直接使用這組座標
- 因此移動容器時，必須在同一個 transaction 內改寫容器與所有子孫物件的 `x/y`

**歸屬規則**

- 每個物件的 `parentId` 指向它「最近的一層容器」，沒有容器時為 null
- 群組可以放進區塊，區塊不能放進群組；區塊也不能放進另一個區塊
- 物件被放進區塊時，`parentId` 指向區塊；之後若和其他物件建立群組，所有成員的 `parentId` 改指向群組，群組的 `parentId` 指向區塊
- 建立群組時，若成員的 `parentId` 不完全相同（例如分屬不同區塊，或一部分在區塊內、一部分在頂層），群組的 `parentId` 設為 null（脫離所有區塊），成員留在原位置
- 選取範圍內只要包含區塊，「群組」指令即停用（快捷鍵無作用、選單項目呈灰色）

**拖入與拖出的判定**

- 放開滑鼠時，以被拖曳物件（或群組）外接框的**中心點**判定：中心點落在某個區塊範圍內就歸屬該區塊，否則 `parentId` 設為 null
- 中心點同時落在多個區塊內時（區塊互相重疊），歸屬 z 最高的那個
- 拖曳區塊本身不會吸入它經過的物件；要把既有物件放進區塊，必須拖曳物件

**群組**

- 建立：選取兩個以上的物件後，按 Mod+G 或使用右鍵選單的「群組」
- 解除：選取群組後，按 Mod+Shift+G 或使用右鍵選單的「解除群組」。解除後，子物件的 `parentId` 改為群組原本的 `parentId`，位置不變，並維持選取狀態
- 選取：點一下選取整個群組；在群組內雙擊可以進入群組，選取單一子物件；按 Esc 或點擊群組外部即退出
- 整體操作：移動、縮放、旋轉、複製、刪除、調整層級、鎖定時，都以整個群組為單位。縮放群組時，子物件依比例縮放
- 巢狀：群組可以再放進另一個群組；解除群組一次只解開一層
- 外觀：群組本身沒有外框，只有在選取時才顯示一個包住所有子物件的選取框
- 群組的 `x/y/w/h` 是所有子物件的外接框，由用戶端在子物件變動時重新計算並寫回
    - 若子物件的變動來自本分頁的使用者操作，重新計算放在同一個 transaction 內，origin 為 `localOrigin`
    - 若變動來自其他分頁或離線合併，重新計算以 `systemOrigin` 寫回，不進入復原堆疊（見第 3.5 節）；數值相同時不寫入，避免多個分頁互相觸發

**區塊**

- 移動區塊時，裡面的所有物件一起移動
- 把物件拖進區塊範圍並放開，物件就歸屬該區塊；拖出區塊範圍並放開，就脫離
- 縮放區塊只改變區塊本身的大小，不縮放內容；若縮小後有物件超出範圍，物件仍歸屬區塊，但顯示在區塊外
- 區塊的標題可直接編輯；刪除區塊時詢問「只刪區塊」或「連同內容一起刪除」

**形狀內的物件**

- 形狀（所有 shape 類型）不是容器，不改變 `parentId`；但以滑鼠拖曳或方向鍵移動形狀時，下列物件會一起移動：
    - 與形狀在同一層容器（`parentId` 相同）
    - 外接框**完整**位在形狀範圍內（只有部分重疊的不算）
    - 畫在形狀上方（z 順序較高）
- 群組以整個群組為單位；連線、區塊、鎖定的物件不會被帶走；旋轉過的形狀不帶走任何物件
- 被帶走的形狀會再帶走它範圍內的物件（可多層）
- 一起移動的物件與形狀在同一個 transaction 內，一次復原
- 複製形狀時（「複製一份」、Mod+D、複製 / 剪下後貼上），同樣規則判定的物件與它們之間的連線也一起複製，相對位置不變；貼上後只選取原本選取物件的複本，形狀內物件的複本不選取
- 刪除形狀時（Delete、工具列或右鍵選單的刪除、剪下），同樣規則判定的物件一起刪除，接在它們上面的連線也一併刪除；同一個 transaction，一次復原
- 縮放、對齊、自動排版不套用此規則

**層級（z 順序）**

- 頂層物件依自己的 `z` 排序
- 容器內的子物件一律畫在容器之上，並在容器內依自己的 `z` 排序；子物件的層級調整只在同一個容器內移動
- 調整群組的層級，等於同時調整它所有子物件相對於外界的層級
- `z` 是分數索引字串。兩個分頁同時插入而產生相同的 `z` 時，以物件 `id` 的字典序決定先後

**連線**

- 連線接在群組或區塊內的物件上時，移動容器會讓連線重新路由
- 連線本身不屬於任何容器（`parentId` 永遠為 null）
- 繪製順序：所有連線一律畫在所有非連線物件之上，連線之間再依自己的 `z` 排序。這樣連線不會被區塊蓋住

### 3.4 連線（Connector）

- 類型：直線、折線（正交路由）、曲線；可以設定箭頭樣式、虛線、線上文字標籤。新連線預設終點為實心箭頭、起點無箭頭，線條粗細預設為 3
- 連接點：物件外框上的任意位置（非矩形形狀以實際輪廓為準，例如橢圓、菱形的斜邊）。移動形狀時，連線會自動重新路由並避開障礙物（其他物件，保持 16 px 距離）。連線、群組、區塊與自由文字不算障礙物：文字常放在線旁邊當說明，線不會繞開它；連線端點接在文字上時，線仍從文字邊上離開
- 指標在物件外框上（內外約 2 px 以內）時，外框上出現一個跟著指標沿邊移動的連接點（圓點）；離四邊中點 8 px 以內時吸附到中點。範圍刻意設小，避免指標一靠近物件就吸附
- 從連接點拖出連線：放在另一個物件的外框附近（外側 14 px、內側 6 px 以內），就固定在那一點（同樣吸附中點）；放在物件內部時改為自動選邊（面對另一端的那一邊中點）；放在空白處時，會彈出快速選單，讓使用者直接建立下一個形狀
- 在外框上單擊（不拖曳）等同點選該物件；朝某方向延伸並自動連線改用 Mod+Alt+方向鍵
- 選取折線時，除了頭尾兩個端點，每段中間線段（不含接在端點上的頭尾段）的中點也有控制點。拖曳控制點會把該線段垂直平移（接近前後的平行線段 8 px 以內時對齊它們，否則吸附半格；按住 Alt 都停用；對齊後共線的線段在放開時合併，例如四段變兩段，控制點隨之更新），結果記為手動路線（`waypoints`）：之後只移動一端的形狀時，中間線段保持不動、頭尾段跟著端點調整，且不再自動避開障礙物；兩端一起移動時整條路線一起平移。重新接端點、切換線型或在「更多」選「重設路線」時恢復自動路由
- 手動路線的頭尾段（直接接在端點上的那一段）至少 16 px，且沿端點離開物件的方向。中間線段被拖到離端點不足 16 px、或拖過端點到另一側時，繪製時把它推到距離端點 16 px 的位置，箭頭方向才會與接進來的線一致；移動端點所在的形狀時同樣適用。只剩一段中間線段、兩端的要求無法同時滿足時，在這段線中間轉折成 S 形
- 折線（自動或手動路由）的頭尾段若短於 16 px、且方向與端點離開物件的方向不一致（例如兩個物件幾乎等高時只差零點幾 px 的小轉折），把這個轉折移到路線內側：前一段線平移對齊端點，或在整段中點轉折，讓箭頭方向與接進來的線一致

### 3.5 復原與重做

- Mod+Z 復原、Mod+Shift+Z 重做
- 使用 Yjs 的 `UndoManager`，`trackedOrigins` 只包含本分頁的 `localOrigin`，因此不會復原到另一個分頁或離線合併進來的變更
- 系統自動產生的寫入（例如回應遠端變更而重算群組外接框）使用 `systemOrigin`，不被追蹤
- 一次使用者動作（例如群組、解除群組、拖曳一段距離、自動排版）必須放在同一個 transaction 內，復原一次就能整個還原；`captureTimeout` 設為 300 ms，讓連續打字合併成一步

### 3.6 渲染實作要求

為了達到 5,000 個物件 60 fps，渲染器必須做到下列事項，不得採用「每一幀全部重繪」的做法：

- **視窗裁切**：只繪製與可視範圍相交的物件
- **空間索引**：用 R-tree 或均勻格網維護物件的外接框，供視窗裁切、命中測試、框選使用；物件變動時增量更新索引
- **分層快取**：靜態物件畫在一層離屏 canvas 快取；正在拖曳或編輯的物件畫在另一層；只有被改動的那一層才重繪
- **髒區重繪**：只重繪變動物件影響的範圍
- **高解析度**：依 `devicePixelRatio` 縮放，文字在 Retina 螢幕上要清晰
- **文字量測快取**：`measureText` 的結果依字串與樣式快取。字型的子集檔載入完成（`document.fonts` 的 `loadingdone` 事件）後，必須清除受影響的快取並重新排版（見第 4.6 節）
- **細節層級（LOD）**：縮放到 10% 時，5,000 個物件可能全部在畫面內，視窗裁切幫不上忙。物件在螢幕上的字高小於 4 px 時，文字改畫成灰色長條；物件小於 2 px 時只畫色塊；圖片改用縮圖；陰影與圓角在低縮放比例時省略
- **效能測試**：`packages/canvas-engine` 內要有可重複執行的效能測試（`pnpm perf`），產生 5,000 個與 20,000 個物件的畫布，執行固定的平移與縮放腳本，量測**單幀繪製時間**
    - 指標：記錄每一幀的繪製耗時，以 p95 判定。60 fps 對應 p95 < 16 ms，30 fps 對應 p95 < 33 ms
    - 執行環境：開發機上以 Playwright 開啟 **headed** Chrome（啟用 GPU）。不在 headless 或沒有 GPU 的環境下判定是否達標

### 3.7 快捷鍵（預設）

Mod 的定義見第 3.1 節。單鍵快捷鍵（R、O、T、/ 等）只在沒有編輯文字時有效。

點過浮動工具列、左側工具列等白板上的按鈕後，焦點雖然在按鈕上，畫布快捷鍵與複製 / 剪下 / 貼上仍作用在畫布（Enter、空白鍵、Tab 留給按鈕本身）；焦點在輸入框、對話框或選單內時不作用。

| 快捷鍵              | 動作                                                                              |
| ------------------- | --------------------------------------------------------------------------------- |
| R / O               | 矩形 / 圓形                                                                       |
| T                   | 文字                                                                              |
| L                   | 連線                                                                              |
| W                   | 線框圖元件庫                                                                      |
| I                   | 圖示庫（插入獨立圖示）                                                            |
| Mod+G / Mod+Shift+G | 群組 / 解除群組                                                                   |
| Mod+Alt+方向鍵      | 從選取的形狀朝該方向延伸，並自動連線（不用 Ctrl+方向鍵，因為 macOS 用它切換桌面） |
| Mod+K               | 搜尋（見第 5.2 節）                                                               |
| Mod+K（編輯文字時） | 插入連結。此時由 Tiptap 處理，不會開啟搜尋                                        |
| Mod+Shift+E         | 匯出 PNG                                                                          |
| Mod+/               | 開啟快捷鍵說明面板                                                                |
| /                   | 指令面板（插入任意元件）                                                          |

瀏覽器預設佔用的組合鍵（例如 Mod+D 加入書籤、Mod+K 網址列搜尋）在畫布取得焦點時以 `preventDefault()` 攔截。

## 4. 各元件詳細規格

每種元件都要做到「不調整格式也好看」：預設的間距、字型與配色都由系統決定。

### 4.1 流程圖

- 形狀約 20 種：矩形、圓角矩形、圓形、菱形（決策）、平行四邊形、資料庫圓柱、文件、六邊形、三角形、雲、人物等
- 形狀內的文字會自動換行並置中；文字變長時，形狀會自動增高
- 形狀外觀（浮動工具列，只選取形狀時顯示）：
    - 矩形、圓角矩形、圓形可以直接互相切換
    - 預設調色盤 15 色（使用者指定，2026-10-15；顏色選擇器每列 4 色，最後一格為自訂顏色）。每一色有色盤顯示色、選擇後形狀的外框色與背景色：

        | # | 位置 | 色盤顯示色 | 外框 | 背景 |
        | --- | --- | --- | --- | --- |
        | 1 | 第 1 列・1 | `#FFFFFF` | `#C6CFD9` | `#FFFFFF` |
        | 2 | 第 1 列・2 | `#D7DDE4` | `#C6CFD9` | `#F3F5F7` |
        | 3 | 第 1 列・3 | `#A3ACB5` | `#A2ACB9` | `#E2E5EB` |
        | 4 | 第 1 列・4 | `#848E97` | `#7C8796` | `#D0D8DF` |
        | 5 | 第 2 列・1 | `#78AADE` | `#4685D1` | `#D8E6F5` |
        | 6 | 第 2 列・2 | `#938CF0` | `#635BEA` | `#E0DEFB` |
        | 7 | 第 2 列・3 | `#945BCE` | `#691ABC` | `#E0D0F0` |
        | 8 | 第 2 列・4 | `#C577DA` | `#AF41CC` | `#EED8F4` |
        | 9 | 第 3 列・1 | `#7FC4BD` | `#56ACA0` | `#D9EEEC` |
        | 10 | 第 3 列・2 | `#63A09A` | `#34786F` | `#D0E3E2` |
        | 11 | 第 3 列・3 | `#ABA391` | `#867B62` | `#E6E4DF` |
        | 12 | 第 3 列・4 | `#B99796` | `#9B6A68` | `#EBE1E1` |
        | 13 | 第 4 列・1 | `#D5838D` | `#C5515E` | `#F2DBDE` |
        | 14 | 第 4 列・2 | `#E5AC7F` | `#DA894C` | `#F7E7DA` |
        | 15 | 第 4 列・3 | `#F0D78F` | `#E9C764` | `#FAF3DE` |

    - 形狀預設為第 1 列・1（白色）。形狀選色時存色盤顯示色（白色與第 1 列・2 的外框色相同，只存外框色無法分辨），繪製時對應成外框與背景；連線、文字、圖示選色時存外框色，但「文字顏色」選白色時為 `#FFFFFF`、選第 1 列・3 時為 `#7C8796`、選第 1 列・4 時為 `#2C3743`（使用者指定）；以文字工具加入的文字預設為 `#2C3743`（形狀內文字的預設色不變）；區塊、表格等的填色選擇器以背景色填色、外框色描邊。自訂顏色當外框時，很淺的顏色以 `#C6CFD9` 繪製邊框
    - 圓角矩形的圓角半徑為短邊的一半：W > H 時為 H / 2，H >= W 時為 W / 2（呈膠囊形；正方形時即為圓形）。文字會避開兩端的半圓
    - 樣式三選一：整個填滿、只有外框、虛線外框（`style.fillMode`：solid / outline / dashed）
    - 新形狀的線條粗細預設為 3
    - 新形狀預設「只有外框、不透明背景」、白色（建立時存入 `fillMode: 'outline'`、`transparent: false`），即外框 `#C6CFD9`、背景 `#FFFFFF`；切換成虛線外框時背景不變
    - 邊框粗細（1、1.5、2、3、4）由浮動工具列上獨立的「邊框粗細」按鈕設定，不放在顏色選單裡；連線、區塊等有邊框的物件相同。獨立圖示的「線條粗細」（1、1.5、2、2.5、3）也是獨立按鈕
    - 透明背景開關（`style.transparent`）：只用於只有外框、虛線外框；整個填滿時停用
    - 形狀只設定一個顏色（`style.stroke`），外框與背景由它決定：只有外框與虛線外框在透明時沒有背景；非透明時為上表的背景色（自訂顏色為 21% 混 79% 白色的不透明淡色）。整個填滿時背景與只有外框（不透明）時相同，但沒有邊緣（使用者指定），未指定文字色時依背景亮度自動用白色或深色
    - 未設定外觀的形狀（2026-10-15 以前建立的舊形狀）維持原本的 `fill` / `stroke`，第一次調整顏色或樣式時才套用上述規則
- 形狀可以嵌入圖示。圖示使用 Lucide Icons（lucide-react），浮動工具列的圖示選擇器與圖示庫使用相同的搜尋：從全部 Lucide 圖示中以中文關鍵字、英文名稱或 Lucide 官方標籤搜尋（例如 robot 找到 Bot），未輸入時顯示常用圖示。介面上的圖示也一律使用 Lucide
    - 只有圖示時，圖示在形狀內水平與垂直置中；同時有文字時，「圖示 + 間隔 + 文字」整體置中（依文字的對齊設定）
    - 圖示可放在文字的上、下、左、右（浮動工具列「圖示位置」，預設上方）；圖示與文字的間隔固定 8 px
    - 圖示邊長跟著形狀的文字大小（文字 14 px 時圖示 24 px，等比例），不隨形狀縮放
- 獨立圖示：工具列的「圖示」（快捷鍵 I）開啟圖示庫，可從全部 Lucide 圖示中以中文關鍵字或英文名稱搜尋，點一下放到畫布上。獨立圖示可以移動、等比縮放、旋轉、接連線，並可設定顏色、線條粗細或更換圖示；浮動工具列有「旋轉 90 度」按鈕，每按一次順時針轉 90 度（多選時各自繞自身中心旋轉，一次復原）
- 區塊（Section）：有標題的可見容器，可以用來製作泳道圖。行為規則見第 3.3 節（目前暫時隱藏建立入口，見 DECISIONS.md 2026-10-12）
- 自動排版：選取一組形狀後，一鍵整理成由上而下或由左至右的排列（使用 ELK.js）

### 4.2 線框圖

- 元件庫約 40 種：按鈕、輸入框、下拉選單、核取方塊、單選、開關、滑桿、分頁標籤、導覽列、卡片、表格、圖片佔位、頭像、彈窗、文字段落等
- 裝置框：手機、平板、桌面瀏覽器、桌面視窗。裝置框是一種區塊，遵循第 3.3 節的區塊規則，差別只在外觀
- 統一採用低保真風格（灰階加一個強調色）
- Wireflow：元件可以直接連線到另一個畫面，用來表達頁面之間的跳轉

### 4.3 文字

- 提供自由文字與標題文字兩種
- 文字格式（形狀、文字、線框圖、表格儲存格共用，浮動工具列與快捷鍵）：
    - 文字大小 12 級：8XL（128）、7XL（96）、6XL（80）、5XL（64）、4XL（48）、3XL（40）、XXL（32）、XL（24）、L（20）、M（16）、S（14，預設）、XS（12）；工具列以「−／名稱／+」逐級調整或直接選擇
    - 行內格式：粗體（Mod+B）、斜體（Mod+I）、刪除線（Mod+Shift+X）、行內程式碼（Mod+Shift+K）、螢光標記（Mod+Shift+H）、連結（編輯時 Mod+K）
    - 段落樣式：內文（Mod+\）、標題 1–3（`#`、`##`、`###`）、項目清單（`*`）、編號清單（`1.`）、核取清單（`[]`）、程式碼區塊（```）；括號內為 Markdown 快速輸入
    - 對齊：靠左、置中、靠右；文字顏色
    - 編輯中，格式套用到選取的文字；只選取物件時，套用到整個物件的文字（一次復原）
    - 核取清單在不編輯時可以直接在畫布上點選勾選（一次復原）
    - 行內程式碼可以與其他行內格式並存
- 自由文字預設依內容自動決定寬度；拖曳右側把手後改為固定寬度並自動換行

### 4.4 表格與媒體

- 畫布內表格：可以增刪列與欄、儲存格內支援富文本、可以設定表頭列與欄寬
- 圖片：支援上傳與顯示 PNG、JPG、GIF、WebP、SVG，單檔上限 10 MB
- 檔案連結卡：在畫布上放置另一張畫布的連結，點擊即可前往

### 4.5 匯出 PNG

- 範圍：整張畫布或目前選取的物件
- 選項：1x 或 2x 解析度、透明或白色背景
- 在瀏覽器端用離屏 canvas 繪製後以 `canvas.toBlob()` 下載，不需要伺服器參與
- 匯出超過 8,192 × 8,192 像素時提示使用者改用 1x 或縮小範圍
- 匯出前先以 `document.fonts.load()` 確保畫面內所有文字需要的字型子集都已載入，否則 PNG 裡會出現替代字型

### 4.6 字型

畫布渲染、編輯時疊加的 DOM 輸入框、匯出的 PNG，三者必須使用同一個字型，否則換行位置會不一致。

- 採用 **Noto Sans TC 可變字重版**，以 npm 套件 `@fontsource-variable/noto-sans-tc` 自架（隨前端打包，由 Caddy 提供），不使用 Google Fonts 等外部服務
- 這個套件把字型依 `unicode-range` 切成約 100 個 woff2 子集檔（每個約 2–85 KB，全部合計約 4.3 MB）。瀏覽器只下載畫面上實際用到字元的子集，一般畫布只需要數百 KB
- 介面與畫布共用此字型，字重 400 與 700 由同一個可變字型檔提供
- 因為子集是按需載入，Canvas 第一次繪製某段文字時，對應的子集可能還沒下載：
    - 排版前呼叫 `document.fonts.load('<size> "Noto Sans TC Variable"', text)`，等待完成再量測
    - 監聽 `document.fonts` 的 `loadingdone` 事件，清除文字量測快取並重繪
- 備用字型順序：`"Noto Sans TC Variable", "PingFang TC", "Microsoft JhengHei", sans-serif`

### 4.7 介面語系

- 介面提供英文（預設）與繁體中文兩種語系
- 側邊欄底部與登入頁有語言選單；選擇後存在瀏覽器（localStorage），重新載入頁面套用，不存到帳號
- 介面文字放在 `packages/ui/src/i18n/` 的字典（`en.ts` 為結構基準、`zh-TW.ts`），由 `packages/ui/src/strings.ts` 依語系選出；兩份字典的鍵、佔位符必須一致
- 寫進畫布資料的預設內容（線框圖元件文字、區塊與裝置框標題、版本複本名稱）採插入當下的介面語系；已存在的內容不會翻譯
- 圖示庫與指令面板不論介面語系，都能以中文或英文搜尋
- 日期與相對時間依介面語系格式化；API 的 CLI 與伺服器訊息維持中文

## 5. 帳號、檔案管理與版本歷史

### 5.1 帳號

- 使用 Email 加密碼註冊與登入。**不做 Email 驗證**，系統也不寄送任何信件
- 是否開放網頁註冊由環境變數 `ALLOW_SIGNUP` 控制，預設關閉。關閉時，帳號只能透過 CLI 建立：`docker compose exec api node dist/cli.js create-user --email <email>`
- 忘記密碼時，用 CLI 重設：`docker compose exec api node dist/cli.js reset-password --email <email>`
- 每個帳號只有自己的個人空間，帳號之間互相看不到。不做工作區、團隊、角色或管理員身分

### 5.2 檔案管理

- 側邊欄提供樹狀目錄、最近檔案、我的最愛、垃圾桶
- 資料夾可以設為「分頁資料夾」，資料夾內的檔案改以分頁方式切換
- 搜尋（Mod+K）：可以依檔名與畫布內容搜尋。中文不做分詞，採用 `ILIKE` 子字串比對，並建立 `pg_trgm` 索引（見第 8.1 節）
    - 驗收只要求「搜得到」：任何出現在檔名或畫布文字中的子字串（含 1–2 個中文字）都要能搜到
    - 排序規則與索引是否被使用不列入驗收。1–2 個字的中文查詢抽不出 trigram，會退回全表掃描；以 1–5 個帳號的規模，這樣的速度可以接受
- 垃圾桶：刪除的檔案與資料夾保留 30 天，由 api 的每日排程永久刪除（見第 7 節）；刪除資料夾時，裡面的檔案一併進垃圾桶

### 5.3 唯讀分享連結

- 任一檔案都可以產生公開的唯讀連結，可設定密碼與到期日，也可以隨時撤銷。開啟連結的人不需登入，只能檢視
- token 為 32 位元組的隨機值（base64url）
- 流程：訪客開啟 `/s/{token}` → 前端呼叫 `GET /api/shared/{token}`；若有密碼則先 `POST /api/shared/{token}/unlock` 送出密碼 → api 核發一個 2 小時有效的檢視 token（JWT，內含 fileId 與 `readonly: true`）→ 前端以檢視 token 連線 `/sync`
- sync 服務收到檢視 token 時，只送出文件內容，**拒絕所有寫入**（在 Hocuspocus 的 `onAuthenticate` 中設定 `connection.readOnly = true`）
- 畫布上的圖片透過 `GET /api/assets/{id}` 讀取。訪客以檢視 token 讀取時，api 檢查該圖片確實被分享的檔案引用（`files.asset_ids`，見第 8.1 節）
- 檢視 token 過期後，前端呼叫 `GET /api/shared/{token}` 重新取得（有密碼時要求重新輸入）；sync 不主動中斷已建立的唯讀連線
- 分享頁面上的檔案連結卡只顯示標題，不可點擊
- 檔案在垃圾桶內或已永久刪除時，分享連結回傳 404

### 5.4 儲存與一致性

- 所有變更自動儲存，不需要「存檔」按鈕
- 同一個檔案在多個分頁或多台裝置上開啟時，內容保持一致
- 離線時，變更會暫存在瀏覽器本地（y-indexeddb），重新連線後自動合併
- **離線範圍**：只處理「已開啟的畫布在編輯途中斷線」。斷線期間可以繼續編輯，畫面顯示「離線中，變更已暫存」；重新連線後自動合併。本期**不**支援在離線狀態下開啟或重新整理 app（不做 Service Worker）
- IndexedDB 的資料庫名稱包含使用者 id 與檔案 id（`tc:{userId}:{fileId}`）。登出時清除該使用者的所有本地暫存；若有尚未同步的變更，登出前先警告
- 唯讀分享頁面不使用 y-indexeddb
- 不顯示其他人的游標或在線狀態（即時協作屬於延後項目，見第 6 節）

### 5.5 版本歷史

- 自動快照：sync 服務在寫回文件時檢查，若距離上一個版本超過 10 分鐘，且內容雜湊與上一個版本不同，就建立新版本；也可以手動命名版本
- 版本以 gzip 壓縮後存入 `doc_versions.state`
- 版本由新到舊列出，可以預覽、還原、另存成複本；大型畫布要採用增量載入
- 保留期由環境變數 `VERSION_RETENTION_DAYS` 設定，預設為 0，代表永久保留；手動命名的版本不受保留期限制
- **還原的正確做法**：Yjs 是 CRDT，不能直接用舊的 state 覆蓋目前的文件，否則其他分頁與離線暫存會合併出錯。還原時必須：
    1. 把舊版本載入一個暫時的 Y.Doc
    2. 比對暫時文件與目前文件的 `objects`，算出要新增、刪除、修改的物件
    3. 在目前文件上以**一個 transaction** 套用這些差異
    4. 還原動作本身要能用 Mod+Z 復原（transaction 的 origin 為 `localOrigin`）
- 差異以物件為單位：內容不同的物件，直接以舊版本的內容建立新的 Y.Map 放回同一個 key，不嘗試逐字比對富文本
- 還原由前端執行（前端已有目前文件），完成後另一個開啟中的分頁會透過一般同步機制自動更新

## 6. 延後開發項目（本期不實作）

以下功能保留在規格中，作為日後擴充的參考。**Claude Code 在本期不得實作這些功能**，但資料結構的設計不能阻礙日後加入。

| 項目           | 內容摘要                                                           |
| -------------- | ------------------------------------------------------------------ |
| 便利貼         | 8 種預設顏色、字型自動縮放填滿卡片、表情投票、多行貼上時拆成多張   |
| 心智圖         | Tab/Enter 建立節點、自動排版不重疊、分支配色、折疊、拖曳換父節點   |
| 文件 Docs      | 區塊式富文本、Markdown 快捷輸入、/ 指令、嵌入可編輯畫布、自動目錄  |
| 序列圖         | 參與者生命線、同步/非同步訊息、片段（alt/loop）、與 Mermaid 互轉   |
| 即時多人協作   | 多人同時編輯、即時游標與姓名、跟隨視角、標示他人選取的物件         |
| 評論與通知     | 畫布評論串、@提及、通知中心、Email/Slack 通知                      |
| AI 功能        | 以文字生成圖表、便利貼分群、摘要                                   |
| 範本           | 官方範本庫、自訂範本                                               |
| 匯入匯出       | SVG/PDF 匯出、Mermaid 互轉、Markdown 匯入匯出、全站備份匯出        |
| 整合與 API     | 嵌入 Notion/Confluence、Slack、公開 REST API、Webhooks、MCP 伺服器 |
| 帳號擴充       | Email 驗證、寄送信件、Google OAuth、工作區/團隊/角色權限           |
| 無障礙         | WCAG 2.1 AA                                                        |
| 商業與企業功能 | 收費方案、計費、正式上線（GA）、SSO/SCIM、稽核日誌                 |

為了日後能順利加入這些功能，本期要做到：

- 物件模型的 `type` 欄位可以擴充
- `files.type` 欄位保留，日後用來存放 `doc`
- 介面文字集中放在 `packages/ui/src/i18n/` 的字典，不散落在元件內，日後加語系只要新增一份字典

## 7. 系統架構與技術選型

最困難、也最該優先投入的部分有兩個：高效能的畫布渲染，以及基於 CRDT 的儲存與同步。個人版只需要三個應用容器、一個資料庫容器，再加上一個備份容器。

```mermaid
flowchart TB
  WEB[Web 應用（瀏覽器）<br/>React + 自研 Canvas 渲染<br/>y-indexeddb 離線暫存]
  subgraph VM[Docker Compose · 單台 VM（Ubuntu 24.04）]
    CADDY[web：Caddy<br/>自動 HTTPS、靜態網頁、/api 與 /sync 路由]
    API[api：NestJS<br/>帳號、檔案、分享連結、版本、上傳、每日排程]
    SYNC[sync：Hocuspocus<br/>Yjs 文件載入與儲存、搜尋文字抽取、自動快照]
    PG[(postgres 16<br/>資料、Yjs 狀態、pg_trgm 搜尋)]
    FILES[(files_data volume<br/>上傳的圖片)]
    BACKUP[backup：每日備份]
  end
  WEB -- HTTPS / WSS --> CADDY
  CADDY --> API
  CADDY --> SYNC
  API --> PG
  API --> FILES
  SYNC --> PG
  BACKUP --> PG
  BACKUP --> FILES
```

畫布內容以 Yjs 文件的形式儲存，由 Hocuspocus 負責載入，並寫回 PostgreSQL。這樣做有三個好處：

- 多個分頁開啟同一個檔案時，內容保持一致
- 支援離線編輯後自動合併
- 日後可以直接加上即時協作，不必更改資料格式

本期不使用 Redis、佇列、背景工作，也不呼叫任何外部服務。

| 層             | 定案選型                                                                                       | 理由                                                         |
| -------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 專案結構       | pnpm workspaces + Turborepo（monorepo）                                                        | 前後端可以共用型別與結構定義                                 |
| 前端框架       | React 18 + TypeScript + Vite                                                                   | 生態成熟，Claude Code 熟悉                                   |
| UI 元件與樣式  | Radix UI + Tailwind CSS                                                                        | 元件具備鍵盤操作支援，樣式一致                               |
| 圖示           | Lucide Icons（lucide-react）                                                                   | 介面與畫布共用同一套圖示，採 ISC 授權                        |
| 畫布渲染       | 自研 Canvas 2D 渲染器，實作要求見第 3.6 節                                                     | 物件達數千個時仍要維持 60 fps                                |
| 文字輸入       | 編輯中的文字上方疊加一層 DOM contenteditable                                                   | 確保中文輸入法、拼字檢查、複製貼上都正常                     |
| 資料模型與同步 | Yjs（CRDT）+ y-indexeddb                                                                       | 支援自動儲存、多分頁一致、離線合併，並保留日後協作的可能     |
| 富文本         | Tiptap（ProseMirror）+ y-prosemirror                                                           | 用於畫布上文字、形狀與表格儲存格的編輯；日後 Docs 可以沿用   |
| 自動排版       | ELK.js                                                                                         | 開源，瀏覽器與 Node 端都能使用                               |
| 同步服務       | Hocuspocus（@hocuspocus/server）+ @hocuspocus/extension-database                               | 內建驗證鉤子，可直接存進 PostgreSQL                          |
| 後端 API       | Node.js 22 LTS + NestJS                                                                        | 與前端使用相同語言，可共用型別                               |
| 排程           | @nestjs/schedule，在 api 內執行                                                                | 不需要額外容器                                               |
| ORM 與遷移     | Prisma，schema 與 client 放在 `packages/db`，api 與 sync 共用                                  | api 啟動時自動執行 prisma migrate deploy                     |
| 驗證           | Email 加密碼（argon2）、HttpOnly Cookie Session（SameSite=Lax、HTTPS 時加 Secure）、CSRF token | 不需 Email 驗證，也不依賴外部服務                            |
| 資料儲存       | PostgreSQL 16（搜尋用 pg_trgm 擴充）加本機檔案儲存（Docker volume）                            | 單機即可運作。不採用 MinIO，因為它已停止發布官方 Docker 映像 |
| 測試           | Vitest（單元測試）、Playwright（E2E 測試，含多分頁一致性測試）                                 | 每個里程碑都以測試驗收                                       |
| 部署           | Docker Compose + Caddy                                                                         | 在單台 VM 上一個指令即可啟動                                 |
| 日誌           | pino 結構化 JSON 日誌；各服務提供 /healthz                                                     | 單機環境簡單、好維護                                         |
| 字型           | Noto Sans TC 可變字重版（`@fontsource-variable/noto-sans-tc`），自架，細節見第 4.6 節          | 不呼叫外部服務；按需載入子集，各平台排版一致                 |

**每日排程（api 內，每天 03:30 執行）**：

- 永久刪除進垃圾桶超過 30 天的檔案與資料夾
- 依 `VERSION_RETENTION_DAYS` 刪除過期的自動版本
- 刪除同時符合下列條件的圖片：建立超過 24 小時，且沒有出現在任何 `files.asset_ids`（含垃圾桶內的檔案）或 `doc_versions.asset_ids` 中。這樣還原舊版本時，圖片仍然存在

**sync 與檔案狀態的協調**：

- sync 在 `onLoadDocument` 與 `onStoreDocument` 時檢查檔案是否存在、是否在垃圾桶內；不符合時拒絕載入或放棄寫入，不得重新建立 `documents` 的資料列
- 檔案被移到垃圾桶時，api 不直接通知 sync；sync 在下一次寫入時發現檔案已刪除，就關閉該文件的所有連線，前端顯示「此檔案已移到垃圾桶」

**畫布引擎**：預設全部自行開發。如果想縮短時程，可以評估以 Excalidraw（MIT 授權）或 tldraw SDK（商業使用需付費授權；個人非商業使用請自行確認條款）作為起點。代價是自動連線、群組行為這類深度客製會受到限制。

## 8. 資料模型與 API 設計

關聯式資料存放在 PostgreSQL。畫布內容則以 Yjs 二進位狀態儲存，不拆成資料表的列。

### 8.1 主要資料表（PostgreSQL）

| 資料表       | 主要欄位                                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| users        | id, email, password_hash, name, created_at                                                                                                    |
| sessions     | id, user_id, csrf_token, expires_at, created_at                                                                                               |
| folders      | id, owner_id, parent_id, name, is_tabbed, sort_key, deleted_at                                                                                |
| files        | id, owner_id, folder_id, type（本期只有 board）, title, is_favorite, search_text(text), asset_ids(uuid[]), created_at, updated_at, deleted_at |
| documents    | file_id, state（bytea，Yjs 完整狀態）, content_hash, updated_at                                                                               |
| doc_versions | id, file_id, state（bytea，gzip）, content_hash, asset_ids(uuid[]), label（手動版本才有）, created_at                                         |
| share_links  | id, file_id, token, password_hash, expires_at, revoked_at, created_at                                                                         |
| assets       | id, owner_id, storage_key, mime, size, width, height, created_at                                                                              |

搜尋：啟用 `pg_trgm` 擴充（Prisma migration 內執行 `CREATE EXTENSION IF NOT EXISTS pg_trgm`），在 `files.title` 與 `files.search_text` 建立 GIN trigram 索引，查詢用 `ILIKE '%關鍵字%'`，依 `similarity()` 排序。sync 服務在寫回文件時，從 Yjs 內容抽出所有文字物件的純文字，更新 `files.search_text` 與 `files.updated_at`；同時抽出所有 image 物件的 `assetId`，更新 `files.asset_ids`。建立版本時，把當下的 `asset_ids` 一併存入 `doc_versions.asset_ids`。

### 8.2 畫布物件模型（Yjs 內）

每張畫布是一個 Y.Doc，裡面有一個 `objects: Y.Map<id, Y.Map>`。每個物件都有以下共用欄位：

- `id`
- `type`：shape / text / connector / wireframe / table / image / link_card / section / group / icon
- `x`、`y`、`w`、`h`：畫布絕對座標（見第 3.3 節）；`rotation`：角度，規則見第 3.2 節
- `z`：分數索引字串，決定物件在同一個容器內的層級
- `parentId`：所屬的群組或區塊，規則見第 3.3 節；沒有所屬時為 null
- `locked`
- `style`
- `text`：Y.XmlFragment 富文本

部分類型另有額外欄位：

- **shape**：`shapeKind`（rectangle / rounded / ellipse / diamond / parallelogram / cylinder / document / hexagon / triangle / cloud / person 等）、`icon`（Lucide 圖示名稱，可為 null）、`iconPosition`（top / bottom / left / right，預設 top）、`autoHeight`（布林，文字變長時是否自動增高）
- **text**：`variant`（body / heading）、`fixedWidth`（布林；false 時寬度依內容決定）
- **group**：本身不繪製，只作為容器；`rotation` 恆為 0。解除群組時，先把子物件的 `parentId` 改成群組原本的 `parentId`，再刪除群組物件；整個過程必須放在同一個 transaction 內
- **section**：`title`；裝置框另有 `frameKind`（phone / tablet / browser / window），一般區塊的 `frameKind` 為 null
- **connector**：`from: {objectId, anchor}`、`to`、`waypoints`、`label`、`routing`（straight / orthogonal / curved）、`startArrow`、`endArrow`、`dashed`。`anchor` 為 top / right / bottom / left，或 `{ u, v }`（0–1 的相對位置，表示任意連接點）；端點未接在物件上時，`objectId` 為 null 並改存 `{ x, y }`
- **wireframe**：`componentKind`（button / input / select / checkbox / radio / switch / slider / tabs / navbar / card / table / image_placeholder / avatar / modal / paragraph 等）、`props`（Y.Map，依元件而異，例如 checked、選項清單）
- **table**：`columns`（Y.Array，每欄 `{ id, width }`）、`rows`（Y.Array，每列 `{ id, height }`）、`cells`（Y.Map，key 為 `{rowId}:{colId}`，值為 Y.XmlFragment）、`headerRow`（布林）。以 id 而不是索引定位儲存格，兩個分頁同時增刪列與欄時才不會錯位
- **image**：`assetId`、`naturalWidth`、`naturalHeight`
- **link_card**：`targetFileId`
- **icon**：`iconName`（lucide-react 的圖示名稱，PascalCase）。顏色與線條粗細使用 `style.stroke`、`style.strokeWidth`；只能等比縮放

所有本地修改都以 `{ origin: localOrigin }` 進行，供 UndoManager 辨識；系統自動產生的寫入使用 `{ origin: systemOrigin }`（見第 3.5 節）。

### 8.3 API 端點（REST）

所有會改變資料的請求（POST / PATCH / DELETE）都必須在 `X-CSRF-Token` 標頭帶上登入時取得的 CSRF token，否則回傳 403。

| 方法                  | 路徑                              | 用途                                                                                                                                                                                        |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST                  | /api/auth/signup                  | 註冊（只有 `ALLOW_SIGNUP=true` 時才可用）                                                                                                                                                   |
| POST                  | /api/auth/login、/api/auth/logout | 登入（回應含 CSRF token）、登出                                                                                                                                                             |
| GET                   | /api/me                           | 取得目前使用者與 CSRF token                                                                                                                                                                 |
| GET/POST/PATCH/DELETE | /api/folders                      | 資料夾的建立、讀取、更新、刪除                                                                                                                                                              |
| GET/POST/PATCH/DELETE | /api/files                        | 檔案的建立、讀取、更新、刪除（DELETE 會移到垃圾桶）                                                                                                                                         |
| POST                  | /api/files/{id}/restore           | 從垃圾桶還原                                                                                                                                                                                |
| GET                   | /api/search?q=                    | 搜尋檔名與內容                                                                                                                                                                              |
| GET/POST              | /api/files/{id}/versions          | 列出版本、建立命名版本                                                                                                                                                                      |
| GET                   | /api/files/{id}/versions/{vid}    | 下載某個版本的 state（供前端預覽與還原）                                                                                                                                                    |
| GET/POST/DELETE       | /api/files/{id}/share-links       | 管理唯讀分享連結                                                                                                                                                                            |
| GET                   | /api/shared/{token}               | 透過分享連結取得檔案資訊；無密碼時直接回傳檢視 token                                                                                                                                        |
| POST                  | /api/shared/{token}/unlock        | 送出密碼，取得檢視 token                                                                                                                                                                    |
| POST                  | /api/assets                       | 上傳圖片（multipart，上限 10 MB）                                                                                                                                                           |
| GET                   | /api/assets/{id}                  | 讀取圖片。以 Session 驗證時檢查擁有者；以檢視 token（`Authorization: Bearer`）驗證時，檢查圖片在被分享檔案的 `asset_ids` 中。回應加上 `Cache-Control: private, max-age=31536000, immutable` |
| GET                   | /api/healthz                      | 健康檢查                                                                                                                                                                                    |
| WS                    | /sync                             | Hocuspocus 連線。以 Session Cookie 驗證時可讀寫；以檢視 token 驗證時唯讀                                                                                                                    |

**/sync 的驗證規則**（在 `onAuthenticate` 內執行）：

- 檢查 `Origin` 標頭必須等於 `PUBLIC_URL`，否則拒絕。CSRF token 保護不了 WebSocket，這一項用來防止跨站 WebSocket 劫持
- 以 Session 驗證時，確認檔案的 `owner_id` 是目前使用者，且檔案不在垃圾桶內
- 以檢視 token 驗證時，確認 token 內的 fileId 與要求的文件相同，並設定 `connection.readOnly = true`

**登入次數限制**：api 位於 Caddy 之後，以 `X-Forwarded-For` 取得用戶端 IP，並只信任來自 Caddy（Docker 內部網路）的這個標頭。

## 9. 非功能需求

| 類別     | 指標                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 渲染效能 | 5,000 個物件時維持 60 fps（單幀繪製 p95 < 16 ms）；20,000 個物件時仍可操作（≥ 30 fps，p95 < 33 ms）。量測方式見第 3.6 節                            |
| 載入時間 | 一般畫布從開啟到可以操作 < 2 秒                                                                                                                     |
| 儲存     | 變更在 1 秒內寫回伺服器；在另一個分頁開啟的同一檔案，1 秒內顯示變更                                                                                 |
| 規模     | 設計目標為 1–5 個帳號，每張畫布 2 萬個物件以內                                                                                                      |
| 可靠性   | 容器異常時自動重啟（restart: unless-stopped）；每日自動備份                                                                                         |
| 安全     | Caddy 自動處理 HTTPS；只對外開放 80/443，資料庫不對外；密碼以 argon2 雜湊；登入每 IP 每分鐘最多 10 次（api 內記憶體計數）；CSRF token；上傳大小限制 |
| 隱私     | 所有資料都留在自己的 VM，不呼叫任何外部服務                                                                                                         |
| 語言     | 介面為繁體中文；完整支援中日韓輸入法的組字狀態                                                                                                      |
| 鍵盤操作 | 建立、選取、移動、群組、連線、復原等主要操作都可以只用鍵盤完成                                                                                      |
| 瀏覽器   | Chrome、Edge、Safari、Firefox 最新兩版                                                                                                              |

## 10. 分期與風險

### 10.1 分期

| 階段         | 範圍                                                                                         | 完成條件                                   |
| ------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| MVP（M0–M5） | 畫布核心與容器、流程圖、文字；帳號與檔案管理；自動儲存與多分頁一致；唯讀分享；匯出 PNG；備份 | 本人可以日常使用它來畫流程圖並貼到其他文件 |
| V1（M6–M7）  | 線框圖、表格；版本歷史                                                                       | 第 2 節列出的功能全部完成                  |

### 10.2 主要風險與對策

- **畫布效能不足**：在 M2 就做出 5,000 個物件的效能測試；若未達標，改用 WebGL
- **資料遺失**：採用成熟的 CRDT（Yjs），不自己寫同步演算法；每日備份，並實際演練還原
- **版本還原做錯**：第 5.5 節的差異套用流程要有單元測試，並以「兩個分頁各自開啟、一邊還原」的 E2E 驗證
- **中文輸入法異常**：文字編輯一律疊加原生 DOM 輸入框，並把注音、倉頡、日文輸入法列入回歸測試
- **容器規則互相干擾**：第 3.3 節的歸屬、層級、連線規則全部寫成單元測試
- **快照占用磁碟**：版本以 gzip 壓縮，內容沒變就不存；排程會依保留天數清除
- **字型按需載入造成排版跳動**：第 4.6 節的 `document.fonts.load()` 與量測快取清除要有單元測試；匯出 PNG 的 E2E 測試要包含畫面上第一次出現的中文字

## 11. 部署規格（Docker Compose，單台 VM）

在一台裝有 Docker 的 VM 上執行 `docker compose up -d --build` 就能啟動，對外只開放 80 與 443 埠。

### 11.1 VM 需求

| 項目         | 建議                                                     |
| ------------ | -------------------------------------------------------- |
| CPU / 記憶體 | 2 vCPU / 4 GB                                            |
| 磁碟         | 40 GB SSD                                                |
| 作業系統     | Ubuntu 24.04 LTS                                         |
| 軟體         | Docker Engine 加 Compose v2 外掛                         |
| 網路         | 開放 80、443；若要自動 HTTPS，需要有網域的 A 記錄指向 VM |

在沒有網域的內網環境，把 `DOMAIN` 設為 `:80`、`PUBLIC_URL` 設為 `http://<VM 的 IP>`，改用 HTTP 存取。

### 11.2 服務清單

| 服務     | 映像 / 建置來源                                       | 內部埠             | 資料卷                        |
| -------- | ----------------------------------------------------- | ------------------ | ----------------------------- |
| web      | apps/web/Dockerfile（用 Node 建置 → 由 Caddy 2 執行） | 80/443（唯一對外） | caddy_data                    |
| api      | apps/api/Dockerfile                                   | 3000               | files_data                    |
| sync     | apps/sync/Dockerfile                                  | 4000               | —                             |
| postgres | postgres:16-alpine                                    | 5432               | pg_data                       |
| backup   | deploy/backup/Dockerfile（cron + pg_dump）            | —                  | files_data（唯讀）、./backups |

### 11.3 docker-compose.yml

```yaml
name: tinycanvas

x-app-env: &app-env
    NODE_ENV: production
    PUBLIC_URL: ${PUBLIC_URL}
    DATABASE_URL: postgresql://tinycanvas:${POSTGRES_PASSWORD}@postgres:5432/tinycanvas
    SESSION_SECRET: ${SESSION_SECRET}

services:
    web:
        build: { context: ., dockerfile: apps/web/Dockerfile }
        ports: ["80:80", "443:443"]
        environment:
            DOMAIN: ${DOMAIN}
        volumes:
            - caddy_data:/data
        depends_on: [api, sync]
        restart: unless-stopped

    api:
        build: { context: ., dockerfile: apps/api/Dockerfile }
        environment:
            <<: *app-env
            ALLOW_SIGNUP: ${ALLOW_SIGNUP:-false}
            VERSION_RETENTION_DAYS: ${VERSION_RETENTION_DAYS:-0}
            STORAGE_LOCAL_DIR: /data/files
        volumes:
            - files_data:/data/files
        depends_on:
            postgres: { condition: service_healthy }
        healthcheck:
            test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/healthz"]
            interval: 10s
        restart: unless-stopped

    sync:
        build: { context: ., dockerfile: apps/sync/Dockerfile }
        environment: *app-env
        depends_on:
            postgres: { condition: service_healthy }
        restart: unless-stopped

    postgres:
        image: postgres:16-alpine
        environment:
            POSTGRES_DB: tinycanvas
            POSTGRES_USER: tinycanvas
            POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
        volumes:
            - pg_data:/var/lib/postgresql/data
        healthcheck:
            test: ["CMD-SHELL", "pg_isready -U tinycanvas"]
            interval: 5s
            retries: 10
        restart: unless-stopped

    backup:
        build: { context: ., dockerfile: deploy/backup/Dockerfile }
        environment:
            DATABASE_URL: postgresql://tinycanvas:${POSTGRES_PASSWORD}@postgres:5432/tinycanvas
            BACKUP_RETENTION_DAYS: ${BACKUP_RETENTION_DAYS:-14}
        volumes:
            - files_data:/data/files:ro
            - ./backups:/backups
        depends_on: [postgres]
        restart: unless-stopped

volumes:
    caddy_data:
    files_data:
    pg_data:
```

### 11.4 Caddyfile（建入 web 映像）

```
{$DOMAIN} {
  encode zstd gzip
  request_body {
    max_size 12MB
  }
  handle /api/* {
    reverse_proxy api:3000
  }
  handle /sync* {
    reverse_proxy sync:4000
  }
  handle {
    root * /srv/web
    try_files {path} /index.html
    file_server
  }
}
```

### 11.5 環境變數（.env）

| 變數                   | 必填 | 說明                                                                             |
| ---------------------- | ---- | -------------------------------------------------------------------------------- |
| DOMAIN                 | 是   | Caddy 監聽的網域，例如 canvas.example.com；內網沒有網域時填 `:80`                |
| PUBLIC_URL             | 是   | 瀏覽器實際存取的網址，例如 `https://canvas.example.com` 或 `http://192.168.1.10` |
| POSTGRES_PASSWORD      | 是   | 資料庫密碼                                                                       |
| SESSION_SECRET         | 是   | 32 位元組以上的隨機字串，可用 `openssl rand -hex 32` 產生                        |
| ALLOW_SIGNUP           | 否   | 是否開放網頁註冊，預設 false                                                     |
| VERSION_RETENTION_DAYS | 否   | 自動版本保留天數，預設 0（永久保留）                                             |
| BACKUP_RETENTION_DAYS  | 否   | 備份保留天數，預設 14                                                            |
| TZ                     | 否   | 時區，決定每日備份（03:00）與每日排程（03:30）的執行時間，預設 Asia/Taipei       |

### 11.6 部署步驟

1. 準備一台 VM，並把網域的 A 記錄指向這台 VM 的 IP
2. 安裝 Docker：`curl -fsSL https://get.docker.com | sh`
3. 取得程式碼並完成設定：執行 `git clone <repo> && cd tinycanvas && cp .env.example .env`，然後在 `.env` 填入必填變數
4. 啟動服務：`docker compose up -d --build`（api 啟動時會自動執行資料庫遷移）
5. 建立帳號：`docker compose exec api node dist/cli.js create-user --email you@example.com`
6. 確認服務正常：開啟 `<PUBLIC_URL>/api/healthz`，應回傳 `{"status":"ok"}`

**升級**：執行 `git pull && docker compose up -d --build`。

**備份**：backup 服務每天 03:00 執行 `pg_dump -Fc`，並把上傳的檔案打包到 `./backups`，保留 14 天。需要還原時，先執行 `docker compose stop api sync`，再執行 `scripts/restore.sh <日期>`，最後 `docker compose start api sync`。建議另外把 `./backups` 同步到 VM 以外的地方。

## 12. Claude Code 開發指引

Claude Code 依里程碑逐一實作，每次只交辦一個里程碑。一個里程碑「完成」的定義是：該里程碑的驗收測試全部通過。

### 12.1 專案結構

```
tinycanvas/
├── CLAUDE.md
├── .githooks/pre-push          # 本機檢查：lint、typecheck、test（不使用雲端 CI）
├── docker-compose.yml
├── docker-compose.dev.yml      # 開發用：只啟動 postgres
├── .env.example
├── package.json  pnpm-workspace.yaml  turbo.json
├── apps/
│   ├── web/        # React 前端（Vite）；vite.config 將 /api 代理到 :3000、/sync 代理到 :4000（含 WebSocket）
│   ├── api/        # NestJS REST API + CLI + 每日排程
│   └── sync/       # Hocuspocus 同步服務、搜尋文字抽取、自動快照
├── packages/
│   ├── db/             # Prisma schema、migrations、產生的 client（api 與 sync 共用）
│   ├── shared/         # 型別、zod 結構、常數（前後端共用）
│   ├── canvas-engine/  # 渲染、空間索引、命中測試、互動、容器邏輯、效能測試（不依賴 React）
│   ├── layout/         # ELK 流程圖自動排版
│   ├── editor/         # Tiptap 擴充（畫布上的富文本）
│   └── ui/             # Radix + Tailwind 元件、Lucide 圖示封裝、strings.ts
├── deploy/
│   ├── Caddyfile
│   └── backup/
├── scripts/            # restore.sh 等
└── docs/
    ├── SPEC.md         # 本規格書
    ├── PROGRESS.md     # 里程碑進度
    └── DECISIONS.md    # 實作過程中的決策紀錄
```

### 12.2 CLAUDE.md

專案根目錄的 `CLAUDE.md` 是給 Claude Code 的工作規則，內容以該檔案為準，不在本文件重複，以免兩邊不一致。它涵蓋：指令、範圍限制、技術選型限制、畫布資料規則（Yjs、origin、transaction、絕對座標）、介面規則（strings.ts、Mod 快捷鍵、輸入法）、測試與提交規則。

### 12.3 里程碑與驗收標準

| 里程碑                          | 範圍                                                                                                                                                                                                                   | 驗收標準                                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| M0 專案骨架                     | monorepo、三個 app 的空殼、packages/db、Dockerfile、docker-compose、本機檢查（`pnpm check` 依序執行 lint、typecheck、test；`.githooks/pre-push` 呼叫它，以 `git config core.hooksPath .githooks` 啟用）。不使用雲端 CI | `pnpm check` 通過；在乾淨的 VM 上執行 `docker compose up -d --build` 後，/api/healthz 回傳 ok，首頁可以開啟 |
| M1 帳號與檔案管理               | 第 5.1、5.2 節：登入、CSRF、用 CLI 建立帳號與重設密碼、資料夾與檔案的增刪改查、垃圾桶、每日排程、**檔名搜尋**                                                                                                          | E2E：用 CLI 建立帳號 → 登入 → 建立資料夾與檔案 → 刪除後從垃圾桶還原；排程可用測試時鐘驗證                   |
| M2 畫布引擎                     | 第 3.1–3.3、3.5、3.6 節：渲染、平移縮放、選取、對齊、群組與區塊、復原重做                                                                                                                                              | `pnpm perf` 在 5,000 個物件下達到 60 fps；第 3.3 節的每條規則都有單元測試                                   |
| M3 儲存與同步                   | 第 5.4 節：Yjs + Hocuspocus 持久化、多分頁一致、離線合併、搜尋文字抽取、**內容搜尋**                                                                                                                                   | E2E：兩個分頁同時編輯後內容一致；離線編輯後重新連線，內容不遺失；畫布內的文字可以被搜尋到                   |
| M4 流程圖與文字                 | 第 3.4、3.7、4.1、4.3 節：形狀、連線與自動路由、Lucide 圖示、區塊外觀與標題、自動排版、文字、快捷鍵                                                                                                                    | 清單內的功能都能用鍵盤與滑鼠操作                                                                            |
| M5 分享、匯出與備份（MVP 完成） | 第 4.5、5.3 節：唯讀分享連結、匯出 PNG、backup 服務、restore.sh                                                                                                                                                        | 未登入的人可以透過連結檢視，但 sync 服務拒絕其寫入；匯出的 PNG 與畫面一致；備份可以在新的 VM 上還原         |
| M6 線框圖與表格                 | 第 4.2、4.4 節                                                                                                                                                                                                         | 元件庫全部可用；裝置框遵循區塊規則；表格可以增刪列與欄                                                      |
| M7 版本歷史（V1 完成）          | 第 5.5 節                                                                                                                                                                                                              | 可以預覽並還原舊版本；還原後另一個開啟中的分頁同步更新；還原可用 Mod+Z 復原                                 |

### 12.4 交辦方式

1. 本文件位於 `docs/SPEC.md`，`CLAUDE.md` 位於專案根目錄（已完成）
2. 每次對話只交辦一個里程碑，例如：「依 docs/SPEC.md 實作 M2，完成後跑完測試並更新 PROGRESS.md」
3. 先用 plan mode 讓 Claude Code 列出計畫，確認之後再開始實作
4. 每個里程碑完成後進行人工驗收：執行 E2E 測試、實際操作一遍、檢視 DECISIONS.md
