const http = require("http");
const https = require("https");
const Product = require("../models/Product");

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:14b";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 30000;
const AI_MAX_PRODUCTS = 6;
const AI_MAX_DESC_CHARS = 1200;

const stripDiacritics = (value) =>
  typeof value === "string"
    ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    : "";

const normalizeText = (value) => stripDiacritics(value).toLowerCase();

const applyRomanianDiacritics = (text) => {
  if (!text || typeof text !== "string") return text;
  const replacements = new Map([
    [" si ", " și "],
    [" si,", " și,"],
    [" si.", " și."],
    [" si?", " și?"],
    [" si!", " și!"],
    [" in ", " în "],
    [" in,", " în,"],
    [" in.", " în."],
    [" in?", " în?"],
    [" in!", " în!"],
    [" din ", " din "],
    [" la ", " la "],
    [" cu ", " cu "],
    [" sa ", " să "],
    [" sa,", " să,"],
    [" sa.", " să."],
    [" sa?", " să?"],
    [" sa!", " să!"],
    [" sunt ", " sunt "],
    [" ce ", " ce "],
    [" care ", " care "],
    [" pentru ", " pentru "],
    [" produs ", " produs "],
    [" produse ", " produse "],
    [" recomandari", " recomandări"],
    [" intrebari", " întrebări"],
    [" raspuns", " răspuns"],
    [" raspunde", " răspunde"],
    [" raspunde", " răspunde"],
    [" potrivit", " potrivit"],
    [" potrivite", " potrivite"],
    [" informatii", " informații"],
    [" descrieri", " descrieri"],
    [" descriere", " descriere"],
    [" cauti", " cauți"],
    [" putem", " putem"],
    [" produsul", " produsul"],
    [" produselor", " produselor"],
    [" marimi", " mărimi"],
    [" marime", " mărime"],
    [" pret", " preț"],
    [" preturi", " prețuri"],
    [" pretul", " prețul"],
    [" seturi", " seturi"],
    [" cate", " câte"],
    [" categorie", " categorie"],
    [" categoria", " categoria"],
    [" recomandare", " recomandare"],
    [" recomandari", " recomandări"],
    [" recomand", " recomand"],
    [" preferi", " preferi"],
    [" anume", " anume"],
    [" lipseste", " lipsește"],
    [" lipsesc", " lipsesc"],
    [" foloseste", " folosește"],
    [" detalii", " detalii"],
    [" detaliu", " detaliu"],
    [" stoc", " stoc"],
  ]);

  let output = ` ${text} `;
  for (const [from, to] of replacements.entries()) {
    const pattern = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    output = output.replace(pattern, (match) => {
      const isUpper = match === match.toUpperCase();
      if (isUpper) return to.toUpperCase();
      const isCapitalized =
        match.trim().charAt(0).toUpperCase() + match.trim().slice(1) === match.trim();
      if (isCapitalized) {
        return ` ${to.trim().charAt(0).toUpperCase()}${to.trim().slice(1)} `;
      }
      return to;
    });
  }
  return output.trim();
};

const tokenize = (text) => {
  const cleaned = normalizeText(text).replace(/[^a-z0-9\s]/g, " ");
  const rawTokens = cleaned.split(/\s+/).filter(Boolean);
  const stopwords = new Set([
    "si",
    "sau",
    "in",
    "pe",
    "la",
    "cu",
    "de",
    "din",
    "un",
    "o",
    "este",
    "pentru",
    "care",
    "ce",
    "cat",
    "cum",
    "the",
    "and",
    "or",
    "for",
    "with",
    "about",
    "from",
    "is",
    "are",
    "a",
    "an",
    "to",
    "in",
    "on",
    "of",
  ]);

  return rawTokens.filter((token) => token.length >= 3 && !stopwords.has(token));
};

const CATEGORY_KEYWORDS = [
  { key: "basketball", aliases: ["basket", "basketball", "baschet", "baschetbal"] },
  { key: "football", aliases: ["football", "fotbal", "soccer"] },
  { key: "running", aliases: ["running", "alerg", "jog", "runner"] },
  { key: "fitness", aliases: ["fitness", "gym", "sala"] },
  { key: "outdoor", aliases: ["outdoor", "trek", "hike", "drumet"] },
];

