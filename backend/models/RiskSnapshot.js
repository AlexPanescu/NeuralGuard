const mongoose = require("mongoose");

const contributorSchema = new mongoose.Schema(
  {
    key: { type: String, default: "" },
    label: { type: String, default: "" },
    score: { type: Number, min: 0, max: 100, default: 0 },
    delta: { type: Number, default: 0 },
    sourceType: { type: String, default: "" },
    sourceId: { type: String, default: "" },
    title: { type: String, default: "" },
    weight: { type: Number, default: 0 },
  },
  { _id: false },
);

const sourceHealthSchema = new mongoose.Schema(
  {
    source: { type: String, required: true, trim: true, maxlength: 120 },
    healthy: { type: Boolean, default: true },
    freshnessMinutes: { type: Number, default: 0 },
    confidence: { type: Number, min: 0, max: 100, default: 50 },
    status: {
      type: String,
      enum: ["live", "fallback", "stale", "degraded"],
      default: "live",
    },
  },
  { _id: false },
);

const locationContextSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    locationHash: { type: String, default: "" },
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },
    radiusKm: { type: Number, default: 1 },
  },
  { _id: false },
);

const riskSnapshotSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    snapshotScope: {
      type: String,
      enum: ["user", "zone"],
      default: "user",
      index: true,
    },
    locationHash: { type: String, default: "", index: true },
    score: { type: Number, min: 0, max: 100, required: true },
    previousScore: { type: Number, min: 0, max: 100, default: 0 },
    delta: { type: Number, default: 0 },
    previousSnapshotId: { type: mongoose.Schema.Types.ObjectId, ref: "RiskSnapshot", default: null },
    scoreConfidence: { type: Number, min: 0, max: 100, default: 50 },
    evaluationVersion: { type: String, default: "v1.0.0" },
    driverScores: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    topContributors: { type: [contributorSchema], default: [] },
    changedBecause: { type: [String], default: [] },
    sourceHealth: { type: [sourceHealthSchema], default: [] },
    locationContext: { type: locationContextSchema, default: () => ({}) },
  },
  { timestamps: true },
);

riskSnapshotSchema.index({ userId: 1, snapshotScope: 1, createdAt: -1 });
riskSnapshotSchema.index({ locationHash: 1, snapshotScope: 1, createdAt: -1 });

module.exports = mongoose.model("RiskSnapshot", riskSnapshotSchema);
