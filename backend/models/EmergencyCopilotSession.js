const mongoose = require("mongoose");

const checklistItemSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    title: { type: String, required: true, trim: true, maxlength: 220 },
    detail: { type: String, default: "", maxlength: 1200 },
    status: {
      type: String,
      enum: ["todo", "done", "skipped"],
      default: "todo",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
  },
  { _id: false },
);

const sourceRefSchema = new mongoose.Schema(
  {
    type: { type: String, default: "" },
    id: { type: String, default: "" },
    label: { type: String, default: "" },
  },
  { _id: false },
);

const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["system", "assistant", "user"],
      required: true,
    },
    text: { type: String, required: true, trim: true, maxlength: 8000 },
    responseMode: {
      type: String,
      enum: ["rules_only", "retrieval_only", "hybrid_llm", "fallback"],
      default: "rules_only",
    },
    triageLevel: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    escalateNow: { type: Boolean, default: false },
    reasoningBasis: { type: [String], default: [] },
    safetyFlags: { type: [String], default: [] },
    sources: { type: [sourceRefSchema], default: [] },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const emergencyCopilotSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    incidentId: { type: mongoose.Schema.Types.ObjectId, ref: "Incident", default: null },
    sosAlertId: { type: mongoose.Schema.Types.ObjectId, ref: "SOSAlert", default: null },
    status: {
      type: String,
      enum: ["active", "escalated", "resolved", "ended"],
      default: "active",
    },
    language: { type: String, default: "ro", maxlength: 8 },
    responseMode: {
      type: String,
      enum: ["rules_only", "retrieval_only", "hybrid_llm", "fallback"],
      default: "rules_only",
    },
    latestTriageLevel: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    activeChecklist: { type: [checklistItemSchema], default: [] },
    guideIdsUsed: { type: [String], default: [] },
    signalIdsUsed: { type: [String], default: [] },
    incidentSnapshot: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    operationalInclusionSummary: { type: mongoose.Schema.Types.Mixed, default: null },
    riskSnapshotId: { type: mongoose.Schema.Types.ObjectId, ref: "RiskSnapshot", default: null },
    modelVersion: { type: String, default: "deterministic-v1" },
    safetyFlags: { type: [String], default: [] },
    lastRecommendationAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true },
);

emergencyCopilotSessionSchema.index({ userId: 1, createdAt: -1 });
emergencyCopilotSessionSchema.index({ incidentId: 1, createdAt: -1 });
emergencyCopilotSessionSchema.index({ sosAlertId: 1, createdAt: -1 });
emergencyCopilotSessionSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.model("EmergencyCopilotSession", emergencyCopilotSessionSchema);
