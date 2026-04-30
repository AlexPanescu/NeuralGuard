const mongoose = require("mongoose");

const newsSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 220 },
    summary: { type: String, default: "", maxlength: 1200 },
    content: { type: String, default: "", maxlength: 20000 },
    source: { type: String, default: "", trim: true, maxlength: 120 },
    articleUrl: { type: String, default: "", trim: true, maxlength: 600 },
    imageUrl: { type: String, default: "", trim: true, maxlength: 1200 },
    tags: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["draft", "active", "archived"],
      default: "active",
    },
    severityScore: { type: Number, min: 0, max: 100, default: 45 },
    publishedAt: { type: Date, default: Date.now },
    region: { type: String, default: "", trim: true, maxlength: 120 },
    translations: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

newsSchema.index({ status: 1, publishedAt: -1 });
newsSchema.index({ severityScore: -1, publishedAt: -1 });

module.exports = mongoose.model("News", newsSchema);
