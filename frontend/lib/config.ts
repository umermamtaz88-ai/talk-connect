const CLOUD_API = "https://talk-connect-b7e5b772.fastapicloud.dev";
const LOCAL_API = "http://127.0.0.1:8000";

/** Prefer env; on Vercel/production fall back to FastAPI Cloud (not localhost). */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "production" ? CLOUD_API : LOCAL_API);

export const WS_BASE =
  process.env.NEXT_PUBLIC_WS_URL ||
  API_BASE.replace(/^http/, "ws");
