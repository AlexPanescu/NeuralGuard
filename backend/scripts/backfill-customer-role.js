const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const User = require("../models/User");

const run = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing. Set ENV_FILE or .env with MONGO_URI.");
  }

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB || undefined,
  });

  const needsCustomerRole = {
    $and: [
      {
        $or: [
          { role: { $exists: false } },
          { role: null },
          { role: "" },
          { role: { $nin: ["customer", "employee"] } },
          { user_role: { $exists: false } },
          { user_role: null },
          { user_role: "" },
          { user_role: { $nin: ["customer", "employee"] } },
        ],
      },
      { role: { $ne: "employee" } },
      { user_role: { $ne: "employee" } },
    ],
  };

  const result = await User.updateMany(needsCustomerRole, {
    $set: { user_role: "customer", role: "customer" },
  });

  const matched = result.matchedCount ?? result.n ?? 0;
  const modified = result.modifiedCount ?? result.nModified ?? 0;
  console.log(`matched ${matched} modified ${modified}`);

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
