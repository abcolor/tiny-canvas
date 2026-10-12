// 專案未安裝 @types/ws；測試只需要最小的型別
declare module 'ws' {
  import { EventEmitter } from 'node:events';
  export default class WebSocket extends EventEmitter {
    constructor(address: string, options?: { headers?: Record<string, string> });
    constructor(address: string, protocols?: string | string[], options?: { headers?: Record<string, string> });
    close(code?: number, reason?: string): void;
  }
}
