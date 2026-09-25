import { serverEnv } from "@/lib/server-config";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { initialState } from "./seed";
import type { State } from "./types";
export const isDemo = () => serverEnv("DATA_BACKEND") === "demo";
export function db() {
  if (!getApps().length)
    initializeApp({
      credential: cert({
        projectId: serverEnv("FIREBASE_PROJECT_ID"),
        clientEmail: serverEnv("FIREBASE_CLIENT_EMAIL"),
        privateKey: serverEnv("FIREBASE_PRIVATE_KEY")?.replace(/\\n/g, "\n"),
      }),
    });
  return getFirestore();
}
const dataPath = () =>
  serverEnv("DEMO_DATA_PATH") || path.join(process.cwd(), ".data", "demo.json");
const globalStore = globalThis as typeof globalThis & {
  dskruQueue?: Promise<unknown>;
};
async function readDemo(): Promise<State> {
  try {
    const state = JSON.parse(
      await readFile(/* turbopackIgnore: true */ dataPath(), "utf8"),
    );
    return {
      ...state,
      users: state.users || [],
      sessions: state.sessions || [],
      attempts: state.attempts || {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return initialState();
  }
}
const collections = [
  "items",
  "transactions",
  "budget",
  "users",
  "sessions",
] as const;
export async function readState(): Promise<State> {
  if (isDemo()) return readDemo();
  if (serverEnv("DATA_BACKEND") !== "firestore")
    throw new Error(
      "Choose DATA_BACKEND=demo or firestore in your environment.",
    );
  const database = db();
  const [items, transactions, budget, settings, users, sessions] =
    await Promise.all([
      database.collection("items").get(),
      database.collection("transactions").get(),
      database.collection("budget").get(),
      database.doc("settings/store").get(),
      database.collection("users").get(),
      database.collection("sessions").get(),
    ]);
  return {
    items: items.docs.map((d) => d.data()) as State["items"],
    transactions: transactions.docs
      .map((d) => d.data())
      .sort((a, b) =>
        b.timestamp.localeCompare(a.timestamp),
      ) as State["transactions"],
    budget: budget.docs.map((d) => d.data()) as State["budget"],
    settings: settings.exists
      ? (settings.data() as State["settings"])
      : initialState().settings,
    attempts: {},
    users: users.docs.map((d) => d.data()) as State["users"],
    sessions: sessions.docs.map((d) => d.data()) as State["sessions"],
  };
}
export async function mutate<T>(operation: (state: State) => T): Promise<T> {
  if (isDemo()) {
    const job = (globalStore.dskruQueue || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const state = await readDemo();
        const result = operation(state);
        await mkdir(path.dirname(dataPath()), { recursive: true });
        const temp = `${dataPath()}.tmp`;
        await writeFile(temp, JSON.stringify(state, null, 2), "utf8");
        // Windows sync clients / scanners can briefly hold the destination open.
        // Retry replacement without deleting the last successfully saved file.
        for (let attempt = 0; ; attempt++) {
          try {
            await rename(temp, dataPath());
            break;
          } catch (error) {
            if (
              attempt >= 5 ||
              !["EPERM", "EBUSY", "EACCES"].includes(
                (error as NodeJS.ErrnoException).code || "",
              )
            )
              throw error;
            await delay(50 * 2 ** attempt);
          }
        }
        return result;
      });
    globalStore.dskruQueue = job;
    return job;
  }
  if (serverEnv("DATA_BACKEND") !== "firestore")
    throw new Error("Database is not configured.");
  const database = db();
  return database.runTransaction(async (tx) => {
    const snapshots = await Promise.all(
      collections.map((c) => tx.get(database.collection(c))),
    );
    const setting = await tx.get(database.doc("settings/store"));
    const state = {
      settings: setting.exists ? setting.data() : initialState().settings,
      attempts: {},
    } as State;
    collections.forEach((c, i) => {
      (state[c] as unknown[]) = snapshots[i].docs.map((d) => d.data());
    });
    const before = structuredClone(state);
    const result = operation(state);
    for (const collection of collections) {
      for (const item of state[collection])
        if (
          JSON.stringify(item) !==
          JSON.stringify(before[collection].find((i) => i.id === item.id))
        )
          tx.set(database.collection(collection).doc(item.id), item);
      for (const item of before[collection])
        if (!state[collection].some((i) => i.id === item.id))
          tx.delete(database.collection(collection).doc(item.id));
    }
    if (
      !setting.exists ||
      JSON.stringify(state.settings) !== JSON.stringify(before.settings)
    )
      tx.set(database.doc("settings/store"), state.settings);
    return result;
  });
}
