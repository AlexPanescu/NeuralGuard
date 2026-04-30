const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const User = require("../models/User");

const run = async () => {
  const emailArg = process.argv[2];
  const email = typeof emailArg === "string" ? emailArg.trim().toLowerCase() : "";

  if (!email || !email.includes("@")) {
    throw new Error("Provide email as first argument.");
  }
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing. Set ENV_FILE or .env with MONGO_URI.");
  }

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB || undefined,
  });

  const dbName = mongoose.connection?.db?.databaseName || "unknown";
  const user = await User.findOne({ email }).lean();

  console.log(`db ${dbName}`);
  if (!user) {
    console.log("user not found");
  } else {
    console.log({
      id: String(user._id),
      email: user.email,
      role: user.role,
      user_role: user.user_role,
    });
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
