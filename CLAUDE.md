# TinyCanvas

個人用的視覺化白板（流程圖、線框圖）。完整規格見 docs/SPEC.md，進度見 docs/PROGRESS.md，實作決策見 docs/DECISIONS.md。

## 指令
- 安裝：pnpm install（第一次另外執行 `cp dev.env.example dev.env` 建立開發設定，以及 `git config core.hooksPath .githooks` 啟用 pre-push 檢查）
- 開發：docker compose -f docker-compose.dev.yml up -d && pnpm dev
- 測試：pnpm test（Vitest）、pnpm test:e2e（Playwright）、pnpm perf（畫布效能測試，需在開發機以 headed Chrome 執行）
- 檢查：pnpm check（依序執行 lint、typecheck、test；不使用雲端 CI，一律在本機跑）
- 資料庫：pnpm db:migrate（開發用）、pnpm db:generate
- 正式建置：docker compose up -d --build

## 範圍
- 只實作 SPEC.md 第 1–5 節列出的功能；第 6 節的延後項目（包含便利貼、心智圖、文件 Docs、序列圖）一律不做，但資料結構不得阻礙日後加入
- 每次只做一個里程碑（SPEC.md 第 12.3 節），完成的定義是該里程碑的驗收測試全部通過
- 規格沒寫清楚的地方，先停下來問，不要自行假設；確定後把結論寫進 docs/DECISIONS.md

## 技術選型
- 技術選型以 SPEC.md 第 7 節為準，不得替換；需要新增依賴時，要寫入 docs/DECISIONS.md 並說明理由
- 不得加入 Redis、佇列、AI、Email、收費或任何外部服務（含 Google Fonts、CDN）
- Prisma schema 只放在 packages/db；前後端共用的型別與 zod 結構放在 packages/shared
- packages/canvas-engine 不得依賴 React
- 圖示只使用 lucide-react
- 字型只使用自架的 @fontsource-variable/noto-sans-tc（SPEC.md 第 4.6 節）

## 畫布資料
- 畫布內容一律透過 Yjs 修改，React state 不得作為資料來源
- 使用者操作帶 `localOrigin`；回應遠端變更的自動寫入（例如重算群組外接框）帶 `systemOrigin`，不進入復原堆疊
- 會改動多個物件的操作（移動容器、群組、解除群組、自動排版、版本還原）必須放在同一個 Yjs transaction 內
- 物件座標一律是畫布絕對座標；容器、旋轉、z 順序的規則以 SPEC.md 第 3.2、3.3 節為準，每一條都要有單元測試
- 渲染器必須符合 SPEC.md 第 3.6 節：視窗裁切、空間索引、分層快取、LOD，不得每幀全部重繪

## 介面
- 介面文字集中在 packages/ui/src/i18n/ 的字典（en.ts 預設、zh-TW.ts），由 packages/ui/src/strings.ts 匯出，不得在元件內寫死字串；新增文字時兩份字典都要加
- 快捷鍵以 Mod 定義（macOS 為 Cmd，其他平台為 Ctrl），不得寫死 Ctrl
- 文字輸入必須通過注音與倉頡輸入法的組字測試

## 測試與提交
- 每個功能都要附單元測試；涉及儲存的功能，還要附多分頁一致性的 E2E 測試
- 每完成一個任務就 commit（使用 Conventional Commits 格式），並更新 docs/PROGRESS.md
- commit 前先跑 pnpm check
- 不得提交 .env 或任何金鑰
