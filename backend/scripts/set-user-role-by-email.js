const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const User = require("../models/User");

const run = async () => {
  const emailArg = process.argv[2];
  const roleArg = process.argv[3];
  const email = typeof emailArg === "string" ? emailArg.trim().toLowerCase() : "";
  const role =
    typeof roleArg === "string" && roleArg.trim()
      ? roleArg.trim().toLowerCase()
      : "employee";

  if (!email || !email.includes("@")) {
    throw new Error("Provide email as first argument.");
  }
  if (role !== "employee" && role !== "customer") {
    throw new Error("Role must be 'employee' or 'customer'.");
  }
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing. Set ENV_FILE or .env with MONGO_URI.");
  }

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB || undefined,
  });

  const result = await User.updateOne(
    { email },
    { $set: { user_role: role, role } },
  );

  const matched = result.matchedCount ?? result.n ?? 0;
  const modified = result.modifiedCount ?? result.nModified ?? 0;
  console.log(`matched ${matched} modified ${modified}`);

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
