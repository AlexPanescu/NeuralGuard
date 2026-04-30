const mongoose = require("mongoose");

const geoSchema = new mongoose.Schema(
  {
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },
    radiusKm: { type: Number, min: 0, default: 0 },
    locationHash: { type: String, default: "" },
  },
  { _id: false },
);

const freshnessSchema = new mongoose.Schema(
  {
    observedAt: { type: Date, default: Date.now },
    freshUntil: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const signalCacheSchema = new mongoose.Schema(
  {
    dedupeKey: { type: String, required: true, trim: true, maxlength: 220 },
    category: { type: String, required: true, trim: true, maxlength: 120 },
    label: { type: String, required: true, trim: true, maxlength: 220 },
    detail: { type: String, default: "", maxlength: 1200 },
    score: { type: Number, min: 0, max: 100, default: 0 },
    severity: { type: String, default: "guarded" },
    status: {
      type: String,
      enum: ["active", "stale", "resolved"],
      default: "active",
    },
    confidence: { type: Number, min: 0, max: 100, default: 50 },
    source: { type: String, required: true, trim: true, maxlength: 120 },
    sourcePriority: { type: Number, default: 30 },
    isProxy: { type: Boolean, default: false },
    overrideOf: { type: String, default: "" },
    geo: { type: geoSchema, default: () => ({}) },
    freshness: { type: freshnessSchema, default: () => ({}) },
    payload: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true },
);

signalCacheSchema.index({ dedupeKey: 1 }, { unique: true });
signalCacheSchema.index({ category: 1, status: 1, updatedAt: -1 });
signalCacheSchema.index({ "geo.locationHash": 1, status: 1, updatedAt: -1 });
signalCacheSchema.index({ source: 1, status: 1, updatedAt: -1 });

module.exports = mongoose.model("SignalCache", signalCacheSchema);
