// src/types/env.d.ts
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      REALTIME_JWT_SECRET: string;
      INTERNAL_SHARED_SECRET: string;
      ALLOWED_ORIGIN: string;
      PORT?: string;
    }
  }
}

export {};
