# @tinycanvas/canvas-engine

TinyCanvas 的畫布引擎（SPEC.md 第 3、4.1、4.3、4.5、4.6 節）。純 TypeScript + Canvas 2D，不依賴 React。
畫布資料一律存在 Yjs（`getObjects(doc)`），引擎只讀快照、以 `localOrigin` 寫回。

```ts
import { BoardEditor } from '@tinycanvas/canvas-engine';

const editor = new BoardEditor({
  doc,                                  // Y.Doc
  container,                            // position: relative，大小由 CSS 決定（引擎以 ResizeObserver 追蹤）
  readOnly,                             // 唯讀分享頁：可平移、縮放、選取、複製；不能修改
  extraTrackedOrigins: [ySyncPluginKey],// Tiptap 打字與畫布操作在同一個復原堆疊
  loadImage: (assetId) => fetchBitmap(assetId),          // → CanvasImageSource（例如 ImageBitmap）
  uploadImage: (file) => upload(file),                   // → { assetId, width, height }
  onOpenLink: (fileId) => navigate(fileId),              // 唯讀頁不傳 → 連結卡不可點
  labels: { sectionTitle: '區塊' },                      // 引擎內唯一的介面文字，預設為繁體中文
});
const off = editor.subscribe((state) => render(state));  // 每幀最多一次
editor.destroy();
```

## 架構

| 檔案 | 內容 |
| --- | --- |
| `store.ts` | `SceneStore`：以 `observeDeep` 增量維護的純資料快照 `Map<id, BoardObject>`、父子索引、連線端點索引、R-tree（rbush）空間索引、繪製順序 |
| `model.ts` | `EditorModel`：不依賴 DOM 的核心。UndoManager、選取、所有修改指令與第 3.3 節的容器規則。單元測試直接使用它 |
| `renderer.ts` | 三層 canvas：`base`（靜態，平移時位移重用＋只補畫新露出的長條；物件變動只重畫髒區）、`live`（拖曳中的物件）、`overlay`（選取框、把手、參考線、捲軸） |
| `render/draw.ts` | 各類型的渲染器與 **renderer registry**、低細節（LOD）批次繪製、命中測試、文字框 |
| `connectors/` | 端點解析、直線／正交（A* 稀疏可見性格網，含轉彎懲罰）／曲線路由，路由快取 |
| `text/` | 富文本排版（CJK 逐字斷行＋避頭避尾、Latin 依單字）、`measureText` 快取、字型子集按需載入 |
| `editor.ts` | `BoardEditor`：相機、指標／鍵盤／剪貼簿事件、覆蓋層、匯出、小地圖 |

### 效能（第 3.6 節）

- 視窗裁切：`store.query(viewport)`（R-tree，物件變動時增量更新），只畫可見物件
- 分層快取：base 層平移時以整數裝置像素位移既有內容，只補畫新露出的區域；物件變動時只重畫舊／新範圍；縮放時整層重畫
- 拖曳、縮放、旋轉中的物件（含子孫與相連的連線）移出 base 層，畫在 live 層；放開時一次寫回 Yjs
- LOD：預設字級在螢幕上小於 4px（縮放 < 約 29%）時進入低細節模式：文字畫成灰色長條，形狀依顏色合併成少數幾個 Path2D 一次填色／描邊；物件小於 2px 只畫色塊；陰影只在縮放 ≥ 50% 時畫，圓角在螢幕上太小時省略；圖片在低縮放時使用 256px 縮圖
- 文字：`measureText` 以「字型＋字串」快取；排版結果依物件快取（文字、寬度、字級不變就重用）
- 連線路由不在每幀計算：結果快取，端點或範圍內障礙物變動時才失效。連線在空間索引中的範圍只取決於端點（路由保證落在其中），所以可以延遲到第一次需要時才計算
- 渲染迴圈不讀 Y.Map，只讀快照

`pnpm --filter @tinycanvas/canvas-engine perf`：以 headed Chromium 開啟 `perf/index.html`，產生 5,000 與 20,000 個混合物件（區塊、形狀＋文字、群組、自由文字、連線、瀏覽器裝置框內的線框圖畫面、表格；5,000 時約 480 個線框圖元件、50 個表格），透過公開 API 執行平移、縮小到 10%（5,000 個物件全部在畫面內）、在 10% 平移與縮放、放大、35% 平移、35–60% 來回縮放，記錄每一幀 `editor.stats.lastFrameMs`（renderer 的 `performance.now()` 區間）與 rAF 間隔，斷言 p95 分別 < 16ms 與 < 33ms。`PERF_DPR=2` 以 Retina 解析度執行。手動檢視：`pnpm --filter @tinycanvas/canvas-engine perf:dev` 後開 `http://localhost:5191/?n=5000`。

