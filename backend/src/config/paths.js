const path = require("path");

const BACKEND_ROOT = path.resolve(__dirname, "..", "..");
const DATA_ROOT = path.join(BACKEND_ROOT, "data");

const paths = {
  BACKEND_ROOT,
  DATA_ROOT,
  CHAT_FILE: path.join(DATA_ROOT, "chat", "chat-messages.json"),
  GUIDE_ROOT: path.join(DATA_ROOT, "guides"),
  GUIDE_INDEX: path.join(DATA_ROOT, "guides", "index.json"),
  USERS_FILE: path.join(DATA_ROOT, "users", "users.json"),
};

module.exports = paths;
