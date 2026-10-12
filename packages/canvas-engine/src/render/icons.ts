// 形狀內嵌的 Lucide 圖示（見 SPEC.md 第 4.1 節）。
// 常用圖示靜態載入（SHAPE_ICON_NAMES）；其他 Lucide 圖示在第一次需要時以動態 import 載入整個圖示集。
import {
  Activity, Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Award, Battery, Bell, Bluetooth, Bookmark,
  Bot, Box, Boxes, Brain, Briefcase, Bug, Building, Building2, Calendar, Camera, ChartBar, ChartLine, ChartPie, Check,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  CircleAlert, CircleCheck, CircleQuestionMark, CircleX, Clipboard, ClipboardList, Clock, Cloud, Code, Coffee, Cog,
  Compass, Component, Container, Cpu, CreditCard, Database, DollarSign, Download, ExternalLink, Eye, EyeOff, Factory, File,
  FileText, FingerprintPattern, Flag, Folder, FolderOpen, Funnel, Gift, GitBranch, GitMerge, GitPullRequest, Globe,
  Grid3x3, HardDrive, Heart, Hourglass, House, Image, Inbox, Info, Key, KeyRound, Laptop, Layers, LayoutDashboard,
  Lightbulb, Link, List, Lock, LockOpen, Mail, Map, MapPin, MessageCircle, MessageSquare, Mic, Minus, Monitor, Moon,
  Music, Navigation, Network, Package, Pause, Pencil, Phone, Play, Plug, Plus, Power, Printer, Puzzle, QrCode, Radio,
  Receipt, RefreshCw, Repeat, Rocket, Router, Save, Scan, Search, Send, Server, Settings, Share2, Shield, ShieldCheck,
  ShoppingCart, Smartphone, Sparkles, SquarePen, Star, Store, Sun, Table, Tablet, Tag, Target, Terminal, ThumbsDown,
  ThumbsUp, Timer, Trash2, TrendingUp, TriangleAlert, Truck, Upload, User, Users, Video, Wallet, Webhook, Wifi,
  Workflow, X, Zap,
} from 'lucide';

type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][];

const CURATED: Record<string, IconNode> = {
  Activity, Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Award, Battery, Bell, Bluetooth, Bookmark,
  Bot, Box, Boxes, Brain, Briefcase, Bug, Building, Building2, Calendar, Camera, ChartBar, ChartLine, ChartPie, Check,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  CircleAlert, CircleCheck, CircleQuestionMark, CircleX, Clipboard, ClipboardList, Clock, Cloud, Code, Coffee, Cog,
  Compass, Component, Container, Cpu, CreditCard, Database, DollarSign, Download, ExternalLink, Eye, EyeOff, Factory, File,
  FileText, FingerprintPattern, Flag, Folder, FolderOpen, Funnel, Gift, GitBranch, GitMerge, GitPullRequest, Globe,
  Grid3x3, HardDrive, Heart, Hourglass, House, Image, Inbox, Info, Key, KeyRound, Laptop, Layers, LayoutDashboard,
  Lightbulb, Link, List, Lock, LockOpen, Mail, Map, MapPin, MessageCircle, MessageSquare, Mic, Minus, Monitor, Moon,
  Music, Navigation, Network, Package, Pause, Pencil, Phone, Play, Plug, Plus, Power, Printer, Puzzle, QrCode, Radio,
  Receipt, RefreshCw, Repeat, Rocket, Router, Save, Scan, Search, Send, Server, Settings, Share2, Shield, ShieldCheck,
  ShoppingCart, Smartphone, Sparkles, SquarePen, Star, Store, Sun, Table, Tablet, Tag, Target, Terminal, ThumbsDown,
  ThumbsUp, Timer, Trash2, TrendingUp, TriangleAlert, Truck, Upload, User, Users, Video, Wallet, Webhook, Wifi,
  Workflow, X, Zap,
} as unknown as Record<string, IconNode>;

/** 可以放進形狀的 Lucide 圖示名稱（PascalCase，例如 'Database'）。形狀的 `icon` 欄位存這個名稱 */
export const SHAPE_ICON_NAMES: string[] = Object.keys(CURATED).sort();

let allIcons: Record<string, IconNode> | null = null;
let allIconsPromise: Promise<Record<string, IconNode>> | null = null;

/** 載入完整的 Lucide 圖示集（動態 import，另成一個 chunk）。回傳所有圖示名稱 */
export async function loadAllIconNames(): Promise<string[]> {
  return Object.keys(await loadAll()).sort();
}

function loadAll(): Promise<Record<string, IconNode>> {
  if (!allIconsPromise) {
    allIconsPromise = import('lucide').then((m) => {
      allIcons = (m as any).icons as Record<string, IconNode>;
      return allIcons;
    });
  }
  return allIconsPromise;
}

const pathCache = new globalThis.Map<string, Path2D | null>();
const pending = new Set<string>();

function nodeToPath(node: IconNode): Path2D {
  const p = new Path2D();
  const n = (v: unknown) => Number(v ?? 0);
  for (const [tag, a] of node) {
    switch (tag) {
      case 'path':
        p.addPath(new Path2D(String(a.d)));
        break;
      case 'circle':
        p.moveTo(n(a.cx) + n(a.r), n(a.cy));
        p.arc(n(a.cx), n(a.cy), n(a.r), 0, Math.PI * 2);
        break;
      case 'ellipse':
        p.moveTo(n(a.cx) + n(a.rx), n(a.cy));
        p.ellipse(n(a.cx), n(a.cy), n(a.rx), n(a.ry), 0, 0, Math.PI * 2);
        break;
      case 'rect': {
        const r = Math.min(n(a.rx ?? a.ry), n(a.width) / 2, n(a.height) / 2);
        if (r > 0 && 'roundRect' in p) (p as any).roundRect(n(a.x), n(a.y), n(a.width), n(a.height), r);
        else p.rect(n(a.x), n(a.y), n(a.width), n(a.height));
        break;
      }
      case 'line':
        p.moveTo(n(a.x1), n(a.y1));
        p.lineTo(n(a.x2), n(a.y2));
        break;
      case 'polyline':
      case 'polygon': {
        const pts = String(a.points ?? '')
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        if (pts.length >= 2) {
          p.moveTo(pts[0], pts[1]);
          for (let i = 2; i + 1 < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
          if (tag === 'polygon') p.closePath();
        }
        break;
      }
    }
  }
  return p;
}

/**
 * 取得圖示的 Path2D（24×24 座標，以描邊繪製）。尚未載入的非常用圖示回傳 null，
 * 並在載入完成後呼叫 onLoad（呼叫端應重繪）。
 */
export function getIconPath(name: string, onLoad?: () => void): Path2D | null {
  const hit = pathCache.get(name);
  if (hit !== undefined) return hit;
  const node = CURATED[name] ?? allIcons?.[name];
  if (node) {
    const p = nodeToPath(node);
    pathCache.set(name, p);
    return p;
  }
  if (!allIcons && !pending.has(name)) {
    pending.add(name);
    loadAll().then(
      () => {
        pending.delete(name);
        if (!allIcons?.[name]) pathCache.set(name, null);
        onLoad?.();
      },
      () => pathCache.set(name, null),
    );
  } else if (allIcons) {
    pathCache.set(name, null);
  }
  return null;
}

/** 以 Path2D 在 (x, y) 畫一個 size 大小的圖示 */
export function drawIcon(ctx: CanvasRenderingContext2D, path: Path2D, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  const s = size / 24;
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.restore();
}