## 公開 API 摘要

相機：`setZoom(z, anchorScreen?)`、`zoomIn/zoomOut`、`zoomToFit`、`zoomToSelection`、`panBy(dx, dy)`、`centerOn(world)`、`screenToWorld`、`worldToScreen`、`getObjectScreenRect(id)`、`getContentBounds()`。

選取與指令（每個使用者動作一個 Yjs transaction，origin 為 `localOrigin`，前後呼叫 `undoManager.stopCapturing()`）：
`select`、`selectAll`、`clearSelection`、`deleteSelection`、`duplicateSelection`、`group`、`ungroup`、`bringForward`、`sendBackward`、`bringToFront`、`sendToBack`、`setLocked`、`align`、`distribute`、`setStyle`、`copyStyle`、`pasteStyle`、`updateObject(id, patch)`（`text` 傳字串時以純文字覆寫）、`extend(dir)`、`autoLayout(dir)`、`insert(input, { select, atViewportCenter })`、`insertWithTool(tool)`、`insertImageFile(blob, at?)`、`undo`、`redo`。
表格：`tableInsertRow(tableId, rowId, 'above'|'below')`、`tableInsertColumn(tableId, colId, 'left'|'right')`、`tableDeleteRow`、`tableDeleteColumn`。

`state.can` 告訴工具列與右鍵選單哪些指令可用（例如選取含區塊時 `can.group === false`）；`state.selectionLocked` 表示選取全部鎖定。

其他匯出：`DEFAULT_PALETTE`、`SHAPE_ICON_NAMES`（常用 Lucide 圖示，PascalCase；`icon` 欄位存這個名稱）、`loadAllIconNames()`（動態載入全部 Lucide 圖示名稱，非常用圖示在第一次繪製時才載入）、`TEXT_METRICS`、`FONT_FAMILY`、`EditorModel`、`SceneStore`、`registerRenderer`。

## 給 web app 的整合協定

### 文字編輯覆蓋層

引擎只管理狀態與幾何，文字由 web app 疊上的 Tiptap 編輯。

1. 進入編輯：雙擊、Enter、選取後直接打字（`state.editing.seed` 為第一個字元）、文字工具、`startEditing(id, { field, cellKey })`
2. `state.editing = { id, field: 'text'|'title'|'label'|'cell', cellKey?, seed? }`；編輯中的文字不畫在畫布上
3. `getEditingFragment()`：`text`（形狀、自由文字、線框圖）與 `cell`（表格儲存格）回傳要綁定的 `Y.XmlFragment`；`title`（區塊標題）與 `label`（連線標籤）是純字串欄位，回傳 null，請用單行輸入框並以 `updateObject(id, { title | label })` 寫回
4. `getEditingGeometry()`（也在 `state.editingGeometry`，相機或物件變動時更新）：
   - `x, y, w, h`（= `screenRect`）：文字框在容器內的位置（CSS px，已扣除內距，未旋轉的框）；旋轉以框中心為原點，角度 `rotation`
   - `fontSize`（世界座標字級）、`zoom`：覆蓋層字級 = `fontSize * zoom`
   - `fontFamily`、`fontWeight`、`lineHeight`（1.4）、`color`、`textAlign`、`verticalAlign`
   - `autoWidth`：自由文字未固定寬度，不要換行；`autoHeight`：高度隨內容增長
