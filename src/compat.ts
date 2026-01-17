type Disposer = () => void;

export function installDateContainsPolyfill(): void {
  if (typeof (Date.prototype as any).contains === 'function') return;

  (Date.prototype as any).contains = function (target: string) {
    const str = String(this);
    if (typeof (str as any).contains === 'function') {
      return (str as any).contains(target);
    }
    return str.toLowerCase().includes(String(target).toLowerCase());
  };
}

export function installConsoleErrorFilter(): Disposer {
  const originalError = console.error;

  console.error = function (...args: any[]) {
    const msg = args.length > 0 ? args[0] : '';
    const msgStr =
      typeof msg === 'string'
        ? msg
        : msg && (msg as any).message
          ? String((msg as any).message)
          : String(msg);

    if (msgStr.includes('Cannot find function') && msgStr.includes('on type Date')) {
      return;
    }
    if (msgStr.includes('Failed to evaluate a filter') && msgStr.includes('Date')) {
      return;
    }

    originalError.apply(console, args);
  };

  return () => {
    console.error = originalError;
  };
}

