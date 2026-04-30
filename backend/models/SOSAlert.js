// models/SOSAlert.js
const mongoose = require("mongoose");

const sosAlertSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  incidentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Incident",
    default: null,
  },
  type: {
    type: String,
    enum: ["SOS", "TEST", "FAMILY"],
    required: true,
    default: "SOS",
  },
  message: {
    type: String,
    required: true,
    maxlength: 500,
  },
  location: {
    lat: { type: Number },
    lon: { type: Number },
    accuracy: { type: Number },
    address: { type: String },
  },
  status: {
    type: String,
    enum: ["active", "acknowledged", "responding", "resolved", "cancelled", "false_alarm", "expired"],
    default: "active",
  },
  priority: {
    type: String,
    enum: ["critical"],
    default: "critical",
  },
  initialLocation: {
    lat: { type: Number },
    lng: { type: Number },
    lon: { type: Number },
    accuracy: { type: Number },
    timestamp: { type: Date },
    source: { type: String },
  },
  lastKnownLocation: {
    lat: { type: Number },
    lng: { type: Number },
    lon: { type: Number },
    accuracy: { type: Number },
    timestamp: { type: Date },
    source: { type: String },
  },
  locationHistory: {
    type: [
      {
        lat: { type: Number },
        lng: { type: Number },
        lon: { type: Number },
        accuracy: { type: Number },
        timestamp: { type: Date },
        source: { type: String, default: "client" },
      },
    ],
    default: [],
  },
  contacts: {
    type: [
      {
        name: { type: String, default: "" },
        phone: { type: String, default: "" },
        email: { type: String, default: "" },
        relationship: { type: String, default: "" },
        notifyMethod: { type: String, default: "" },
        notifiedStatus: {
          type: String,
          enum: ["pending", "sent", "failed", "not_available"],
          default: "not_available",
        },
        notifiedAt: { type: Date, default: null },
        error: { type: String, default: "" },
      },
    ],
    default: [],
  },
  timeline: {
    type: [
      {
        type: { type: String, default: "update" },
        message: { type: String, default: "" },
        at: { type: Date, default: Date.now },
        actor: { type: mongoose.Schema.Types.Mixed, default: null },
      },
    ],
    default: [],
  },
  contactsNotified: {
    type: [String],
    default: [],
  },
  operationalInclusionSummary: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  resolvedAt: {
    type: Date,
  },
  acknowledgedBy: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  acknowledgedAt: {
    type: Date,
  },
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  cancelReason: {
    type: String,
    maxlength: 500,
  },
  resolutionNotes: {
    type: String,
    maxlength: 500,
  },
  expiresAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

// Index for efficient queries
sosAlertSchema.index({ userId: 1, createdAt: -1 });
sosAlertSchema.index({ status: 1, createdAt: -1 });

// Auto-expire only alerts that still have a live expiration marker.
sosAlertSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("SOSAlert", sosAlertSchema);
