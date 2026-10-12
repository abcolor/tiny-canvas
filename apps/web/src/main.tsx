import '@fontsource-variable/noto-sans-tc';
import '@tinycanvas/editor/src/styles.css';
import './index.css';
import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Link, useRouteError } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Spinner, strings, TooltipProvider } from '@tinycanvas/ui';
import { AppLayout } from './components/AppLayout';
import { DialogsProvider } from './components/dialogs';
import { AuthPage } from './pages/AuthPage';
import { FileListPage } from './pages/FileListPage';
import { TrashPage } from './pages/TrashPage';

// 畫布引擎與編輯器較大，延後到開啟畫布時才載入
const BoardPage = lazy(() => import('./board/BoardPage').then((m) => ({ default: m.BoardPage })));
const SharePage = lazy(() => import('./board/SharePage').then((m) => ({ default: m.SharePage })));

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 10_000 } },
});

function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-600">
      <p>{strings.app.notFound}</p>
      <Link to="/" className="text-brand-700 hover:underline">
        {strings.app.backHome}
      </Link>
    </div>
  );
}

function RouteError() {
  const error = useRouteError();
  if (import.meta.env.DEV) console.error(error);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-600" role="alert">
      <p>{strings.app.genericError}</p>
      <button type="button" className="text-brand-700 hover:underline" onClick={() => location.reload()}>
        {strings.app.retry}
      </button>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/login', element: <AuthPage mode="login" /> },
  { path: '/signup', element: <AuthPage mode="signup" /> },
  {
    path: '/s/:token',
    element: (
      <Suspense fallback={<Loading />}>
        <SharePage />
      </Suspense>
    ),
  },
  {
    element: <AppLayout />,
    errorElement: <RouteError />,
    children: [
      { path: '/', element: <FileListPage mode="recent" /> },
      { path: '/favorites', element: <FileListPage mode="favorite" /> },
      { path: '/folder/:folderId', element: <FileListPage mode="folder" /> },
      { path: '/trash', element: <TrashPage /> },
      {
        path: '/b/:fileId',
        element: (
          <Suspense fallback={<Loading />}>
            <BoardPage />
          </Suspense>
        ),
      },
    ],
  },
  { path: '*', element: <NotFound /> },
]);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <DialogsProvider>
          <RouterProvider router={router} />
        </DialogsProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
