// models/User.js
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const cartItemSchema = new mongoose.Schema(
  {
    itemCode: {
      type: Number,
      required: true,
      min: 10000,
      max: 99999,
    },
    qty: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
  },
  {
    _id: false,
  },
);

const inclusionProfileSchema = new mongoose.Schema(
  {
    consentForEmergencyUse: { type: Boolean, default: false },
    mobilityNeeds: { type: [String], default: [] },
    sensoryNeeds: { type: [String], default: [] },
    communicationNeeds: { type: [String], default: [] },
    medicalFlags: { type: [String], default: [] },
    supportContacts: {
      type: [
        {
          name: { type: String, default: "", maxlength: 80 },
          relationship: { type: String, default: "other", maxlength: 32 },
          phone: { type: String, default: "", maxlength: 32 },
        },
      ],
      default: [],
    },
    shortNotes: { type: String, default: "", maxlength: 160 },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  presenceStatus: {
    type: String,
    enum: ["active", "idle", "dnd", "offline", "available", "en_route", "on_scene", "unavailable"],
    default: "available",
  },
  notificationsEnabled: {
    type: Boolean,
    default: true,
  },
  theme: {
    type: String,
    enum: ["light", "dark"],
    default: "light",
  },
  role: {
    type: String,
    enum: ["customer", "employee"],
    default: "customer",
  },
  user_role: {
    type: String,
    enum: ["customer", "employee"],
    default: "customer",
  },
  // Poza de profil stocata ca binary (Buffer)
  profilePicture: {
    data: { type: Buffer, default: null },
    contentType: { type: String, default: null },
  },
  cart: {
    type: [cartItemSchema],
    default: [],
  },
  wishlist: {
    type: [Number],
    default: [],
  },
  location: {
    name: { type: String, default: "" },
    raw: { type: String, default: "" },
    coordinates: {
      lat: { type: Number },
      lon: { type: Number },
    },
  },
  inclusionProfile: {
    type: inclusionProfileSchema,
    default: undefined,
  },
});

const normalizeRoleValue = (value) => {
  if (typeof value !== "string") return value;
  const lower = value.trim().toLowerCase();
  return lower === "employee" || lower === "customer" ? lower : "customer";
};

userSchema.pre("validate", function () {
  if (this.role != null) {
    this.role = normalizeRoleValue(this.role);
  }
  if (this.user_role != null) {
    this.user_role = normalizeRoleValue(this.user_role);
  }
});

// Pre-save hook pentru hash parola
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  } catch (err) {
    throw err;
  }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model("User", userSchema);
