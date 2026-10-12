import { strings } from '@tinycanvas/ui';

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold text-ink-900">
      <img src="/favicon.svg" alt="" className="h-6 w-6" />
      {compact ? null : <span>{strings.app.name}</span>}
    </span>
  );
}
