import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Slot } from '@radix-ui/react-slot';
import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import { cn, shortcutLabel } from './utils';

// ---------- Button ----------
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  asChild?: boolean;
  loading?: boolean;
}
const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-300',
  secondary: 'bg-white text-ink-800 border border-ink-200 hover:bg-ink-50 disabled:text-ink-400',
  ghost: 'text-ink-700 hover:bg-ink-100 disabled:text-ink-300',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
};
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', asChild, loading, className, children, disabled, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:cursor-not-allowed',
        size === 'sm' ? 'h-8 px-2.5 text-sm' : 'h-9 px-3.5 text-sm',
        variantClass[variant],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </Comp>
  );
});

// ---------- Tooltip ----------
export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({
  content,
  shortcut,
  side = 'bottom',
  children,
}: {
  content: React.ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactElement;
}) {
  return (
    <TooltipPrimitive.Root delayDuration={350}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 flex items-center gap-2 rounded-md bg-ink-900 px-2 py-1 text-xs text-white shadow-float"
        >
          {content}
          {shortcut ? <span className="text-ink-300">{shortcutLabel(shortcut)}</span> : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// ---------- IconButton ----------
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
}
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, active, className, children, tooltipSide, ...props },
  ref,
) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-700 transition-colors hover:bg-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:text-ink-300 disabled:hover:bg-transparent',
          active && 'bg-brand-100 text-brand-800 hover:bg-brand-100',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  );
});

// ---------- Input ----------
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200',
          className,
        )}
        {...props}
      />
    );
  },
);

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-ink-700">{label}</span>
      {children}
      {hint ? <span className="text-xs text-ink-500">{hint}</span> : null}
    </label>
  );
}

// ---------- Dialog ----------
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  width = 'max-w-md',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink-900/30" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-[12vh] z-50 max-h-[76vh] w-[calc(100vw-32px)] -translate-x-1/2 overflow-auto rounded-2xl bg-white p-5 shadow-float focus:outline-none',
            width,
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold text-ink-900">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-sm text-ink-500">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="rounded-md p-1 text-ink-500 hover:bg-ink-100" aria-label="close">
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------- Confirm ----------
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  actions,
  cancelLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  cancelLabel: string;
  actions: { label: string; variant?: ButtonVariant; onSelect: () => void }[];
}) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink-900/30" />
        <AlertDialogPrimitive.Content className="fixed left-1/2 top-[20vh] z-50 w-[calc(100vw-32px)] max-w-sm -translate-x-1/2 rounded-2xl bg-white p-5 shadow-float">
          <AlertDialogPrimitive.Title className="text-base font-semibold">{title}</AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="mt-2 text-sm text-ink-600">{message}</AlertDialogPrimitive.Description>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="ghost">{cancelLabel}</Button>
            </AlertDialogPrimitive.Cancel>
            {actions.map((a) => (
              <AlertDialogPrimitive.Action asChild key={a.label}>
                <Button variant={a.variant ?? 'primary'} onClick={a.onSelect}>
                  {a.label}
                </Button>
              </AlertDialogPrimitive.Action>
            ))}
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

// ---------- Menu ----------
export const Menu = DropdownPrimitive.Root;
export const MenuTrigger = DropdownPrimitive.Trigger;
export const MenuSub = DropdownPrimitive.Sub;

// 選單超過可用高度時在內部捲動，不會被推出視窗外
const menuContentClass =
  'z-50 min-w-[200px] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-xl border border-ink-100 bg-white p-1 text-sm shadow-float';

export const MenuContent = React.forwardRef<HTMLDivElement, DropdownPrimitive.DropdownMenuContentProps>(
  function MenuContent({ className, sideOffset = 4, ...props }, ref) {
    return (
      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content
          ref={ref}
          sideOffset={sideOffset}
          collisionPadding={8}
          className={cn(menuContentClass, className)}
          {...props}
        />
      </DropdownPrimitive.Portal>
    );
  },
);

