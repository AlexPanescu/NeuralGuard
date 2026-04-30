const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: process.env.ENV_FILE || ".env" });

const Product = require("../models/Product");

const MIN_ITEM_CODE = 10000;
const MAX_ITEM_CODE = 99999;

const normalizeItemCode = (value) => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric)) {
    return null;
  }
  return numeric >= MIN_ITEM_CODE && numeric <= MAX_ITEM_CODE ? numeric : null;
};

const generateNextItemCode = (usedCodes) => {
  for (let code = MIN_ITEM_CODE; code <= MAX_ITEM_CODE; code += 1) {
    if (!usedCodes.has(code)) {
      usedCodes.add(code);
      return code;
    }
  }

  throw new Error("Nu mai exista coduri de 5 cifre disponibile pentru produse");
};

const assignItemCodes = async () => {
  const products = await Product.find().select("_id itemCode");
  const usedCodes = new Set();
  const productsToUpdate = [];

  for (const product of products) {
    const normalizedCode = normalizeItemCode(product.itemCode);
    if (normalizedCode == null || usedCodes.has(normalizedCode)) {
      productsToUpdate.push(product);
      continue;
    }

    if (normalizedCode !== product.itemCode) {
      product.itemCode = normalizedCode;
      productsToUpdate.push(product);
      continue;
    }

    usedCodes.add(normalizedCode);
  }

  for (const product of productsToUpdate) {
    product.itemCode = generateNextItemCode(usedCodes);
    await product.save();
  }

  return {
    total: products.length,
    updated: productsToUpdate.length,
  };
};

const run = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      dbName: process.env.MONGO_DB || undefined,
    });

    const result = await assignItemCodes();
    console.log(
      `Coduri asignate. Total produse: ${result.total}. Actualizate: ${result.updated}.`,
    );
  } catch (error) {
    console.error("Eroare la asignarea codurilor:", error.message || error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
};

run();
