import { db } from "../src/lib/store";
import { initialState } from "../src/lib/seed";
// Node's --env-file loads .env.local before this script; no browser credentials.
async function main() {
  if (process.env.DATA_BACKEND !== "firestore")
    throw new Error("Set DATA_BACKEND=firestore before seeding.");
  const database = db();
  await database.runTransaction(async (transaction) => {
    const existing = await transaction.get(
      database.collection("items").limit(1),
    );
    const settings = await transaction.get(database.doc("settings/store"));
    if (!existing.empty || settings.exists)
      throw new Error(
        "Refusing to overwrite an initialized store. Add or edit products in the admin panel instead.",
      );
    const state = initialState();
    for (const item of state.items)
      transaction.create(database.collection("items").doc(item.id), item);
    transaction.create(database.doc("settings/store"), state.settings);
  });
  console.log(
    "Initialized sample products and empty accounts. Replace sample stock and barcodes before opening the store.",
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
