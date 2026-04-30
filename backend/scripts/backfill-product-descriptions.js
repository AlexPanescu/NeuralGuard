const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const Product = require("../models/Product");

const args = new Set(process.argv.slice(2));
const shouldCommit = args.has("--commit");
const forceOverwrite = args.has("--force");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : null;

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const formatPrice = (value) => {
  const numeric = toNumber(value);
  return numeric == null ? null : `${numeric} RON`;
};

const normalizeText = (value) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const buildTemplateByCategory = (category = "") => {
  const cat = category.toLowerCase();
  if (cat.includes("alerg") || cat.includes("running")) {
    return "Running shoes for daily training and comfort.";
  }
  if (cat.includes("fitness") || cat.includes("gym")) {
    return "Fitness gear designed for gym workouts and mobility.";
  }
  if (cat.includes("outdoor") || cat.includes("trek") || cat.includes("hike")) {
    return "Outdoor product built for durability and long walks.";
  }
  if (cat.includes("jacket") || cat.includes("geaca") || cat.includes("jacheta")) {
    return "Jacket made for layered protection and comfort.";
  }
  if (cat.includes("tricou") || cat.includes("t-shirt") || cat.includes("tee")) {
    return "Breathable top for everyday wear and training.";
  }
  return "Sport product made for comfort and everyday use.";
};

const buildDescription = (product) => {
  const name = normalizeText(product?.name || product?.title || "Product");
  const brand = normalizeText(product?.brand);
  const category = normalizeText(product?.category);
  const size = normalizeText(product?.size);
  const price = formatPrice(product?.price);

  const base = buildTemplateByCategory(category);
  const parts = [
    name,
    brand && `Brand: ${brand}.`,
    category && `Category: ${category}.`,
    price && `Price: ${price}.`,
    size && `Size: ${size}.`,
    base,
    "Ask if it fits your activity and we can recommend alternatives.",
  ].filter(Boolean);

  return parts.join(" ");
};

const shouldUpdate = (product) => {
  if (forceOverwrite) return true;
  const description = normalizeText(product?.description);
  return description.length < 40;
};

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.MONGO_DB || undefined,
    });

    const query = {};
    const cursor = Product.find(query).limit(limit || 0);
    const products = await cursor.lean();

    let updated = 0;
    for (const product of products) {
      if (!shouldUpdate(product)) {
        continue;
      }

      const newDescription = buildDescription(product);
      updated += 1;

      if (shouldCommit) {
        await Product.updateOne({ _id: product._id }, { $set: { description: newDescription } });
      }
    }

    console.log(
      `Descriptions prepared: ${updated}. ` +
        (shouldCommit ? "Changes saved." : "Dry run only. Use --commit to save."),
    );
  } catch (error) {
    console.error("Eroare la completarea descrierilor:", error.message || error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
