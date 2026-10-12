import { createContext, useContext, useState } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PanelLeftOpen } from 'lucide-react';
import { IconButton, Spinner, strings } from '@tinycanvas/ui';
import { api, setCsrfToken } from '../api/client';
import { keys, useMe } from '../api/hooks';
import { clearUserCaches, hasUnsyncedChanges } from '../lib/localCache';
import { useHotkeys } from '../lib/useHotkeys';
import { Sidebar } from './Sidebar';
import { SearchDialog } from './SearchDialog';
import { ShortcutsDialog } from './ShortcutsDialog';

interface LayoutCtx {
  sidebarOpen: boolean;
  setSidebarOpen: (o: boolean) => void;
  userId: string;
  openShortcuts: () => void;
}
const Ctx = createContext<LayoutCtx>({ sidebarOpen: true, setSidebarOpen: () => {}, userId: '', openShortcuts: () => {} });
export const useLayout = () => useContext(Ctx);

function readSidebarPref(): boolean {
  try {
    return localStorage.getItem('tc:sidebar') !== 'closed';
  } catch {
    return true;
  }
}

/** 登入後的版面：側邊欄 + 內容；處理 Mod+K 搜尋與 Mod+/ 快捷鍵說明 */
export function AppLayout() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [sidebarOpen, setSidebarOpenState] = useState(readSidebarPref);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const setSidebarOpen = (o: boolean) => {
    setSidebarOpenState(o);
    try {
      localStorage.setItem('tc:sidebar', o ? 'open' : 'closed');
    } catch {
      /* 無法寫入時忽略 */
    }
  };

  useHotkeys([
    { combo: 'Mod+K', handler: () => setSearchOpen(true) },
    { combo: 'Mod+/', handler: () => setHelpOpen((o) => !o), allowInInput: true },
  ]);

  if (me.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!me.data) return <Navigate to="/login" replace />;
  const user = me.data.user;

  const logout = async () => {
    if (hasUnsyncedChanges() && !window.confirm(strings.auth.unsyncedWarning)) return;
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    await clearUserCaches(user.id);
    setCsrfToken(null);
    qc.clear();
    qc.setQueryData(keys.me, null);
    nav('/login', { replace: true });
  };

  return (
    <Ctx.Provider value={{ sidebarOpen, setSidebarOpen, userId: user.id, openShortcuts: () => setHelpOpen(true) }}>
      <div className="flex h-full">
        {sidebarOpen ? (
          <Sidebar email={user.email} onSearch={() => setSearchOpen(true)} onLogout={logout} onCollapse={() => setSidebarOpen(false)} />
        ) : null}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-auto">
          {!sidebarOpen ? (
            <div className="pointer-events-none absolute left-2 top-2 z-30">
              <IconButton
                className="pointer-events-auto bg-white shadow-float"
                label={strings.sidebar.expand}
                onClick={() => setSidebarOpen(true)}
              >
                <PanelLeftOpen className="h-4 w-4" />
              </IconButton>
            </div>
          ) : null}
          <Outlet />
        </main>
      </div>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <ShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </Ctx.Provider>
  );
}
