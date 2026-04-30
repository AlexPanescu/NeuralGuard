const mongoose = require("mongoose");

const incidentActorSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    name: { type: String, default: "" },
    role: { type: String, default: "customer" },
    status: { type: String, default: "" },
  },
  { _id: false },
);

const incidentLocationSchema = new mongoose.Schema(
  {
    lat: { type: Number, default: null },
    lon: { type: Number, default: null },
    address: { type: String, default: "" },
    accuracy: { type: Number, default: null },
    radiusKm: { type: Number, default: 0, min: 0, max: 500 },
  },
  { _id: false },
);

const incidentTimelineSchema = new mongoose.Schema(
  {
    kind: { type: String, default: "update" },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    actorName: { type: String, default: "" },
    actorRole: { type: String, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const incidentResourceSchema = new mongoose.Schema(
  {
    kind: { type: String, default: "resource" },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    status: { type: String, default: "available" },
    capacity: { type: Number, default: null },
    contact: { type: String, default: "" },
    lastUpdatedAt: { type: Date, default: Date.now },
    coords: {
      lat: { type: Number, default: null },
      lon: { type: Number, default: null },
    },
    notes: { type: String, default: "" },
  },
  { _id: true },
);

const incidentTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    owner: { type: String, default: "" },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    status: {
      type: String,
      enum: ["todo", "in_progress", "blocked", "done"],
      default: "todo",
    },
    dueAt: { type: Date, default: null },
    completionNotes: { type: String, default: "" },
    templateKey: { type: String, default: "" },
    guideRefs: {
      type: [
        {
          category: String,
          situation: String,
          subcategoryTitle: String,
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

const incidentGuideSchema = new mongoose.Schema(
  {
    category: { type: String, required: true },
    situation: { type: String, required: true },
    subcategoryTitle: { type: String, required: true },
    title: { type: String, default: "" },
    pdf: { type: String, default: "" },
    tags: { type: [String], default: [] },
    audience: { type: [String], default: [] },
    incidentTypes: { type: [String], default: [] },
    offlineEligible: { type: Boolean, default: false },
    attachedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const incidentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 140 },
    type: { type: String, default: "general", trim: true },
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    status: {
      type: String,
      enum: ["open", "monitoring", "active", "contained", "resolved"],
      default: "open",
    },
    summary: { type: String, default: "", maxlength: 500 },
    location: { type: incidentLocationSchema, default: () => ({}) },
    dangerScore: { type: Number, min: 0, max: 100, default: 50 },
    riskUpdatedAt: { type: Date, default: Date.now },
    rawTitle: { type: String, default: "" },
    rawSummary: { type: String, default: "" },
    normalizedText: { type: String, default: "" },
    ingestionMeta: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    sourceFingerprint: { type: String, default: "" },
    duplicateOf: { type: String, default: null },
    relevanceScore: { type: Number, min: 0, max: 100, default: 0 },
    geoConfidence: { type: Number, min: 0, max: 100, default: 0 },
    classificationVersion: { type: String, default: "" },
    sourceAliases: { type: [String], default: [] },
    sourceUrls: { type: [String], default: [] },
    createdBy: { type: incidentActorSchema, default: () => ({}) },
    assignedUsers: { type: [incidentActorSchema], default: [] },
    timeline: { type: [incidentTimelineSchema], default: [] },
    resources: { type: [incidentResourceSchema], default: [] },
    tasks: { type: [incidentTaskSchema], default: [] },
    guides: { type: [incidentGuideSchema], default: [] },
    operationalInclusionSummary: { type: mongoose.Schema.Types.Mixed, default: null },
    source: { type: String, default: "manual" },
    unreadCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

incidentSchema.index({ status: 1, updatedAt: -1 });
incidentSchema.index({ severity: 1, updatedAt: -1 });
incidentSchema.index({ "createdBy.userId": 1, updatedAt: -1 });

module.exports = mongoose.model("Incident", incidentSchema);
