const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 220 },
    message: { type: String, required: true, trim: true, maxlength: 1200 },
    type: {
      type: String,
      trim: true,
      enum: [
        "info",
        "success",
        "warning",
        "critical",
        "incident_created",
        "incident_updated",
        "incident_deleted",
        "assignment",
        "guide",
        "sos",
        "news",
        "system",
      ],
      default: "info",
    },
    link: { type: String, default: "", trim: true, maxlength: 600 },
    source: { type: String, default: "manual", trim: true, maxlength: 120 },
    audience: {
      type: String,
      trim: true,
      enum: ["all", "signed_in", "admin"],
      default: "all",
    },
    status: {
      type: String,
      trim: true,
      enum: ["active", "archived"],
      default: "active",
    },
    isPinned: { type: Boolean, default: false },
    priority: {
      type: String,
      trim: true,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },
    relatedAlertId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SOSAlert",
      default: null,
    },
    relatedIncidentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Incident",
      default: null,
    },
    requiresAction: { type: Boolean, default: false },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

notificationSchema.index({ status: 1, isPinned: -1, createdAt: -1 });
notificationSchema.index({ audience: 1, status: 1, createdAt: -1 });
notificationSchema.index({ type: 1, relatedAlertId: 1, status: 1 });

module.exports = mongoose.model("Notification", notificationSchema);
