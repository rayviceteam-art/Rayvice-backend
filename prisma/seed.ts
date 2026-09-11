/**
 * Manual seed entrypoint: `npx prisma db seed` (or `npm run db:seed`).
 * Reuses the same idempotent catalogue upsert that runs at server startup.
 */
import { ensureSupportCatalogueSeeded } from "../src/config/seedCatalogue";

ensureSupportCatalogueSeeded()
  .then(() => {
    console.log("NDIS support catalogue seeded successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Failed to seed NDIS support catalogue:", err);
    process.exit(1);
  });
