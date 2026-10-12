// 圖示庫的中文搜尋關鍵字 → Lucide 圖示名稱。英文名稱直接比對圖示名稱，不需要列在這裡
export const ICON_KEYWORDS: Record<string, string[]> = {
  資料庫: ['Database', 'DatabaseZap', 'Server'],
  伺服器: ['Server', 'ServerCog'],
  雲: ['Cloud', 'CloudUpload', 'CloudDownload'],
  使用者: ['User', 'Users', 'UserRound', 'CircleUserRound'],
  人: ['User', 'Users', 'PersonStanding'],
  團隊: ['Users', 'UsersRound'],
  設定: ['Settings', 'Settings2', 'Cog', 'SlidersHorizontal'],
  首頁: ['House'],
  搜尋: ['Search'],
  郵件: ['Mail', 'Inbox', 'Send'],
  信: ['Mail'],
  電話: ['Phone', 'Smartphone'],
  手機: ['Smartphone'],
  電腦: ['Laptop', 'Monitor'],
  檔案: ['File', 'FileText', 'Folder'],
  資料夾: ['Folder', 'FolderOpen'],
  文件: ['FileText', 'Files'],
  圖片: ['Image', 'Images'],
  相機: ['Camera'],
  影片: ['Video', 'Film'],
  音樂: ['Music'],
  日曆: ['Calendar', 'CalendarDays'],
  時間: ['Clock', 'Timer', 'Hourglass'],
  鎖: ['Lock', 'LockOpen'],
  安全: ['Shield', 'ShieldCheck', 'Lock'],
  鑰匙: ['Key', 'KeyRound'],
  錢: ['DollarSign', 'Banknote', 'Wallet', 'Coins'],
  付款: ['CreditCard', 'Wallet'],
  購物: ['ShoppingCart', 'ShoppingBag', 'Store'],
  商店: ['Store'],
  訊息: ['MessageSquare', 'MessageCircle'],
  聊天: ['MessagesSquare', 'MessageCircle'],
  通知: ['Bell', 'BellRing'],
  星: ['Star'],
  愛心: ['Heart'],
  讚: ['ThumbsUp'],
  警告: ['TriangleAlert', 'CircleAlert'],
  錯誤: ['CircleX', 'OctagonX', 'Bug'],
  成功: ['CircleCheck', 'Check'],
  勾: ['Check', 'CircleCheck'],
  問題: ['CircleQuestionMark'],
  資訊: ['Info'],
  下載: ['Download'],
  上傳: ['Upload'],
  分享: ['Share2', 'Share'],
  連結: ['Link', 'Link2'],
  地圖: ['Map', 'MapPin'],
  位置: ['MapPin', 'Navigation'],
  地球: ['Globe', 'Earth'],
  網路: ['Wifi', 'Globe', 'Network'],
  程式: ['Code', 'CodeXml', 'Terminal'],
  終端機: ['Terminal', 'SquareTerminal'],
  蟲: ['Bug'],
  機器人: ['Bot'],
  AI: ['Bot', 'Sparkles', 'Brain'],
  大腦: ['Brain'],
  燈泡: ['Lightbulb'],
  想法: ['Lightbulb'],
  圖表: ['ChartBar', 'ChartLine', 'ChartPie', 'ChartColumn'],
  報表: ['ChartBar', 'FileChartColumn'],
  趨勢: ['TrendingUp', 'TrendingDown'],
  目標: ['Target', 'Goal'],
  旗子: ['Flag'],
  工具: ['Wrench', 'Hammer'],
  建築: ['Building', 'Building2'],
  工廠: ['Factory'],
  公司: ['Building2', 'Briefcase'],
  工作: ['Briefcase'],
  車: ['Car', 'Truck'],
  卡車: ['Truck'],
  飛機: ['Plane'],
  火箭: ['Rocket'],
  貨物: ['Package', 'Box', 'Boxes'],
  箱子: ['Box', 'Package'],
  庫存: ['Warehouse', 'Package'],
  訂單: ['ClipboardList', 'Receipt'],
  收據: ['Receipt'],
  清單: ['List', 'ListChecks', 'ClipboardList'],
  待辦: ['ListTodo', 'SquareCheck'],
  編輯: ['Pencil', 'SquarePen'],
  刪除: ['Trash2'],
  新增: ['Plus', 'CirclePlus'],
  箭頭: ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'MoveRight'],
  重新整理: ['RefreshCw', 'RotateCw'],
  播放: ['Play'],
  暫停: ['Pause'],
  停止: ['Square', 'OctagonX'],
  書: ['Book', 'BookOpen'],
  學習: ['GraduationCap', 'BookOpen'],
  眼睛: ['Eye'],
  隱藏: ['EyeOff'],
  電池: ['Battery'],
  電源: ['Power', 'Plug'],
  閃電: ['Zap'],
  太陽: ['Sun'],
  月亮: ['Moon'],
  咖啡: ['Coffee'],
  禮物: ['Gift'],
  獎: ['Award', 'Trophy'],
  獎盃: ['Trophy'],
  API: ['Webhook', 'Plug', 'Cable'],
  佇列: ['ListOrdered', 'Layers'],
  容器: ['Container', 'Box'],
  晶片: ['Cpu', 'Microchip'],
  硬碟: ['HardDrive'],
  鍵盤: ['Keyboard'],
  滑鼠: ['Mouse'],
  印表機: ['Printer'],
  掃描: ['ScanLine', 'QrCode'],
  條碼: ['Barcode', 'QrCode'],
  圖層: ['Layers'],
  元件: ['Component', 'Puzzle'],
  拼圖: ['Puzzle'],
  流程: ['Workflow', 'GitBranch'],
  分支: ['GitBranch', 'Split'],
  合併: ['GitMerge', 'Merge'],
  同步: ['RefreshCw', 'ArrowLeftRight'],
};

/**
 * 搜尋圖示。排序：中文關鍵字 → 名稱開頭相符 → 名稱包含 → Lucide 標籤完全相符 → 標籤部分相符。
 * tags 為 Lucide 官方的圖示標籤（lucide-tags.json，例如 RotateCcw 帶有 retry、undo、refresh），
 * 與 lucide.dev 的搜尋結果一致。
 */
export function searchIcons(all: string[], query: string, tags?: Record<string, string> | null, limit = 160): string[] {
  const q = query.trim();
  if (!q) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const valid = new Set(all);
  const push = (n: string) => {
    if (!seen.has(n) && valid.has(n)) {
      seen.add(n);
      out.push(n);
    }
  };
  for (const [k, names] of Object.entries(ICON_KEYWORDS)) {
    if (k.includes(q) || q.includes(k)) names.forEach(push);
  }
  // 英文名稱：忽略大小寫與連字號（"arrow-right"、"arrow right" 都能找到 ArrowRight）
  const norm = q.toLowerCase().replace(/[\s_-]+/g, '');
  if (norm) {
    all.filter((n) => n.toLowerCase().startsWith(norm)).forEach(push);
    all.filter((n) => n.toLowerCase().includes(norm)).forEach(push);
  }
  if (tags) {
    const lower = q.toLowerCase();
    const exact: string[] = [];
    const partial: string[] = [];
    for (const n of all) {
      const t = tags[n];
      if (!t) continue;
      const list = t.split(' | ');
      if (list.includes(lower)) exact.push(n);
      else if (list.some((x) => x.includes(lower))) partial.push(n);
    }
    exact.forEach(push);
    partial.forEach(push);
  }
  return out.slice(0, limit);
}
