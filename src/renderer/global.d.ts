import type { MasadirApi } from '../shared/contracts';

declare global {
  interface Window {
    readonly masadir: MasadirApi;
  }
}

export {};
