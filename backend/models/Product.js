const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: String,
    title: String,
    itemCode: {
      type: Number,
      unique: true,
      sparse: true,
      min: 10000,
      max: 99999,
    },
    price: Number,
    category: String,
    brand: String,
    description: String,
    imageUrl: String,
    images: [String],
    stock: Number,
    size: String,
  },
  {
    timestamps: true,
    strict: false,
    collection: "magazin-sportiv",
  },
);

module.exports = mongoose.model("Product", productSchema);
