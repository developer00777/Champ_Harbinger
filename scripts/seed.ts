import { seedSignals } from "../db/seeds/signals";

seedSignals()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
