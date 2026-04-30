const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

function createAuthTokenService({
  jwtSecret = "",
  jwtExpiresIn = "8h",
  jwtClockSkewSeconds = 60,
  nodeEnv = "development",
} = {}) {
  const safeSecret = String(jwtSecret || "");
  const safeExpiresIn = String(jwtExpiresIn || "8h").trim() || "8h";
  const safeClockSkew = Math.max(0, Number.parseInt(String(jwtClockSkewSeconds || "60"), 10) || 60);

  const assertAuthConfiguration = () => {
    if (safeSecret) return;
    if (nodeEnv === "production") {
      throw new Error("JWT_SECRET is required in production.");
    }
    console.warn("[auth] JWT_SECRET missing. JWT login will fail until configured.");
  };

  const signAccessToken = (user) => {
    if (!safeSecret) {
      throw new Error("JWT_SECRET is not configured.");
    }
    const role = String(user?.role || user?.user_role || "customer").trim().toLowerCase();
    return jwt.sign(
      {
        sub: String(user?._id || ""),
        email: String(user?.email || ""),
        role: role || "customer",
      },
      safeSecret,
      { expiresIn: safeExpiresIn },
    );
  };

  const extractBearerToken = (authorizationHeader) => {
    if (typeof authorizationHeader !== "string" || !authorizationHeader.trim()) {
      return { token: "", errorType: "missing_token" };
    }
    const trimmed = authorizationHeader.trim();
    const match = /^Bearer\s+(.+)$/i.exec(trimmed);
    if (!match) {
      return { token: "", errorType: "malformed_token" };
    }
    const token = String(match[1] || "").trim();
    if (!token || /\s/.test(token)) {
      return { token: "", errorType: "malformed_token" };
    }
    return { token, errorType: "" };
  };

  const verifyJwtToken = (token) => {
    try {
      const decoded = jwt.verify(token, safeSecret, {
        clockTolerance: safeClockSkew,
      });
      if (!decoded || typeof decoded !== "object") {
        return { ok: false, errorType: "invalid_claims" };
      }
      const sub = String(decoded.sub || "").trim();
      if (!mongoose.Types.ObjectId.isValid(sub)) {
        return { ok: false, errorType: "invalid_claims" };
      }
      return {
        ok: true,
        payload: {
          sub,
          email: String(decoded.email || "").trim().toLowerCase(),
          role: String(decoded.role || "customer").trim().toLowerCase() || "customer",
        },
      };
    } catch (error) {
      if (error?.name === "TokenExpiredError") return { ok: false, errorType: "expired_token" };
      if (error?.name === "JsonWebTokenError") {
        const message = String(error?.message || "").toLowerCase();
        if (message.includes("invalid signature")) {
          return { ok: false, errorType: "invalid_signature" };
        }
        return { ok: false, errorType: "malformed_token" };
      }
      if (error?.name === "NotBeforeError") return { ok: false, errorType: "invalid_claims" };
      return { ok: false, errorType: "invalid_token" };
    }
  };

  return {
    assertAuthConfiguration,
    signAccessToken,
    extractBearerToken,
    verifyJwtToken,
  };
}

module.exports = {
  createAuthTokenService,
};

