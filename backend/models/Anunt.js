const mongoose = require("mongoose");

const anuntSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  type: {
    type: String,
    enum: ["alerta", "info", "voluntari", "resurse"],
    default: "info",
  },
  priority: { type: Number, min: 1, max: 5, default: 3 },
  message: { type: String, required: true, trim: true },
  location: { type: String, default: "" },
  coordinates: {
    lat: { type: Number },
    lon: { type: Number },
  },
  status: { type: String, enum: ["active", "expired", "resolved"], default: "active" },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date },
  source: { type: String, default: "" },
});

module.exports = mongoose.model("Anunt", anuntSchema, "anunturi");