const detectCategoryKey = (text) => {
  const normalized = normalizeText(text);
  const found = CATEGORY_KEYWORDS.find((entry) =>
    entry.aliases.some((alias) => normalized.includes(alias)),
  );
  return found?.key || null;
};

const detectLanguagePreference = (text) => {
  const normalized = normalizeText(text);
  if (normalized.includes("english") || normalized.includes("engleza")) {
    return "en";
  }
  if (
    normalized.includes("romana") ||
    normalized.includes("romanian") ||
    normalized.includes("romaneste") ||
    normalized.includes("română") ||
    normalized.includes("românește")
  ) {
    return "ro";
  }
  return null;
};

const resolveLanguagePreference = (message, history = []) => {
  const direct = detectLanguagePreference(message);
  if (direct) return direct;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry?.role !== "user" || typeof entry?.content !== "string") {
      continue;
    }
    const detected = detectLanguagePreference(entry.content);
    if (detected) return detected;
  }
  return "ro";
};

const isGreeting = (text) => {
  const normalized = normalizeText(text);
  return ["salut", "buna", "hello", "hi", "hey", "hei", "ceau"].some((word) =>
    normalized.includes(word),
  );
};

const isThanks = (text) => {
  const normalized = normalizeText(text);
  return ["mersi", "multumesc", "thanks", "thx", "appreciate"].some((word) =>
    normalized.includes(word),
  );
};

const isLanguageRequest = (text) => {
  const normalized = normalizeText(text);
  return (
    normalized.includes("talk in english") ||
    normalized.includes("speak english") ||
    normalized.includes("vorbesti engleza") ||
    normalized.includes("in engleza") ||
    normalized.includes("in english")
  );
};

const forceRomanianReply = (language) => language !== "en";

const isShortFollowUp = (text) => {
  const normalized = normalizeText(text);
  return (
    normalized.length <= 22 &&
    ["care", "de", "si", "others", "altceva"].some((word) => normalized.includes(word))
  );
};

const findCategoryFromHistory = (history = []) => {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry?.role !== "user" || typeof entry?.content !== "string") {
      continue;
    }
    const candidate = detectCategoryKey(entry.content);
    if (candidate) return candidate;
  }
  return null;
};

const isListQuestion = (text) => {
  const normalized = normalizeText(text);
  return (
    normalized.includes("ce produse") ||
    normalized.includes("care produse") ||
    normalized.includes("ce ai") ||
    normalized.includes("lista") ||
    normalized.includes("ce este pe site") ||
    normalized.includes("ce sunt pe site")
  );
};

const filterProductsByCategory = (products, categoryKey) => {
  if (!categoryKey) return [];
  const aliases = CATEGORY_KEYWORDS.find((entry) => entry.key === categoryKey)?.aliases || [];
  const tokens = aliases.map((alias) => normalizeText(alias));

  return products.filter((product) => {
    const haystack = normalizeText(
      [product?.name, product?.title, product?.category, product?.brand, product?.description]
        .filter(Boolean)
        .join(" "),
    );
    return tokens.some((token) => haystack.includes(token));
  });
};

const buildMentions = (answer, products) => {
  if (!answer || !products?.length) return [];
  const normalizedAnswer = normalizeText(answer);
  const mentions = [];

  for (const product of products) {
    const name = product?.name || product?.title;
    if (!name) continue;
    const normalizedName = normalizeText(name);
    if (normalizedName && normalizedAnswer.includes(normalizedName)) {
      mentions.push({
        name,
        itemCode: product?.itemCode ?? null,
      });
    }
  }

  return mentions.slice(0, 6);
};

const scoreProduct = (product, tokens) => {
  const haystack = normalizeText(
    [
      product?.name,
      product?.title,
      product?.brand,
      product?.category,
      product?.description,
      product?.size,
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (!haystack || tokens.length === 0) {
    return 0;
  }

  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += 1;
    }
  }
  return score;
};

