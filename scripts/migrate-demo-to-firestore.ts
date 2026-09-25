import { createHash } from "node:crypto";
import { readFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/store";
import type { State } from "../src/lib/types";

// Read-only unless --apply is supplied. Existing Firestore app data is never replaced.
async function main() {
  const expectedProject = process.argv
    .find((value) => value.startsWith("--project="))
    ?.slice(10);
  if (!expectedProject || expectedProject !== process.env.FIREBASE_PROJECT_ID)
    throw new Error(
      "Supply --project=<FIREBASE_PROJECT_ID> to identify the destination explicitly.",
    );
  const source = path.resolve(process.env.DEMO_DATA_PATH || ".data/demo.json");
  const raw = await readFile(source, "utf8");
  const state = JSON.parse(raw) as State;
  const groups = ["items", "transactions", "budget", "users"] as const;
  for (const group of groups) {
    if (!Array.isArray(state[group]))
      throw new Error(`Missing source collection: ${group}`);
    const ids = new Set<string>();
    for (const document of state[group]) {
      if (
        !document.id ||
        !/^[A-Za-z0-9_-]+$/.test(document.id) ||
        ids.has(document.id)
      )
        throw new Error(`Invalid or duplicate document ID in ${group}`);
      ids.add(document.id);
    }
  }
  if (!state.settings || !Number.isFinite(state.settings.cooperativeBalance))
    throw new Error("Missing or invalid store settings");
  if (!state.users.some((user) => user.active && user.role === "admin"))
    throw new Error("An active administrator is required in the source data");
  for (const user of state.users)
    if (
      !user.passwordHash?.startsWith("scrypt$") ||
      !["admin", "cashier", "stock"].includes(user.role)
    )
      throw new Error("Invalid source staff account");
  const count = groups.reduce((sum, group) => sum + state[group].length, 0) + 2;
  if (count > 450)
    throw new Error("Source is too large for this single-transaction importer");
  const fingerprint = createHash("sha256").update(raw).digest("hex");
  const counts = Object.fromEntries(
    groups.map((group) => [group, state[group].length]),
  );
  const database = db();
  const applying = process.argv.includes("--apply");
  let backup: string | undefined;
  try {
    if (applying) {
      const directory = path.join(path.dirname(source), "backups");
      await mkdir(directory, { recursive: true });
      backup = path.join(directory, `demo-before-firestore-${Date.now()}.json`);
      await copyFile(source, backup, 1);
    }
    await database.runTransaction(async (transaction) => {
      const targetGroups = [
        ...groups,
        "settings",
        "sessions",
        "security",
        "_migrations",
      ];
      const existing = await Promise.all(
        targetGroups.map((group) =>
          transaction.get(database.collection(group).limit(1)),
        ),
      );
      if (existing.some((snapshot) => !snapshot.empty))
        throw new Error(
          "Destination already contains app data. Nothing was imported.",
        );
      if (!applying) return;
      const latest = await readFile(source, "utf8");
      if (createHash("sha256").update(latest).digest("hex") !== fingerprint)
        throw new Error(
          "Local data changed. Stop the demo server before importing.",
        );
      for (const group of groups)
        for (const document of state[group])
          transaction.create(
            database.collection(group).doc(document.id),
            document,
          );
      transaction.create(database.doc("settings/store"), state.settings);
      transaction.create(database.doc("_migrations/demo-import"), {
        source: "demo",
        sourceHash: fingerprint,
        importedAt: new Date().toISOString(),
        counts,
      });
    });
    // Read back every imported document and compare its full contents, without logging private data.
    if (applying) {
      const { isDeepStrictEqual } = await import("node:util");
      for (const group of groups) {
        const saved = await database.collection(group).get();
        if (
          saved.size !== state[group].length ||
          saved.docs.some(
            (document) =>
              !isDeepStrictEqual(
                document.data(),
                state[group].find((value) => value.id === document.id),
              ),
          )
        )
          throw new Error(`Import verification failed for ${group}`);
      }
      if (
        !isDeepStrictEqual(
          (await database.doc("settings/store").get()).data(),
          state.settings,
        )
      )
        throw new Error("Import verification failed for settings");
    }
    console.log(
      JSON.stringify({
        mode: applying ? "imported-and-verified" : "dry-run",
        project: expectedProject,
        counts,
        settings: 1,
        backup,
        sessionsImported: 0,
      }),
    );
  } finally {
    await database.terminate();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration failed");
  process.exitCode = 1;
});
