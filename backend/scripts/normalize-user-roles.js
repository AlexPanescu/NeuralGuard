const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const User = require("../models/User");

const normalizeRoleValue = (value) => {
  if (typeof value !== "string") return "customer";
  const lower = value.trim().toLowerCase();
  return lower === "employee" || lower === "customer" ? lower : "customer";
};

const run = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing. Set ENV_FILE or .env with MONGO_URI.");
  }

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGO_DB || undefined,
  });

  const users = await User.find({}, { role: 1, user_role: 1 }).lean();
  let updated = 0;

  for (const user of users) {
    const nextRole = normalizeRoleValue(user.role);
    const nextUserRole = normalizeRoleValue(user.user_role);

    if (user.role !== nextRole || user.user_role !== nextUserRole) {
      await User.updateOne(
        { _id: user._id },
        { $set: { role: nextRole, user_role: nextUserRole } },
      );
      updated += 1;
    }
  }

  console.log(`updated ${updated} users`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