const selectRelevantProducts = (products, question) => {
  const tokens = tokenize(question);
  if (tokens.length === 0) {
    return products.slice(0, AI_MAX_PRODUCTS);
  }

  const scored = products
    .map((product) => ({
      product,
      score: scoreProduct(product, tokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return products.slice(0, AI_MAX_PRODUCTS);
  }

  return scored.slice(0, AI_MAX_PRODUCTS).map((entry) => entry.product);
};

const stringifyField = (value) => {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === "string" || typeof entry === "number")
      .map((entry) => String(entry))
      .join(", ");
  }
  return "";
};

const buildProductFacts = (product) => {
  const ignoreKeys = new Set([
    "_id",
    "__v",
    "imageUrl",
    "images",
    "profilePicture",
    "createdAt",
    "updatedAt",
  ]);

  const entries = Object.entries(product || {})
    .filter(([key]) => !ignoreKeys.has(key))
    .map(([key, value]) => {
      if (key === "price" && Number.isFinite(Number(value))) {
        return [`Price`, `${Number(value)} RON`];
      }
      const stringValue = stringifyField(value);
      if (!stringValue) return null;
      const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
      return [label, stringValue];
    })
    .filter(Boolean);

  return entries.map(([label, value]) => `${label}: ${value}`);
};

const buildProductContext = (products) =>
  products
    .map((product, index) => {
      const name = product?.name || product?.title || "Unnamed product";
      const rawDescription = product?.description || "";
      const description =
        rawDescription.length > AI_MAX_DESC_CHARS
          ? `${rawDescription.slice(0, AI_MAX_DESC_CHARS)}...`
          : rawDescription;
      const facts = buildProductFacts(product);

      return [
        `Product ${index + 1}: ${name}`,
        ...facts,
        description ? `Description: ${description}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

const buildCartContext = (cartItems, products) => {
  if (!Array.isArray(cartItems) || cartItems.length === 0) return "";
  const productByCode = new Map(
    products
      .map((product) => [Number(product?.itemCode), product])
      .filter(([code]) => Number.isInteger(code)),
  );
  const lines = [];

  for (const item of cartItems) {
    const code = Number(item?.itemCode);
    const qty = Number(item?.qty) || 1;
    const product = productByCode.get(code);
    if (!product) continue;
    const name = product?.name || product?.title || "Produs";
    const category = product?.category || "General";
    const price = Number.isFinite(product?.price) ? `${product.price} RON` : "Price unknown";
    lines.push(`${name} (x${qty}) - ${category} - ${price}`);
  }

  return lines.length ? `Cart items:\n${lines.join("\n")}` : "";
};

const callOllama = (payload) =>
  new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(OLLAMA_HOST);
    } catch (error) {
      reject(new Error("Invalid OLLAMA_HOST"));
      return;
    }

    const data = JSON.stringify(payload);
    const lib = parsedUrl.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
        path: "/api/generate",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Ollama error ${res.statusCode}`));
            return;
          }
          try {
            const parsed = JSON.parse(body);
            resolve(parsed);
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    req.setTimeout(OLLAMA_TIMEOUT_MS, () => {
      req.destroy(new Error("Ollama request timeout"));
    });
    req.on("error", (error) => reject(error));
    req.write(data);
    req.end();
  });

