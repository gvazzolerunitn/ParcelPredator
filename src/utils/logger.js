import config from '../config/default.js';

const DEFAULT_HOT_INTERVAL = 3000; // ms

// Simple logger with hot-key rate-limiting and token masking
class ThrottledLogger {
  constructor(name) {
    this.name = name;
    this._last = new Map(); // key -> {ts, suppressed}
  }

  _now() { return Date.now(); }

  _format(args) {
    return `[${this.name}] ` + args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  }

  info(...args) { console.log(this._format(args)); }
  warn(...args) { console.warn(this._format(args)); }
  error(...args) { console.error(this._format(args)); }
  debug(...args) { 
    // Ora controlla SIA la variabile d'ambiente (terminale) SIA il file config
    if (process.env.DEBUG || config.DEBUG) {
      console.log(this._format(args)); 
    }
  }

  // Hot logging: logs at most once per `interval` per key, counting suppressed events
  hot(key, interval = DEFAULT_HOT_INTERVAL, ...args) {
    const now = this._now();
    const prev = this._last.get(key) || { ts: 0, suppressed: 0 };
    if (now - prev.ts >= interval) {
      // print message and suppressed count
      const suppressed = prev.suppressed || 0;
      if (suppressed > 0) {
        console.log(this._format([...(args), `(suppressed ${suppressed} events)`]));
      } else {
        console.log(this._format(args));
      }
      this._last.set(key, { ts: now, suppressed: 0 });
    } else {
      // increment suppressed counter
      this._last.set(key, { ts: prev.ts, suppressed: (prev.suppressed || 0) + 1 });
    }
  }

  // Mask token for safe prints
  static maskToken(token) {
    try {
      if (!token || typeof token !== 'string') return token;
      return token.slice(0, 8) + '...';
    } catch (e) { return token; }
  }
}

const defaultLogger = new ThrottledLogger('APP');
const commLogger = new ThrottledLogger('COMM');
const agentLogger = new ThrottledLogger('AGENT');

export { ThrottledLogger, defaultLogger, commLogger, agentLogger };