5. seed：覆蓋層綁定後以 seed 取代全部內容並把游標放在最後（引擎不改內容）。輸入法組字（`Process` 鍵）時引擎只進入編輯，不帶 seed
6. 文字變動後，引擎自動以 `localOrigin` 更新自動增高形狀的 `h` 與自由文字的 `w/h`（與打字合併為同一個復原步驟，需要 `extraTrackedOrigins` 包含 Tiptap 的 origin）
7. 結束：覆蓋層 Esc／失焦時呼叫 `stopEditing()` 再 `focus()`。空白的自由文字在結束時刪除（剛建立的會直接復原建立動作）
8. 排版度量必須一致（`TEXT_METRICS` 與 shared 的 `RICH_TEXT_STYLE`）：
   - 行高 1.4，段落、標題、列表、程式碼區塊之間沒有額外間距；標題字級 × `headingScale`（1.6 / 1.35 / 1.15）、粗體
   - 列表（項目符號、編號、核取清單）每層縮排 1.3em（= `ul/ol { padding-left: 1.3em }`），符號畫在這 1.3em 的欄內；項目符號右緣在欄右邊往左 5px
   - 核取方塊：邊長 0.9em、圓角 3px、邊框 1.5px `checkboxBorder`（畫在方塊內側），勾選時填 `checkboxChecked` 加白色勾；水平置於 1.3em 符號欄中央（左緣 = 該層縮排起點 + 0.2em），垂直置於第一行行框中央（上緣 = 行頂 + (1.4em − 0.9em) / 2）
   - 行內程式碼：等寬字型 0.9em，左右各 2px 內距（計入前進寬度），底色 `inlineCodeBg`、圓角 3px，底色高 1.25em、垂直置中於行框
   - 螢光：在該段文字後方畫底色，寬為文字寬，高為行框中間 80%
   - 刪除線：文字顏色，位置在基線上方 0.3em，粗細 0.06em（至少 1 個螢幕像素）；連結底線在基線下方 0.12em
   - 程式碼區塊：等寬字型 0.9em、行高 1.4（以 0.9em 計）、四周 8px 內距、圓角 4px、底色 `codeBlockBg`，佔滿文字框寬度並靠左；保留空白與換行，過長的行逐字換行；Tab 視為 4 個空白（overlay 請設 `tab-size: 4`）
   - 字級可到 128px（`FONT_SIZE_SCALE`），自動寬度與自動增高都依排版結果計算
9. 核取清單：物件**已選取且不在編輯中**時，點擊方塊（含 3px 容差）會切換對應 `taskItem` 的 `checked` 屬性（一個 localOrigin transaction、一步復原），形狀、自由文字與表格儲存格都適用。`model.toggleTask(id, 'text' | 'cell', cellKey, ordinal)`；`taskItems(fragment)` 依文件順序回傳 taskItem 元素（與排版中 `line.task.ordinal` 對應）

### 放置複本

`startPlacingDuplicate(): boolean` 進入放置模式（唯讀或沒有選取時回傳 false）：複製範圍與剪貼簿相同（單位、子孫、兩端都在範圍內的連線），預覽以 0.85 不透明度畫在互動層、外接框左上角對齊指標並吸附格線（按住 Alt 不吸附），外框以選取色虛線標示；指標不在畫布上時不顯示預覽。平移與縮放時預覽維持在指標下方。放置期間不寫入文件。在畫布上按下主要按鍵即以一個 localOrigin transaction（一步復原）建立複本、頂層複本依中心點歸屬區塊、選取複本；這次點擊不會開始框選或拖曳。Esc、右鍵（不開右鍵選單）、`cancelPlacing()`、切換工具或開始編輯都會取消。`state.placing` 表示是否在放置模式；游標為 `copy`。Mod+D 仍是立即位移複製。模型層：`model.preparePlacement()`、`placementSnapshots()`、`placementTopLeft()`、`commitPlacement()`。

### 快速連線選單（第 3.4 節）

從形狀邊緣的連接點拖出連線並放在空白處 → `state.quickConnect = { screen, world, fromId }`，畫布上會顯示虛線預覽。web app 在 `screen` 位置顯示形狀選單：`completeQuickConnect(shapeKind)` 以一個 transaction 建立形狀與連線並選取新形狀；`cancelQuickConnect()` 取消（Esc、點擊畫布也會取消）。

### 右鍵選單

`contextmenu` 事件由引擎攔截：`state.contextMenu = { screen, targetId, cellKey? }`（點在物件上時會先選取它；在表格上會帶儲存格 key）。web app 畫 Radix 選單，關閉時呼叫 `closeContextMenu()`。選單中的複製／剪下／貼上使用 `copySelectionToClipboard()`、`cutSelectionToClipboard()`、`pasteFromClipboard()`（非同步 Clipboard API，自訂格式 `web application/x-tinycanvas+json`，退回 text/plain）。

### 刪除區塊

`deleteSelection()` 遇到選取內有「含子物件的區塊」時不刪除，而是設定 `state.pendingSectionDelete = { sectionIds, ids }`。web app 顯示對話框後呼叫 `resolveSectionDelete('section-only' | 'with-contents' | null)`（null = 取消；也可直接用 `deleteSelection({ sectionMode })` / `cancelSectionDelete()`）。只刪區塊時子物件改為頂層、位置不變。接在被刪物件上的連線一併刪除。剪下（Mod+X）一律連同內容。