const aiChatHandler = async (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const history = Array.isArray(req.body?.history) ? req.body.history : [];
  const cart = Array.isArray(req.body?.cart) ? req.body.cart : [];

  if (!message) {
    return res.status(400).json({ error: "Mesajul este gol." });
  }

  try {
    const language = resolveLanguagePreference(message, history);

    if (isGreeting(message) && message.length <= 40) {
      return res.json({
        answer:
          language === "en"
            ? "Hi! I can help with product questions or recommendations. What are you looking for?"
            : applyRomanianDiacritics(
                "Salut! Te pot ajuta cu întrebări despre produse sau recomandări. Ce cauți?",
              ),
        model: OLLAMA_MODEL,
      });
    }

    if (isLanguageRequest(message)) {
      return res.json({
        answer:
          language === "en"
            ? "Sure, I can answer in English. What product are you looking for?"
            : applyRomanianDiacritics("Sigur, pot răspunde în engleză. Ce produs cauți?"),
        model: OLLAMA_MODEL,
      });
    }

    if (isThanks(message)) {
      return res.json({
        answer:
          language === "en"
            ? "Glad to help! Tell me what you’re looking for next."
            : applyRomanianDiacritics("Cu plăcere! Spune-mi dacă vrei și alte recomandări."),
        model: OLLAMA_MODEL,
      });
    }

    const products = await Product.find()
      .select("name title category brand description price itemCode")
      .lean();

    if (!products.length) {
      return res.json({
        answer: "Nu am gasit produse in baza de date.",
        products: [],
      });
    }

    let categoryKey = detectCategoryKey(message);
    if (!categoryKey && isShortFollowUp(message)) {
      categoryKey = findCategoryFromHistory(history);
    }
    const categoryMatches = filterProductsByCategory(products, categoryKey);
    if (isListQuestion(message) && categoryMatches.length > 0) {
      const names = categoryMatches
        .slice(0, 20)
        .map((product) => product?.name || product?.title || "Produs fara nume")
        .filter(Boolean);
      const followUp =
        language === "en"
          ? "Do you prefer a specific brand or price range?"
          : "Preferi un anumit brand sau un buget anume?";
      return res.json({
        answer:
          language === "en"
            ? names.length === 1
              ? `Sure! We have 1 product in that category: ${names[0]}. ${followUp}`
              : `Sure! We have ${names.length} products in that category: ${names.join(", ")}. ${followUp}`
            : names.length === 1
              ? applyRomanianDiacritics(
                  `Sigur! Avem 1 produs în categoria cerută: ${names[0]}. ${followUp}`,
                )
              : applyRomanianDiacritics(
                  `Sigur! Avem ${names.length} produse în categoria cerută: ${names.join(
                    ", ",
                  )}. ${followUp}`,
                ),
        mentions: categoryMatches.slice(0, 20).map((product) => ({
          name: product?.name || product?.title || "Produs fara nume",
          itemCode: product?.itemCode ?? null,
        })),
        model: OLLAMA_MODEL,
      });
    }

    const relevantProducts = selectRelevantProducts(products, message);
    const productContext = buildProductContext(relevantProducts);
    const cartContext = buildCartContext(cart, products);
    const systemPrompt =
      "Esti un asistent de suport pentru produse, foarte natural si profesionist. " +
      "Raspunzi exclusiv pe baza datelor despre produse primite mai jos. " +
      "Daca informatia nu exista, spui clar ca nu apare in descrieri. " +
      "Foloseste romana corecta cu diacritice. " +
      "Fii concis, dar uman: 1–3 propozitii + o intrebare scurta de clarificare cand e util. " +
      "Daca utilizatorul cere explicit engleza, raspunde in engleza; altfel ramai in romana.";
    const userPrompt = [
      `User preferred language: ${language === "en" ? "English" : "Romanian"}`,
      `Romanian output required: ${forceRomanianReply(language) ? "YES" : "NO"}`,
      `User question: ${message}`,
      cartContext,
      "Product info:",
      productContext,
      "Answer:",
    ]
      .filter(Boolean)
      .join("\n\n");

    let aiResponse;
    try {
      const ollamaResult = await callOllama({
        model: OLLAMA_MODEL,
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 256,
        },
      });
      aiResponse = typeof ollamaResult?.response === "string" ? ollamaResult.response.trim() : "";
    } catch (error) {
      console.error("Eroare Ollama:", error.message || error);
      return res.status(503).json({
        error: "ollama_not_running",
        message:
          error?.message === "Ollama request timeout"
            ? "Ollama raspunde prea lent. Incearca din nou sau foloseste un model mai mic."
            : "Ollama nu raspunde local. Porneste Ollama si descarca un model.",
        hint: `Ruleaza: ollama pull ${OLLAMA_MODEL}`,
        model: OLLAMA_MODEL,
      });
    }

    const finalAnswerRaw = aiResponse || "Nu am gasit un raspuns clar in descrieri.";
    const finalAnswer =
      language === "en" ? finalAnswerRaw : applyRomanianDiacritics(finalAnswerRaw);
    const mentions = buildMentions(finalAnswer, relevantProducts);
    return res.json({
      answer: finalAnswer,
      mentions,
      model: OLLAMA_MODEL,
    });
  } catch (error) {
    console.error("Eroare AI chat:", error.message || error);
    return res.status(500).json({ error: "Eroare server" });
  }
};

module.exports = aiChatHandler;
