import { useRef, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { create } from 'zustand';
import { emblemPaths, emblemSize } from '../brand/emblem.js';

const paths: Record<string, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  warning: (
    <>
      <path d="M12 3 2 21h20Z M12 9v5" />
      <path d="M12 17h.01" strokeWidth="2.5" />
    </>
  ),
  card: (
    <>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M8 6h8M8 10h8M8 14h5M8 18h8" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  dice: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01" strokeWidth="3" />
    </>
  ),
  undo: (
    <>
      <path d="M8 4 3 9l5 5M3 9h10a7 7 0 0 1 0 14" />
    </>
  ),
  menu: (
    <>
      <path d="M5 6h14M5 12h14M5 18h14" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M19 20v-2a6 6 0 0 0-2-4" />
    </>
  ),
  arrow: <path d="m9 5 7 7-7 7" />,
  phone: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="3" />
      <path d="M10 18h4" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  'commander-damage': (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
      <path d="m14 7-4 5h4l-4 5" />
    </>
  ),
  poison: (
    <>
      <path d="M12 3C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-12Z" />
      <path d="M9 15a3 3 0 0 0 3 3" />
    </>
  ),
  tax: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m12 6 2 4 4 2-4 2-2 4-2-4-4-2 4-2Z" />
    </>
  ),
  scheme: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <path d="M12 8.5c1 1.2 1.5 2.3 1.5 3.5S13 14.3 12 15.5c-1-1.2-1.5-2.3-1.5-3.5S11 9.7 12 8.5Z" />
    </>
  ),
  crown: (
    <>
      <path d="m3 6 4 5 5-7 5 7 4-5-2 13H5ZM5 22h14" />
    </>
  ),
  rotate: (
    <>
      <path d="M20 9a8 8 0 1 0 0 7M20 3v6h-6" />
    </>
  ),
  spark: <path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z" />,
  history: (
    <>
      <path d="M3 10a9 9 0 1 1 1 7M3 4v6h6M12 7v6l4 2" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6" />
    </>
  ),
  link: (
    <>
      <path
        d="m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"
        transform="translate(1 0) scale(.9)"
      />
    </>
  ),
  check: <path d="m5 12 4 4L20 5" />,
  settings: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="18" r="2" />
    </>
  ),
};
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.spark}
    </svg>
  );
}
export function Sigil({ className = '' }: { index?: number; className?: string }) {
  const monochrome = className.split(/\s+/).includes('tile-sigil');
  return (
    <svg
      className={className}
      viewBox={`0 0 ${emblemSize} ${emblemSize}`}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {emblemPaths.map((shape) => {
        if (monochrome && shape.monochrome === 'omit') return null;
        return (
          <path
            key={shape.id}
            d={shape.d}
            fill={monochrome ? (shape.monochrome === 'fill' ? 'currentColor' : 'none') : shape.fill}
            stroke={
              monochrome && (shape.stroke || shape.monochrome === 'stroke') ? 'currentColor' : shape.stroke
            }
            strokeWidth={shape.strokeWidth}
            fillRule={shape.fillRule}
            opacity={shape.opacity}
          />
        );
      })}
    </svg>
  );
}
export function Sheet({
  title,
  description,
  children,
  onClose,
  wide = false,
  compact = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  compact?: boolean;
}) {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content
          className={`sheet ${wide ? 'wide' : ''} ${compact ? 'compact' : ''}`}
          onInteractOutside={(event) => {
            // Dismissing a save error must not also dismiss the editor and its draft.
            const target = event.detail.originalEvent.target;
            if (target instanceof Element && target.closest('.error-toast')) event.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            const target = document.querySelector<HTMLButtonElement>('[data-sheet-return]');
            if (target) {
              e.preventDefault();
              target.focus();
            }
          }}
        >
          <div className="sheet-handle" />
          <header className="sheet-header">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description className={description ? 'muted' : 'sr-only'}>
                {description ?? `${title} controls`}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label={`Close ${title}`}>
              <Icon name="close" />
            </Dialog.Close>
          </header>
          <div className="sheet-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
type Choice = { value: string; label: string; primary?: boolean };
type Confirmation = {
  title: string;
  message: string;
  choices: Choice[];
  resolve: (choice?: string) => void;
};
const useConfirmation = create<{ value?: Confirmation }>(() => ({}));
export function choose(title: string, message: string, choices: Choice[]) {
  return new Promise<string | undefined>((resolve) =>
    useConfirmation.setState({ value: { title, message, choices, resolve } }),
  );
}
export async function ask(title: string, message: string) {
  return (
    (await choose(title, message, [{ value: 'confirm', label: 'Confirm', primary: true }])) === 'confirm'
  );
}
export function ConfirmationDialog() {
  const value = useConfirmation((s) => s.value);
  const cancel = useRef<HTMLButtonElement>(null);
  if (!value) return null;
  const done = (choice?: string) => {
    value.resolve(choice);
    useConfirmation.setState({ value: undefined });
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) done();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay confirmation" />
        <Dialog.Content
          className="confirm-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancel.current?.focus();
          }}
        >
          <Dialog.Title>{value.title}</Dialog.Title>
          <Dialog.Description>{value.message}</Dialog.Description>
          <div className={value.choices.length > 1 ? 'confirmation-choices' : 'button-row'}>
            {value.choices.length === 1 && (
              <button ref={cancel} className="secondary" onClick={() => done()}>
                Cancel
              </button>
            )}
            {value.choices.map((choice) => (
              <button
                key={choice.value}
                className={choice.primary ? 'primary' : 'secondary'}
                onClick={() => done(choice.value)}
              >
                {choice.label}
              </button>
            ))}
            {value.choices.length > 1 && (
              <button ref={cancel} className="text-button" onClick={() => done()}>
                Cancel
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Toggle({
  checked,
  onChange,
  children,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="toggle">
      <span>{children}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}
export function downloadText(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
