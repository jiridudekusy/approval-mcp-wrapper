export type IconName =
  | 'account-key' | 'alert' | 'alert-circle' | 'arrow-history' | 'check'
  | 'check-circle' | 'chevron-down' | 'chevron-right' | 'chip' | 'clock'
  | 'close' | 'close-circle' | 'copy' | 'database' | 'delete' | 'eye'
  | 'filter' | 'fingerprint' | 'inbox' | 'infinity' | 'info' | 'key' | 'lock-closed'
  | 'log-out' | 'pending' | 'plus-circle' | 'refresh' | 'search' | 'settings'
  | 'shield-account' | 'shield-check' | 'sync';

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return <span aria-hidden="true" className="icon" style={{
    width: size,
    height: size,
    maskImage: `url(/assets/icons/${name}.svg)`,
    WebkitMaskImage: `url(/assets/icons/${name}.svg)`,
  }} />;
}