### 匯出與小地圖

- `exportPng({ scope, scale, background })`：同一套繪製程式畫到離屏 canvas（外接框＋24px），先 `document.fonts.load()` 所有文字需要的字型子集並等待圖片。超過 8192px 丟出 `ExportTooLargeError`，範圍內沒有物件丟出 `ExportEmptyError`
- `renderMinimap(canvas)`：內容以快取圖片重用，只在內容變動時重畫；`minimapToWorld(canvas, offsetX, offsetY)` 把小地圖上的點轉成世界座標（再呼叫 `centerOn`）

### 鍵盤

引擎在自己的可聚焦元素（`editor.element`，tabIndex=0）上處理：R/O/T/L/V/H/S、按住空白鍵平移、Delete/Backspace、Mod+A/D/G/Shift+G/Z/Shift+Z/Y、Mod+Shift+L 鎖定、Mod+Alt+方向鍵延伸、方向鍵移動（Shift = 一格 8px；沒有選取或唯讀時平移畫面）、Enter 編輯或進入群組、Esc（結束編輯 → 關閉選單 → 取消工具 → 退出群組 → 清除選取）、Tab / Shift+Tab 依閱讀順序切換選取、Mod+= / Mod+- / Mod+0、Shift+1 縮放至全部、Shift+2 縮放至選取。Mod 在 macOS 是 Cmd。
**不攔截**：Mod+K、Mod+/、`/`、`W`、Mod+Shift+E（由 web app 處理）。編輯文字時引擎不處理任何按鍵。

## 渲染器擴充（線框圖、表格、裝置框）

```ts
import { registerRenderer, type ObjectRenderer } from '@tinycanvas/canvas-engine';

registerRenderer<WireframeObject>('wireframe', {
  draw(ctx, o, rc) { /* ctx 已是世界座標；rc.zoom 是螢幕縮放；rc.text 是排版快取；rc.editing 判斷是否隱藏文字 */ },
  drawLod(batch, o, rc) { /* 選用：低縮放時加進 batch.fill(color) / batch.stroke(color, w) / batch.bar()，回傳 true */ },
  hitTest(o, localPoint, rc, tol) { /* 選用：預設以外接框命中；回傳 'body' 表示可框選的本體（像區塊） */ },
  getTextBox(o, field, cellKey, rc) { /* 選用：編輯覆蓋層的文字框（世界座標、未旋轉、已扣內距） */ },
});
```

內建：shape（20 種）、text、section（含裝置框）、connector、image、link_card、group（不繪製）、wireframe（42 種）、table。未知類型畫成淡色佔位框。旋轉的物件由各渲染器自行處理（`draw` 收到的 ctx 未旋轉；內建渲染器以物件中心旋轉）。

## 線框圖、裝置框與表格（M6，第 4.2、4.4 節）

### 線框圖元件（`render/wireframe.ts`）

- 42 種 `WIREFRAME_KINDS` 都有低保真渲染器（灰階＋系統主色 `#0087dc`；一致的 1px 線、4–8px 圓角、內距），低縮放時批次繪製
- `WIREFRAME_DEFAULTS[kind]` / `wireframeDefaults(kind)`：預設尺寸、主要文字與 props（例如按鈕「按鈕」、輸入框「請輸入…」、分頁 `items`/`active`、核取方塊 `checked`、滑桿與進度 `value`（0–1）、評分 `value`/`max`、表格 `columns`/`rows`、對話框 `body`/`buttons`）。`insert()` 與 `insertWithTool()` 沒給 props/text 時自動套用
- 主要文字存在物件的 `text`（Enter／雙擊編輯、可搜尋）；`wireframeHasText(kind)` 為 false 的元件（滑桿、分頁、進度等）沒有文字欄位，結構化項目放在 `props`
- 編輯幾何：`getEditingGeometry()` 回傳該元件文字的字級、粗細、顏色、對齊；單行元件（按鈕、輸入框…）`autoWidth = true`
- 點擊切換：元件**已被選取**時，放開滑鼠且沒有拖曳 → 切換核取方塊／單選／開關的 `checked`、分頁與分段控制的 `active`、評分、手風琴展開項目、側欄與分頁器的目前項目；一個 transaction、一步復原（`model.setWireframeProps`）。核取方塊等只在控制項本身（不含文字）上切換，雙擊文字仍是編輯
- 永遠不可旋轉

### 裝置框（`frames.ts`）