export function MenuItem({
  children,
  shortcut,
  icon,
  danger,
  ...props
}: DropdownPrimitive.DropdownMenuItemProps & { shortcut?: string; icon?: React.ReactNode; danger?: boolean }) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        'flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-ink-100 data-[disabled]:text-ink-300',
        danger && 'text-red-600',
      )}
      {...props}
    >
      <span className="flex h-4 w-4 items-center justify-center text-ink-500">{icon}</span>
      <span className="flex-1">{children}</span>
      {shortcut ? <span className="text-xs text-ink-400">{shortcutLabel(shortcut)}</span> : null}
    </DropdownPrimitive.Item>
  );
}

export function MenuCheckboxItem({
  children,
  checked,
  onCheckedChange,
}: {
  children: React.ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <DropdownPrimitive.CheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 outline-none data-[highlighted]:bg-ink-100"
    >
      <span className="flex h-4 w-4 items-center justify-center">
        <DropdownPrimitive.ItemIndicator>
          <Check className="h-4 w-4 text-brand-600" />
        </DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.CheckboxItem>
  );
}

export function MenuSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-ink-100" />;
}

export function MenuSubTrigger({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <DropdownPrimitive.SubTrigger className="flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 outline-none data-[highlighted]:bg-ink-100 data-[state=open]:bg-ink-100">
      <span className="flex h-4 w-4 items-center justify-center text-ink-500">{icon}</span>
      <span className="flex-1">{children}</span>
      <ChevronRight className="h-4 w-4 text-ink-400" />
    </DropdownPrimitive.SubTrigger>
  );
}

export function MenuSubContent(props: DropdownPrimitive.DropdownMenuSubContentProps) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.SubContent
        className={cn(menuContentClass, 'max-h-[min(60vh,var(--radix-dropdown-menu-content-available-height))]')}
        sideOffset={2}
        collisionPadding={8}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

/** 在指定螢幕座標開啟的選單（右鍵選單、快速建立選單） */
export function PointMenu({
  point,
  onClose,
  children,
}: {
  point: { x: number; y: number } | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownPrimitive.Root open={point !== null} onOpenChange={(o) => !o && onClose()} modal={false}>
      <DropdownPrimitive.Trigger asChild>
        <span
          aria-hidden
          style={{ position: 'fixed', left: point?.x ?? 0, top: point?.y ?? 0, width: 0, height: 0 }}
        />
      </DropdownPrimitive.Trigger>
      <MenuContent align="start" sideOffset={2}>
        {children}
      </MenuContent>
    </DropdownPrimitive.Root>
  );
}

// ---------- Popover ----------
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ className, ...props }: PopoverPrimitive.PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={6}
        className={cn('z-50 rounded-xl border border-ink-100 bg-white p-3 shadow-float focus:outline-none', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

// ---------- Switch ----------
export function Switch({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <SwitchPrimitive.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative h-5 w-9 rounded-full bg-ink-200 transition-colors data-[state=checked]:bg-brand-600"
      >
        <SwitchPrimitive.Thumb className="block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
      </SwitchPrimitive.Root>
    </label>
  );
}

// ---------- Segmented ----------
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  size = 'md',
  fullWidth,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; title?: string }[];
  /** sm：用於彈出面板內的緊湊版本 */
  size?: 'sm' | 'md';
  /** 平均分配寬度、填滿父元素 */
  fullWidth?: boolean;
}) {
  return (
    <div className={cn('rounded-lg bg-ink-100 p-0.5', fullWidth ? 'flex w-full' : 'inline-flex')} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex items-center justify-center rounded-md text-ink-600',
            size === 'sm' ? 'h-5 min-w-0 px-0.5 text-[11px]' : 'h-7 min-w-[32px] px-2 text-sm',
            fullWidth && 'flex-1',
            o.value === value && 'bg-white text-ink-900 shadow-sm',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Misc ----------
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-ink-400', className)} aria-hidden />;
}

export function Kbd({ combo }: { combo: string }) {
  return (
    <kbd className="rounded-md border border-ink-200 bg-ink-50 px-1.5 py-0.5 font-sans text-xs text-ink-700">
      {shortcutLabel(combo)}
    </kbd>
  );
}

export function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  React.useEffect(() => {
    if (!message) return;
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [message, onClose]);
  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-ink-900 px-4 py-2.5 text-sm text-white shadow-float"
    >
      {message}
    </div>
  );
}