- `section.frameKind` 為 phone / tablet / browser / window 時畫出裝置外觀（手機：機身、瀏海與狀態列、Home 指示條；平板：機身、鏡頭、狀態列；瀏覽器：分頁列（含點）＋網址列；視窗：標題列與中性的最小化／最大化／關閉控制）
- 預設尺寸 `FRAME_SIZES`：375×812、768×1024、1280×800、960×640
- 拖入判定使用**內容區**（`sectionContentRect`，不含外框與介面列）；其餘完全是區塊規則（移動帶著內容、縮放不縮放內容、刪除詢問）。容器規則的單元測試對一般區塊與四種裝置框各跑一次
- 標題畫在外框上方（空間索引範圍向上延伸 `FRAME_TITLE_SPACE`），雙擊或 Enter 編輯（field `title`）
- Wireflow：裝置框與線框圖元件都有連接點；把連線拖到裝置框的內容區會接在裝置框上

### 表格（`render/table.ts`）

- 表頭列（`headerRow`）淡灰底＋粗體、格線、圓角外框、儲存格內距 8px、儲存格富文本；本地編輯儲存格後列高自動增長（`localOrigin`，與打字同一步復原）
- 編輯：雙擊儲存格或 Enter（第一格）→ `startEditing(id, { field: 'cell', cellKey })`；`getEditingFragment()` / `getEditingGeometry()` 回傳該儲存格。編輯前若儲存格不存在（兩個分頁同時增加列與欄造成），引擎會先補上
- **Tab**：`editor.moveEditingCell(dx, dy)` 移到相鄰儲存格（Tab = (1,0)、Shift+Tab = (-1,0)），最後一格按 Tab 會新增一列。packages/editor 的覆蓋層會 `stopPropagation` 按鍵，所以**覆蓋層要攔截 Tab 並呼叫 `moveEditingCell`**；若 Tab 事件傳到引擎根元素，引擎也會自己處理。切換儲存格時引擎不會把焦點拉回畫布
- 增刪列與欄：`tableInsertRow(tableId, rowId, 'above'|'below')`、`tableInsertColumn(tableId, colId, 'left'|'right')`、`tableDeleteRow`、`tableDeleteColumn`；各為一個 transaction，儲存格以 `rowId:colId` 建立與刪除
- 選取單一表格時，欄與列的邊界可以拖曳調整欄寬（最小 40）與列高（最小 28，且不小於內容）；以選取框把手縮放表格時欄寬與列高依比例
- 在表格上按右鍵：`state.contextMenu.cellKey`
- 新表格預設 3×3、120×40、有表頭列

`insertWithTool(tool)` 支援所有工具：shape、text（含 `variant: 'heading'`）、section、frame、wireframe、table，在畫面中心以預設尺寸建立並選取（文字直接進入編輯）；connector／select／hand 只切換工具。

## 容器規則（第 3.3 節）的實作重點

- 所有座標都是絕對座標；移動容器在同一個 transaction 改寫所有子孫
- 拖曳放開時以單位外接框中心判定區塊（重疊時取 `compareZ` 最大者）；拖曳區塊本身不吸入物件；群組內的子物件不個別判定
- 群組的外接框在每個本地 transaction 結束前（同一個 transaction 內）重算；其他分頁、離線合併、復原造成的變動以 `systemOrigin` 補算，數值相同時不寫入；沒有子物件的群組會被刪除
- 繪製順序：頂層非連線物件依 `(z, id)`，容器子物件緊接在容器後並在容器內排序，所有連線最後
- 不合法的 `z`（其他用戶端寫入）不會讓指令失敗（`safeZBetween`）

## 與合約的差異／補充

- `EditorState` 多了 `pendingSectionDelete`、`editingGeometry`、`can`、`selectionLocked`；`contextMenu` 可帶 `cellKey`；`EditingGeometry` 同時有扁平的 `x/y/w/h` 與 `screenRect`
- 新增方法：`resolveSectionDelete`、`cancelSectionDelete`、`closeContextMenu`、`insertWithTool`、`copySelectionToClipboard`、`cutSelectionToClipboard`、`pasteFromClipboard`、`minimapToWorld`、表格列與欄的增刪、`element`
- `labels` 的 key 為 `sectionTitle`、`frame`、`untitledLink`、`imageLoading`、`imageError`、`unsupported`
- 連線的 `waypoints` 不使用（一律自動路由）；連線本身的 `x/y/w/h` 只在建立時寫入，實際範圍由端點決定
- 拖曳過程不寫入 Yjs（其他分頁在放開時才看到結果），確保一次拖曳是一個 transaction
