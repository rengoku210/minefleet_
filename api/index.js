// src/config.ts
function optionalEnv(key, fallback) {
  return process.env[key] || fallback;
}
function loadConfig() {
  return {
    host: optionalEnv("CONTROLLER_HOST", "0.0.0.0"),
    port: parseInt(optionalEnv("CONTROLLER_PORT", optionalEnv("PORT", "3001")), 10),
    controllerUrl: optionalEnv("CONTROLLER_URL", optionalEnv("VERCEL_URL", "http://localhost:3001")),
    storage: {
      redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
      redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN
    },
    jwt: {
      secret: optionalEnv("JWT_SECRET", "minefleet_default_jwt_secret_change_in_production_xyz123"),
      refreshSecret: optionalEnv("JWT_REFRESH_SECRET", "minefleet_default_refresh_secret_change_in_production_abc456"),
      accessExpiry: optionalEnv("JWT_ACCESS_EXPIRY", "15m"),
      refreshExpiry: optionalEnv("JWT_REFRESH_EXPIRY", "7d")
    },
    admin: {
      email: optionalEnv("ADMIN_EMAIL", "admin@minefleet.local"),
      password: optionalEnv("ADMIN_PASSWORD", "Admin1234!")
    },
    nodeEnv: optionalEnv("NODE_ENV", "development")
  };
}

// src/storage/memory.ts
var MemoryStorageAdapter = class {
  users = /* @__PURE__ */ new Map();
  // email -> user
  usersById = /* @__PURE__ */ new Map();
  // id -> email
  machines = /* @__PURE__ */ new Map();
  // id -> machine
  machineUidMap = /* @__PURE__ */ new Map();
  // uid -> id
  credentials = /* @__PURE__ */ new Map();
  // machineId -> cred
  configs = /* @__PURE__ */ new Map();
  // machineId -> config
  states = /* @__PURE__ */ new Map();
  // machineId -> state
  history = /* @__PURE__ */ new Map();
  // machineId -> points
  tokens = /* @__PURE__ */ new Map();
  // id -> token
  tokenHashMap = /* @__PURE__ */ new Map();
  // tokenHash -> id
  tokenExpiry = /* @__PURE__ */ new Map();
  // id -> expiresAt epoch ms
  commandQueues = /* @__PURE__ */ new Map();
  // machineId -> commands
  groups = /* @__PURE__ */ new Map();
  // id -> group
  auditLogs = [];
  settings = {
    electricityPricePerKwh: 0.12,
    telemetryRetentionDays: 10,
    defaultCurrency: "USD"
  };
  async init() {
  }
  // Users
  async getUserByEmail(email) {
    return this.users.get(email.toLowerCase()) || null;
  }
  async getUserById(id) {
    const email = this.usersById.get(id);
    if (!email) return null;
    return this.users.get(email) || null;
  }
  async saveUser(user) {
    const email = user.email.toLowerCase();
    this.users.set(email, { ...user, email });
    this.usersById.set(user.id, email);
  }
  async listUsers() {
    return Array.from(this.users.values());
  }
  async deleteUser(id) {
    const email = this.usersById.get(id);
    if (!email) return false;
    this.usersById.delete(id);
    return this.users.delete(email);
  }
  // Machines
  async getMachineById(id) {
    return this.machines.get(id) || null;
  }
  async getMachineByUid(uid) {
    const id = this.machineUidMap.get(uid);
    if (!id) return null;
    return this.machines.get(id) || null;
  }
  async saveMachine(machine) {
    this.machines.set(machine.id, { ...machine });
    this.machineUidMap.set(machine.machineUid, machine.id);
  }
  async listMachines() {
    return Array.from(this.machines.values());
  }
  async deleteMachine(id) {
    const machine = this.machines.get(id);
    if (!machine) return false;
    this.machineUidMap.delete(machine.machineUid);
    this.credentials.delete(id);
    this.configs.delete(id);
    this.states.delete(id);
    this.history.delete(id);
    this.commandQueues.delete(id);
    return this.machines.delete(id);
  }
  // Credentials
  async getMachineCredential(machineId) {
    return this.credentials.get(machineId) || null;
  }
  async saveMachineCredential(cred) {
    this.credentials.set(cred.machineId, { ...cred });
  }
  // Configurations
  async getMachineConfig(machineId) {
    return this.configs.get(machineId) || null;
  }
  async saveMachineConfig(machineId, config) {
    this.configs.set(machineId, { ...config });
  }
  // Live State
  async getMachineState(machineId) {
    return this.states.get(machineId) || null;
  }
  async saveMachineState(state) {
    this.states.set(state.machineId, { ...state });
  }
  // 10-Day Compact History
  async appendTelemetryHistory(machineId, point, maxAgeDays = 10) {
    const points = this.history.get(machineId) || [];
    points.push(point);
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1e3;
    const trimmed = points.filter((p) => p.t >= cutoff);
    if (trimmed.length > 3e3) {
      trimmed.splice(0, trimmed.length - 3e3);
    }
    this.history.set(machineId, trimmed);
  }
  async getTelemetryHistory(machineId, durationMinutes = 1440) {
    const points = this.history.get(machineId) || [];
    const cutoff = Date.now() - durationMinutes * 60 * 1e3;
    return points.filter((p) => p.t >= cutoff);
  }
  // Enrollment Tokens
  async saveEnrollmentToken(token, ttlSeconds) {
    this.tokens.set(token.id, { ...token });
    this.tokenHashMap.set(token.tokenHash, token.id);
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1e3 : new Date(token.expiresAt).getTime();
    this.tokenExpiry.set(token.id, expiresAt);
  }
  async getEnrollmentTokenByHash(tokenHash) {
    const id = this.tokenHashMap.get(tokenHash);
    if (!id) return null;
    return this.getEnrollmentTokenById(id);
  }
  async getEnrollmentTokenById(id) {
    const token = this.tokens.get(id);
    if (!token) return null;
    const expiry = this.tokenExpiry.get(id);
    if (expiry && expiry < Date.now()) {
      this.tokens.delete(id);
      this.tokenHashMap.delete(token.tokenHash);
      this.tokenExpiry.delete(id);
      return null;
    }
    return token;
  }
  async listEnrollmentTokens() {
    const now = Date.now();
    const active = [];
    for (const [id, token] of this.tokens.entries()) {
      const expiry = this.tokenExpiry.get(id);
      if (expiry && expiry < now) {
        this.tokens.delete(id);
        this.tokenHashMap.delete(token.tokenHash);
        this.tokenExpiry.delete(id);
      } else {
        active.push(token);
      }
    }
    return active;
  }
  async revokeEnrollmentToken(id) {
    const token = this.tokens.get(id);
    if (!token) return false;
    token.revoked = true;
    return true;
  }
  // Command Queue
  async pushCommand(machineId, command) {
    const queue = this.commandQueues.get(machineId) || [];
    queue.push(command);
    this.commandQueues.set(machineId, queue);
  }
  async popCommands(machineId) {
    const queue = this.commandQueues.get(machineId) || [];
    this.commandQueues.set(machineId, []);
    return queue;
  }
  // Settings
  async getSettings() {
    return { ...this.settings };
  }
  async saveSettings(settings) {
    this.settings = { ...this.settings, ...settings };
  }
  // Groups
  async getGroup(id) {
    return this.groups.get(id) || null;
  }
  async saveGroup(group) {
    this.groups.set(group.id, { ...group });
  }
  async listGroups() {
    return Array.from(this.groups.values());
  }
  async deleteGroup(id) {
    return this.groups.delete(id);
  }
  // Audit Logs
  async logAudit(entry) {
    this.auditLogs.unshift(entry);
    if (this.auditLogs.length > 500) {
      this.auditLogs.length = 500;
    }
  }
  async listAuditLogs(limit = 100, userId) {
    let logs = this.auditLogs;
    if (userId) {
      logs = logs.filter((l) => l.userId === userId);
    }
    return logs.slice(0, limit);
  }
};

// src/storage/redis.ts
import { Redis } from "@upstash/redis";

// src/utils/logger.ts
import pino from "pino";
var logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV !== "production" ? { target: "pino-pretty", options: { colorize: true } } : void 0
});
function createChildLogger(name) {
  return logger.child({ component: name });
}

// src/storage/redis.ts
var logger2 = createChildLogger("storage-redis");
var UpstashRedisStorageAdapter = class {
  redis;
  constructor(url, token) {
    if (url && token) {
      this.redis = new Redis({ url, token });
    } else {
      this.redis = Redis.fromEnv();
    }
  }
  async init() {
    try {
      await this.redis.ping();
      logger2.info("Connected to Upstash Redis persistent storage");
    } catch (err) {
      logger2.error({ err }, "Failed to ping Upstash Redis. Check UPSTASH_REDIS_REST_URL and TOKEN.");
      throw err;
    }
  }
  // Users
  async getUserByEmail(email) {
    const raw = await this.redis.get(`mf:user:email:${email.toLowerCase()}`);
    return raw || null;
  }
  async getUserById(id) {
    const email = await this.redis.get(`mf:user:id:${id}`);
    if (!email) return null;
    return this.getUserByEmail(email);
  }
  async saveUser(user) {
    const email = user.email.toLowerCase();
    await this.redis.set(`mf:user:email:${email}`, { ...user, email });
    await this.redis.set(`mf:user:id:${user.id}`, email);
    await this.redis.sadd("mf:users:set", user.id);
  }
  async listUsers() {
    const userIds = await this.redis.smembers("mf:users:set");
    if (!userIds || userIds.length === 0) return [];
    const users = [];
    for (const id of userIds) {
      const u = await this.getUserById(id);
      if (u) users.push(u);
    }
    return users;
  }
  async deleteUser(id) {
    const email = await this.redis.get(`mf:user:id:${id}`);
    if (!email) return false;
    await this.redis.del(`mf:user:email:${email}`);
    await this.redis.del(`mf:user:id:${id}`);
    await this.redis.srem("mf:users:set", id);
    return true;
  }
  // Machines
  async getMachineById(id) {
    const raw = await this.redis.get(`mf:machine:${id}`);
    return raw || null;
  }
  async getMachineByUid(uid) {
    const id = await this.redis.get(`mf:uid_map:${uid}`);
    if (!id) return null;
    return this.getMachineById(id);
  }
  async saveMachine(machine) {
    await this.redis.set(`mf:machine:${machine.id}`, machine);
    await this.redis.set(`mf:uid_map:${machine.machineUid}`, machine.id);
    await this.redis.sadd("mf:machines:set", machine.id);
  }
  async listMachines() {
    const ids = await this.redis.smembers("mf:machines:set");
    if (!ids || ids.length === 0) return [];
    const machines = [];
    for (const id of ids) {
      const m = await this.getMachineById(id);
      if (m) machines.push(m);
    }
    return machines;
  }
  async deleteMachine(id) {
    const machine = await this.getMachineById(id);
    if (!machine) return false;
    await this.redis.del(`mf:machine:${id}`);
    await this.redis.del(`mf:uid_map:${machine.machineUid}`);
    await this.redis.del(`mf:cred:${id}`);
    await this.redis.del(`mf:config:${id}`);
    await this.redis.del(`mf:state:${id}`);
    await this.redis.del(`mf:history:${id}`);
    await this.redis.del(`mf:commands:${id}`);
    await this.redis.srem("mf:machines:set", id);
    return true;
  }
  // Credentials
  async getMachineCredential(machineId) {
    const raw = await this.redis.get(`mf:cred:${machineId}`);
    return raw || null;
  }
  async saveMachineCredential(cred) {
    await this.redis.set(`mf:cred:${cred.machineId}`, cred);
  }
  // Configurations
  async getMachineConfig(machineId) {
    const raw = await this.redis.get(`mf:config:${machineId}`);
    return raw || null;
  }
  async saveMachineConfig(machineId, config) {
    await this.redis.set(`mf:config:${machineId}`, config);
  }
  // Live State
  async getMachineState(machineId) {
    const raw = await this.redis.get(`mf:state:${machineId}`);
    return raw || null;
  }
  async saveMachineState(state) {
    await this.redis.set(`mf:state:${state.machineId}`, state, { ex: 172800 });
  }
  // 10-Day Compact History
  async appendTelemetryHistory(machineId, point, maxAgeDays = 10) {
    const key = `mf:history:${machineId}`;
    const raw = JSON.stringify(point);
    await this.redis.rpush(key, raw);
    await this.redis.ltrim(key, -2880, -1);
    await this.redis.expire(key, maxAgeDays * 86400 + 86400);
  }
  async getTelemetryHistory(machineId, durationMinutes = 1440) {
    const key = `mf:history:${machineId}`;
    const rawList = await this.redis.lrange(key, 0, -1);
    if (!rawList || rawList.length === 0) return [];
    const cutoff = Date.now() - durationMinutes * 60 * 1e3;
    const points = [];
    for (const item of rawList) {
      try {
        const p = typeof item === "string" ? JSON.parse(item) : item;
        if (p && p.t >= cutoff) {
          points.push(p);
        }
      } catch {
      }
    }
    return points;
  }
  // Enrollment Tokens
  async saveEnrollmentToken(token, ttlSeconds = 3600) {
    await this.redis.set(`mf:token:id:${token.id}`, token, { ex: ttlSeconds });
    await this.redis.set(`mf:token:hash:${token.tokenHash}`, token.id, { ex: ttlSeconds });
    await this.redis.sadd("mf:tokens:set", token.id);
  }
  async getEnrollmentTokenByHash(tokenHash) {
    const id = await this.redis.get(`mf:token:hash:${tokenHash}`);
    if (!id) return null;
    return this.getEnrollmentTokenById(id);
  }
  async getEnrollmentTokenById(id) {
    const token = await this.redis.get(`mf:token:id:${id}`);
    if (!token) {
      await this.redis.srem("mf:tokens:set", id);
      return null;
    }
    return token;
  }
  async listEnrollmentTokens() {
    const ids = await this.redis.smembers("mf:tokens:set");
    if (!ids || ids.length === 0) return [];
    const tokens = [];
    for (const id of ids) {
      const t = await this.getEnrollmentTokenById(id);
      if (t) tokens.push(t);
    }
    return tokens;
  }
  async revokeEnrollmentToken(id) {
    const token = await this.getEnrollmentTokenById(id);
    if (!token) return false;
    token.revoked = true;
    await this.redis.set(`mf:token:id:${id}`, token);
    return true;
  }
  // Command Queue
  async pushCommand(machineId, command) {
    const key = `mf:commands:${machineId}`;
    await this.redis.rpush(key, JSON.stringify(command));
    await this.redis.expire(key, 86400);
  }
  async popCommands(machineId) {
    const key = `mf:commands:${machineId}`;
    const items = await this.redis.lrange(key, 0, -1);
    if (!items || items.length === 0) return [];
    await this.redis.del(key);
    const commands = [];
    for (const item of items) {
      try {
        const cmd = typeof item === "string" ? JSON.parse(item) : item;
        if (cmd) commands.push(cmd);
      } catch {
      }
    }
    return commands;
  }
  // Settings
  async getSettings() {
    const raw = await this.redis.get("mf:settings");
    return raw || {
      electricityPricePerKwh: 0.12,
      telemetryRetentionDays: 10,
      defaultCurrency: "USD"
    };
  }
  async saveSettings(settings) {
    const current = await this.getSettings();
    await this.redis.set("mf:settings", { ...current, ...settings });
  }
  // Groups
  async getGroup(id) {
    const raw = await this.redis.get(`mf:group:${id}`);
    return raw || null;
  }
  async saveGroup(group) {
    await this.redis.set(`mf:group:${group.id}`, group);
    await this.redis.sadd("mf:groups:set", group.id);
  }
  async listGroups() {
    const ids = await this.redis.smembers("mf:groups:set");
    if (!ids || ids.length === 0) return [];
    const groups = [];
    for (const id of ids) {
      const g = await this.getGroup(id);
      if (g) groups.push(g);
    }
    return groups;
  }
  async deleteGroup(id) {
    await this.redis.del(`mf:group:${id}`);
    await this.redis.srem("mf:groups:set", id);
    return true;
  }
  // Audit Logs
  async logAudit(entry) {
    await this.redis.lpush("mf:audit_logs", JSON.stringify(entry));
    await this.redis.ltrim("mf:audit_logs", 0, 499);
  }
  async listAuditLogs(limit = 100, userId) {
    const raw = await this.redis.lrange("mf:audit_logs", 0, limit - 1);
    if (!raw || raw.length === 0) return [];
    const logs = [];
    for (const item of raw) {
      try {
        const l = typeof item === "string" ? JSON.parse(item) : item;
        if (l && (!userId || l.userId === userId)) {
          logs.push(l);
        }
      } catch {
      }
    }
    return logs;
  }
};

// src/storage/index.ts
var logger3 = createChildLogger("storage-factory");
var storageInstance = null;
function getStorage() {
  if (!storageInstance) {
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (redisUrl && redisToken) {
      logger3.info("Initializing Upstash Redis serverless storage adapter");
      storageInstance = new UpstashRedisStorageAdapter(redisUrl, redisToken);
    } else {
      logger3.info("Using in-memory storage adapter (development/test/offline mode)");
      storageInstance = new MemoryStorageAdapter();
    }
  }
  return storageInstance;
}

// src/app.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cookie from "@fastify/cookie";

// src/utils/errors.ts
var AppError = class extends Error {
  constructor(statusCode, message, code = "INTERNAL_ERROR", details) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = "AppError";
  }
  statusCode;
  code;
  details;
};
var UnauthorizedError = class extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message, "UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
};
var ForbiddenError = class extends AppError {
  constructor(message = "Forbidden") {
    super(403, message, "FORBIDDEN");
    this.name = "ForbiddenError";
  }
};
var NotFoundError = class extends AppError {
  constructor(resource) {
    super(404, `${resource} not found`, "NOT_FOUND");
    this.name = "NotFoundError";
  }
};
var ConflictError = class extends AppError {
  constructor(message) {
    super(409, message, "CONFLICT");
    this.name = "ConflictError";
  }
};
var ValidationError = class extends AppError {
  constructor(message, details) {
    super(400, message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
};

// src/utils/crypto.ts
import { randomBytes, createHash } from "crypto";
import bcrypt from "bcrypt";
var BCRYPT_ROUNDS = 12;
function generateToken(prefix = "mf") {
  const bytes = randomBytes(32);
  return `${prefix}_${bytes.toString("hex")}`;
}
function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// src/middleware/auth.ts
import { createHmac } from "crypto";
function base64UrlEncode(data) {
  const buf = typeof data === "string" ? Buffer.from(data) : data;
  return buf.toString("base64url");
}
function base64UrlDecode(str) {
  return Buffer.from(str, "base64url").toString();
}
function signJwt(payload, secret, expiresIn) {
  const now = Math.floor(Date.now() / 1e3);
  const exp = now + parseExpiry(expiresIn);
  const fullPayload = {
    ...payload,
    iat: now,
    exp
  };
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}
function verifyJwt(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new UnauthorizedError("Invalid token format");
  }
  const [header, body, signature] = parts;
  const expectedSignature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  if (signature !== expectedSignature) {
    throw new UnauthorizedError("Invalid token signature");
  }
  const payload = JSON.parse(base64UrlDecode(body));
  if (payload.exp <= Math.floor(Date.now() / 1e3)) {
    throw new UnauthorizedError("Token expired");
  }
  return payload;
}
function parseExpiry(expiry) {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid expiry format: ${expiry}`);
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 3600;
    case "d":
      return value * 86400;
    default:
      throw new Error(`Unknown time unit: ${match[2]}`);
  }
}
async function requireAuth(request, reply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing or invalid Authorization header");
  }
  const token = authHeader.slice(7);
  const config = loadConfig();
  try {
    const payload = verifyJwt(token, config.jwt.secret);
    if (payload.type !== "access") {
      throw new UnauthorizedError("Invalid token type");
    }
    request.user = payload;
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError("Invalid or expired token");
  }
}
async function requireAdmin(request, reply) {
  await requireAuth(request, reply);
  const user = request.user;
  if (user.role !== "admin") {
    throw new ForbiddenError("Admin access required");
  }
}

// src/services/auth.service.ts
import { randomUUID } from "crypto";
var logger4 = createChildLogger("auth");
async function login(email, password) {
  const storage = getStorage();
  const normalizedEmail = email.toLowerCase().trim();
  let user = await storage.getUserByEmail(normalizedEmail);
  if (!user) {
    const config2 = loadConfig();
    const allUsers = await storage.listUsers();
    if (allUsers.length === 0 && config2.admin.email && config2.admin.password) {
      if (normalizedEmail === config2.admin.email.toLowerCase().trim()) {
        const passwordHash = await hashPassword(config2.admin.password);
        user = {
          id: randomUUID(),
          email: config2.admin.email,
          passwordHash,
          role: "admin",
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        await storage.saveUser(user);
        logger4.info({ email: user.email }, "Initialized default admin account");
      }
    }
  }
  if (!user) {
    logger4.warn({ email: normalizedEmail }, "Login attempt for non-existent user");
    throw new UnauthorizedError("Invalid email or password");
  }
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    logger4.warn({ email: normalizedEmail }, "Login attempt with wrong password");
    throw new UnauthorizedError("Invalid email or password");
  }
  const config = loadConfig();
  const accessToken = signJwt(
    { sub: user.id, email: user.email, role: user.role, type: "access" },
    config.jwt.secret,
    config.jwt.accessExpiry
  );
  const refreshToken = signJwt(
    { sub: user.id, email: user.email, role: user.role, type: "refresh" },
    config.jwt.refreshSecret,
    config.jwt.refreshExpiry
  );
  logger4.info({ email: user.email, userId: user.id }, "User logged in");
  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, role: user.role }
  };
}
async function refreshAccessToken(refreshToken) {
  const config = loadConfig();
  const storage = getStorage();
  let payload;
  try {
    payload = verifyJwt(refreshToken, config.jwt.refreshSecret);
  } catch {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }
  if (payload.type !== "refresh") {
    throw new UnauthorizedError("Invalid token type");
  }
  const user = await storage.getUserById(payload.sub);
  if (!user) {
    throw new UnauthorizedError("User no longer exists");
  }
  const accessToken = signJwt(
    { sub: user.id, email: user.email, role: user.role, type: "access" },
    config.jwt.secret,
    config.jwt.accessExpiry
  );
  return { accessToken };
}

// src/middleware/audit.ts
import { randomUUID as randomUUID2 } from "crypto";
var logger5 = createChildLogger("audit");
async function auditLog(request, action, resourceType, resourceId, details) {
  try {
    const user = request.user;
    const storage = getStorage();
    await storage.logAudit({
      id: randomUUID2(),
      userId: user?.sub || null,
      userEmail: user?.email || null,
      action,
      resourceType,
      resourceId: resourceId || null,
      details,
      ipAddress: request.ip,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    logger5.error({ err, action, resourceType }, "Failed to write audit log");
  }
}

// src/routes/auth.ts
async function authRoutes(app) {
  app.post("/login", {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: "1 minute"
      }
    }
  }, async (request, reply) => {
    const { email, password } = request.body;
    if (!email || !password) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Email and password are required" }
      });
    }
    const result = await login(email, password);
    reply.setCookie("refreshToken", result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/auth/refresh",
      maxAge: 7 * 24 * 60 * 60
      // 7 days in seconds
    });
    await auditLog(request, "login", "user", result.user.id);
    return reply.send({
      success: true,
      data: {
        accessToken: result.accessToken,
        user: result.user
      }
    });
  });
  app.post("/refresh", async (request, reply) => {
    const refreshToken = request.cookies?.refreshToken;
    if (!refreshToken) {
      return reply.status(401).send({
        success: false,
        error: { code: "UNAUTHORIZED", message: "No refresh token" }
      });
    }
    const result = await refreshAccessToken(refreshToken);
    return reply.send({
      success: true,
      data: { accessToken: result.accessToken }
    });
  });
  app.post("/logout", async (request, reply) => {
    reply.clearCookie("refreshToken", {
      path: "/api/auth/refresh"
    });
    return reply.send({ success: true });
  });
  app.get("/me", { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    return reply.send({
      success: true,
      data: {
        id: user.sub,
        email: user.email,
        role: user.role
      }
    });
  });
}

// src/services/machine.service.ts
var logger6 = createChildLogger("machine-service");
async function authenticateMachine(apiToken) {
  const storage = getStorage();
  const tokenHash = hashToken(apiToken);
  const machines = await storage.listMachines();
  for (const m of machines) {
    const cred = await storage.getMachineCredential(m.id);
    if (cred && cred.tokenHash === tokenHash && !cred.revoked) {
      return { machineId: m.id, machineUid: m.machineUid };
    }
  }
  return null;
}
async function listMachines() {
  const storage = getStorage();
  const machines = await storage.listMachines();
  const groups = await storage.listGroups();
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));
  const now = Date.now();
  const result = [];
  for (const m of machines) {
    const lastSeenMs = m.lastHeartbeat ? new Date(m.lastHeartbeat).getTime() : 0;
    const isOnline = lastSeenMs > 0 && now - lastSeenMs < 6e4;
    const currentStatus = isOnline ? "online" : "offline";
    if (m.status !== currentStatus) {
      m.status = currentStatus;
      await storage.saveMachine(m);
    }
    result.push({
      id: m.id,
      name: m.name,
      hostname: m.hostname,
      os: m.os,
      status: m.status,
      cpu_model: m.cpuModel,
      gpu_count: m.gpus ? m.gpus.length : 0,
      agent_version: m.agentVersion,
      group_id: m.groupId || null,
      group_name: m.groupId ? groupMap.get(m.groupId) || null : null,
      last_heartbeat: m.lastHeartbeat || null
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
async function getMachine(machineId) {
  const storage = getStorage();
  const machine = await storage.getMachineById(machineId);
  if (!machine) throw new NotFoundError("Machine");
  let groupName = null;
  if (machine.groupId) {
    const group = await storage.getGroup(machine.groupId);
    groupName = group?.name || null;
  }
  const config = await storage.getMachineConfig(machineId);
  const latestTelemetry = await storage.getMachineState(machineId);
  const lastSeenMs = machine.lastHeartbeat ? new Date(machine.lastHeartbeat).getTime() : 0;
  const isOnline = lastSeenMs > 0 && Date.now() - lastSeenMs < 6e4;
  machine.status = isOnline ? "online" : "offline";
  return {
    machine: {
      ...machine,
      group_name: groupName,
      cpu_model: machine.cpuModel,
      cpu_cores: machine.cpuCores,
      cpu_threads: machine.cpuThreads,
      ram_bytes: machine.ramBytes,
      last_heartbeat: machine.lastHeartbeat
    },
    config,
    latestTelemetry
  };
}
async function updateMachineSystemInfo(machineId, info) {
  const storage = getStorage();
  const machine = await storage.getMachineById(machineId);
  if (!machine) return;
  machine.hostname = info.hostname;
  machine.os = info.os;
  machine.osVersion = info.osVersion;
  machine.cpuModel = info.cpuModel;
  machine.cpuCores = info.cpuCores;
  machine.cpuThreads = info.cpuThreads;
  machine.ramBytes = info.ramBytes;
  machine.gpus = info.gpus || [];
  machine.agentVersion = info.agentVersion;
  machine.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await storage.saveMachine(machine);
}
async function updateMachineHeartbeat(machineId, ipAddress) {
  const storage = getStorage();
  const machine = await storage.getMachineById(machineId);
  if (!machine) return;
  machine.status = "online";
  machine.lastHeartbeat = (/* @__PURE__ */ new Date()).toISOString();
  if (ipAddress) machine.ipAddress = ipAddress;
  machine.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await storage.saveMachine(machine);
}
async function deleteMachine(machineId) {
  const storage = getStorage();
  const deleted = await storage.deleteMachine(machineId);
  if (!deleted) {
    throw new NotFoundError("Machine");
  }
  logger6.info({ machineId }, "Machine deleted");
}
async function updateMachineName(machineId, name) {
  const storage = getStorage();
  const machine = await storage.getMachineById(machineId);
  if (!machine) throw new NotFoundError("Machine");
  machine.name = name;
  machine.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await storage.saveMachine(machine);
}
async function updateMachineGroup(machineId, groupId) {
  const storage = getStorage();
  const machine = await storage.getMachineById(machineId);
  if (!machine) throw new NotFoundError("Machine");
  if (groupId) {
    const group = await storage.getGroup(groupId);
    if (!group) throw new NotFoundError("Machine group");
  }
  machine.groupId = groupId;
  machine.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await storage.saveMachine(machine);
}

// ../../packages/shared-types/dist/config.js
var DEFAULT_MACHINE_CONFIG = {
  miningEnabled: false,
  cpuLimitPercent: 20,
  maxMiningThreads: null,
  gpuEnabled: false,
  gpuSettings: [],
  workloadPolicy: "conservative",
  pauseCpuAbove: 90,
  reduceCpuAbove: 75,
  resumeCpuBelow: 60,
  tempWarningC: 75,
  tempReduceC: 80,
  tempPauseC: 85,
  tempResumeC: 70,
  poolConfig: null,
  custom: {}
};

// src/services/config.service.ts
import { randomUUID as randomUUID3 } from "crypto";
var logger7 = createChildLogger("config-service");
async function getMachineConfig(machineId) {
  const storage = getStorage();
  const config = await storage.getMachineConfig(machineId);
  if (!config) {
    const def = {
      ...DEFAULT_MACHINE_CONFIG,
      id: randomUUID3(),
      machineId,
      version: 1,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await storage.saveMachineConfig(machineId, def);
    return def;
  }
  return config;
}
async function updateMachineConfig(machineId, updates) {
  const storage = getStorage();
  const current = await getMachineConfig(machineId);
  const updatedConfig = {
    ...current,
    ...updates,
    version: (current.version || 1) + 1,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await storage.saveMachineConfig(machineId, updatedConfig);
  await storage.pushCommand(machineId, {
    id: randomUUID3(),
    type: "update_config",
    payload: { config: updatedConfig },
    timestamp: Date.now()
  });
  logger7.info({ machineId, version: updatedConfig.version }, "Machine config updated");
  return { config: updatedConfig, version: updatedConfig.version };
}

// src/services/enrollment.service.ts
import { randomUUID as randomUUID4 } from "crypto";
var logger8 = createChildLogger("enrollment-service");
async function createEnrollmentToken(options) {
  const storage = getStorage();
  const {
    createdBy,
    label = null,
    targetGroupId = null,
    expiresInMinutes = 60
  } = options;
  if (targetGroupId) {
    const group = await storage.getGroup(targetGroupId);
    if (!group) {
      throw new NotFoundError("Machine group");
    }
  }
  const rawToken = generateToken("enroll");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1e3);
  const tokenId = randomUUID4();
  const tokenRecord = {
    id: tokenId,
    tokenHash,
    label,
    targetGroupId,
    createdBy,
    expiresAt: expiresAt.toISOString(),
    revoked: false,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await storage.saveEnrollmentToken(tokenRecord, expiresInMinutes * 60);
  logger8.info({ tokenId, label, expiresInMinutes }, "Enrollment token created");
  return {
    id: tokenId,
    rawToken,
    label,
    targetGroupId,
    expiresAt
  };
}
async function listEnrollmentTokens() {
  const storage = getStorage();
  const tokens = await storage.listEnrollmentTokens();
  const groups = await storage.listGroups();
  const groupMap = new Map(groups.map((g) => [g.id, g.name]));
  return tokens.map((t) => ({
    id: t.id,
    label: t.label || null,
    target_group_id: t.targetGroupId || null,
    target_group_name: t.targetGroupId ? groupMap.get(t.targetGroupId) || null : null,
    created_by: t.createdBy || "admin",
    expires_at: t.expiresAt,
    used_at: t.usedAt || null,
    used_by_machine: t.usedByMachine || null,
    revoked: t.revoked,
    created_at: t.createdAt
  }));
}
async function revokeEnrollmentToken(tokenId) {
  const storage = getStorage();
  const revoked = await storage.revokeEnrollmentToken(tokenId);
  if (!revoked) {
    throw new NotFoundError("Enrollment token");
  }
  logger8.info({ tokenId }, "Enrollment token revoked");
}
async function enrollMachine(rawToken, machineUid, systemInfo, ipAddress) {
  const storage = getStorage();
  const tokenHash = hashToken(rawToken);
  const token = await storage.getEnrollmentTokenByHash(tokenHash);
  if (!token) {
    throw new UnauthorizedError("Invalid enrollment token");
  }
  if (token.revoked) {
    throw new UnauthorizedError("Enrollment token has been revoked");
  }
  if (token.usedAt) {
    throw new UnauthorizedError("Enrollment token has already been used");
  }
  if (new Date(token.expiresAt).getTime() < Date.now()) {
    throw new UnauthorizedError("Enrollment token has expired");
  }
  const existing = await storage.getMachineByUid(machineUid);
  if (existing) {
    throw new ValidationError("Machine with this UID is already enrolled");
  }
  const machineId = randomUUID4();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const machineRecord = {
    id: machineId,
    machineUid,
    name: systemInfo.hostname || "PC",
    hostname: systemInfo.hostname || "localhost",
    os: systemInfo.os || "unknown",
    osVersion: systemInfo.osVersion,
    cpuModel: systemInfo.cpuModel || "Unknown CPU",
    cpuCores: systemInfo.cpuCores || 1,
    cpuThreads: systemInfo.cpuThreads || 1,
    ramBytes: systemInfo.ramBytes || 0,
    gpus: systemInfo.gpus || [],
    agentVersion: systemInfo.agentVersion || "0.1.0",
    ipAddress,
    groupId: token.targetGroupId || null,
    status: "online",
    lastHeartbeat: now,
    registeredAt: now,
    updatedAt: now
  };
  await storage.saveMachine(machineRecord);
  const machineApiToken = generateToken("agent");
  const machineTokenHash = hashToken(machineApiToken);
  const credentialRecord = {
    machineId,
    tokenHash: machineTokenHash,
    issuedAt: now,
    revoked: false
  };
  await storage.saveMachineCredential(credentialRecord);
  const configRecord = {
    ...DEFAULT_MACHINE_CONFIG,
    id: randomUUID4(),
    machineId,
    version: 1,
    miningEnabled: false,
    // Strictly OFF
    updatedAt: now
  };
  if (token.targetGroupId) {
    const group = await storage.getGroup(token.targetGroupId);
    if (group?.defaultConfig) {
      Object.assign(configRecord, group.defaultConfig);
      configRecord.miningEnabled = false;
    }
  }
  await storage.saveMachineConfig(machineId, configRecord);
  token.usedAt = now;
  token.usedByMachine = machineId;
  await storage.saveEnrollmentToken(token);
  logger8.info({ machineId, machineUid, hostname: systemInfo.hostname }, "Machine enrolled successfully");
  return { machineId, machineApiToken, config: configRecord };
}

// src/routes/machines.ts
import { randomUUID as randomUUID5 } from "crypto";
async function machineRoutes(app) {
  app.post("/enroll", {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: "1 minute"
      }
    }
  }, async (request, reply) => {
    const { enrollmentToken, machineUid, systemInfo } = request.body || {};
    if (!enrollmentToken || !machineUid || !systemInfo) {
      return reply.status(400).send({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "enrollmentToken, machineUid, and systemInfo are required" }
      });
    }
    const result = await enrollMachine(
      enrollmentToken,
      machineUid,
      systemInfo,
      request.ip
    );
    return reply.status(201).send({
      success: true,
      data: result
    });
  });
  app.post("/heartbeat", async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedError("Missing or invalid Authorization header");
    }
    const apiToken = authHeader.substring(7);
    const auth = await authenticateMachine(apiToken);
    if (!auth) {
      throw new UnauthorizedError("Invalid machine credentials");
    }
    const storage = getStorage();
    const machineId = auth.machineId;
    const body = request.body || {};
    const tel = body.telemetry || {
      cpuPercent: 0,
      ramPercent: 0,
      gpuPercent: 0,
      cpuTempC: 0,
      hashrate: 0,
      miningThreads: 0,
      miningStatus: "idle",
      safetyState: "normal"
    };
    await updateMachineHeartbeat(machineId, request.ip);
    if (body.systemInfo) {
      await updateMachineSystemInfo(machineId, body.systemInfo);
    }
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    await storage.saveMachineState({
      machineId,
      cpuPercent: tel.cpuPercent || 0,
      ramPercent: tel.ramPercent || 0,
      gpuPercent: tel.gpuPercent || 0,
      cpuTempC: tel.cpuTempC || 0,
      gpuTempC: tel.gpuTempC || null,
      hashrate: tel.hashrate || 0,
      miningThreads: tel.miningThreads || 0,
      miningStatus: tel.miningStatus || "idle",
      powerWatts: tel.powerWatts || null,
      safetyState: tel.safetyState || "normal",
      recordedAt: nowIso
    });
    await storage.appendTelemetryHistory(
      machineId,
      {
        t: now,
        c: Math.round((tel.cpuPercent || 0) * 10) / 10,
        r: Math.round((tel.ramPercent || 0) * 10) / 10,
        g: Math.round((tel.gpuPercent || 0) * 10) / 10,
        temp: Math.round((tel.cpuTempC || 0) * 10) / 10,
        h: Math.round((tel.hashrate || 0) * 10) / 10,
        p: tel.powerWatts ? Math.round(tel.powerWatts) : void 0
      },
      10
      // 10 days max retention
    );
    const commands = await storage.popCommands(machineId);
    const currentConfig = await getMachineConfig(machineId);
    return reply.send({
      success: true,
      data: {
        commands,
        config: body.configVersion && body.configVersion >= currentConfig.version ? void 0 : currentConfig,
        serverTime: nowIso
      }
    });
  });
  app.get("/", { preHandler: [requireAuth] }, async (request, reply) => {
    const machines = await listMachines();
    return reply.send({ success: true, data: { machines, total: machines.length } });
  });
  app.get("/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const data = await getMachine(request.params.id);
    return reply.send({ success: true, data });
  });
  app.get(
    "/:id/history",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const storage = getStorage();
      const minutes = parseInt(request.query?.minutes || "1440", 10);
      const points = await storage.getTelemetryHistory(request.params.id, minutes);
      return reply.send({ success: true, data: { points, count: points.length } });
    }
  );
  app.patch(
    "/:id",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { name, groupId } = request.body || {};
      if (name !== void 0) {
        await updateMachineName(request.params.id, name);
      }
      if (groupId !== void 0) {
        await updateMachineGroup(request.params.id, groupId);
      }
      await auditLog(request, "update_machine", "machine", request.params.id, { name, groupId });
      return reply.send({ success: true });
    }
  );
  app.patch(
    "/:id/config",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { config, version } = await updateMachineConfig(
        request.params.id,
        request.body
      );
      await auditLog(request, "update_config", "machine_config", request.params.id, request.body);
      return reply.send({ success: true, data: { config, version } });
    }
  );
  app.post("/:id/start", { preHandler: [requireAdmin] }, async (request, reply) => {
    const storage = getStorage();
    const machineId = request.params.id;
    await updateMachineConfig(machineId, { miningEnabled: true });
    await storage.pushCommand(machineId, {
      id: randomUUID5(),
      type: "start",
      timestamp: Date.now()
    });
    await auditLog(request, "start_mining", "machine", machineId);
    return reply.send({ success: true });
  });
  app.post("/:id/stop", { preHandler: [requireAdmin] }, async (request, reply) => {
    const storage = getStorage();
    const machineId = request.params.id;
    await updateMachineConfig(machineId, { miningEnabled: false });
    await storage.pushCommand(machineId, {
      id: randomUUID5(),
      type: "stop",
      timestamp: Date.now()
    });
    await auditLog(request, "stop_mining", "machine", machineId);
    return reply.send({ success: true });
  });
  app.post("/:id/pause", { preHandler: [requireAdmin] }, async (request, reply) => {
    const storage = getStorage();
    const machineId = request.params.id;
    await storage.pushCommand(machineId, {
      id: randomUUID5(),
      type: "pause",
      timestamp: Date.now()
    });
    await auditLog(request, "pause_mining", "machine", machineId);
    return reply.send({ success: true });
  });
  app.post("/:id/resume", { preHandler: [requireAdmin] }, async (request, reply) => {
    const storage = getStorage();
    const machineId = request.params.id;
    await storage.pushCommand(machineId, {
      id: randomUUID5(),
      type: "resume",
      timestamp: Date.now()
    });
    await auditLog(request, "resume_mining", "machine", machineId);
    return reply.send({ success: true });
  });
  app.delete("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    await deleteMachine(request.params.id);
    await auditLog(request, "delete_machine", "machine", request.params.id);
    return reply.send({ success: true });
  });
}

// src/routes/enrollment.ts
async function enrollmentRoutes(app) {
  app.post(
    "/",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const user = request.user;
      const { label, targetGroupId, expiresInMinutes } = request.body || {};
      const tokenInfo = await createEnrollmentToken({
        createdBy: user.sub,
        label,
        targetGroupId,
        expiresInMinutes
      });
      const config = loadConfig();
      const origin = `${request.protocol}://${request.hostname}`;
      const baseUrl = config.controllerUrl && !config.controllerUrl.includes("localhost") ? config.controllerUrl : origin;
      await auditLog(request, "create_enrollment_token", "enrollment_token", tokenInfo.id);
      return reply.status(201).send({
        success: true,
        data: {
          id: tokenInfo.id,
          token: tokenInfo.rawToken,
          label: tokenInfo.label,
          targetGroupId: tokenInfo.targetGroupId,
          expiresAt: tokenInfo.expiresAt.toISOString(),
          installCommandLinux: `curl -fsSL "${baseUrl}/install.sh?token=${tokenInfo.rawToken}" | bash`,
          installCommandWindows: `powershell -ExecutionPolicy Bypass -c "irm '${baseUrl}/install.ps1?token=${tokenInfo.rawToken}' | iex"`
        }
      });
    }
  );
  app.get("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const tokens = await listEnrollmentTokens();
    return reply.send({ success: true, data: { tokens } });
  });
  app.delete("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    await revokeEnrollmentToken(request.params.id);
    await auditLog(request, "revoke_enrollment_token", "enrollment_token", request.params.id);
    return reply.send({ success: true });
  });
}

// src/routes/groups.ts
import { randomUUID as randomUUID6 } from "crypto";
async function groupRoutes(app) {
  app.get("/", { preHandler: [requireAuth] }, async (request, reply) => {
    const storage = getStorage();
    const groups = await storage.listGroups();
    const machines = await storage.listMachines();
    const counts = /* @__PURE__ */ new Map();
    for (const m of machines) {
      if (m.groupId) {
        counts.set(m.groupId, (counts.get(m.groupId) || 0) + 1);
      }
    }
    const result = groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description || null,
      default_config: g.defaultConfig || null,
      machine_count: counts.get(g.id) || 0,
      created_at: g.createdAt
    }));
    return reply.send({ success: true, data: { groups: result } });
  });
  app.post(
    "/",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const storage = getStorage();
      const { name, description, defaultConfig } = request.body || {};
      if (!name) throw new ValidationError("Group name is required");
      const existing = (await storage.listGroups()).find((g) => g.name.toLowerCase() === name.toLowerCase());
      if (existing) throw new ConflictError("A group with this name already exists");
      const id = randomUUID6();
      await storage.saveGroup({
        id,
        name,
        description: description || null,
        defaultConfig: defaultConfig || null,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      await auditLog(request, "create_group", "machine_group", id, { name });
      return reply.status(201).send({ success: true, data: { id, name } });
    }
  );
  app.patch(
    "/:id",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const storage = getStorage();
      const group = await storage.getGroup(request.params.id);
      if (!group) throw new NotFoundError("Machine group");
      const { name, description, defaultConfig } = request.body || {};
      if (name !== void 0) group.name = name;
      if (description !== void 0) group.description = description;
      if (defaultConfig !== void 0) group.defaultConfig = defaultConfig;
      await storage.saveGroup(group);
      await auditLog(request, "update_group", "machine_group", request.params.id);
      return reply.send({ success: true });
    }
  );
  app.delete("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const storage = getStorage();
    const deleted = await storage.deleteGroup(request.params.id);
    if (!deleted) throw new NotFoundError("Machine group");
    await auditLog(request, "delete_group", "machine_group", request.params.id);
    return reply.send({ success: true });
  });
}

// src/routes/schedules.ts
async function scheduleRoutes(app) {
  app.get("/", { preHandler: [requireAuth] }, async (request, reply) => {
    return reply.send({ success: true, data: { schedules: [] } });
  });
}

// src/routes/stats.ts
async function statsRoutes(app) {
  app.get("/overview", { preHandler: [requireAuth] }, async (request, reply) => {
    const storage = getStorage();
    const machines = await storage.listMachines();
    const now = Date.now();
    let onlineCount = 0;
    let offlineCount = 0;
    let totalCpu = 0;
    let totalGpu = 0;
    let totalHashrate = 0;
    let maxTemp = 0;
    let activeStates = 0;
    for (const m of machines) {
      const lastSeenMs = m.lastHeartbeat ? new Date(m.lastHeartbeat).getTime() : 0;
      const isOnline = lastSeenMs > 0 && now - lastSeenMs < 6e4;
      if (isOnline) {
        onlineCount++;
      } else {
        offlineCount++;
      }
      const state = await storage.getMachineState(m.id);
      if (state && isOnline) {
        activeStates++;
        totalCpu += state.cpuPercent || 0;
        totalGpu += state.gpuPercent || 0;
        totalHashrate += state.hashrate || 0;
        if ((state.cpuTempC || 0) > maxTemp) maxTemp = state.cpuTempC;
      }
    }
    return reply.send({
      success: true,
      data: {
        total_machines: machines.length,
        online_machines: onlineCount,
        offline_machines: offlineCount,
        avg_cpu: activeStates > 0 ? Math.round(totalCpu / activeStates * 10) / 10 : 0,
        avg_gpu: activeStates > 0 ? Math.round(totalGpu / activeStates * 10) / 10 : 0,
        avg_hashrate: activeStates > 0 ? Math.round(totalHashrate / activeStates * 10) / 10 : 0,
        total_hashrate: Math.round(totalHashrate * 10) / 10,
        max_temp: maxTemp
      }
    });
  });
  app.get(
    "/machines/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params;
      const period = request.query.period || "hour";
      let durationMinutes;
      switch (period) {
        case "day":
          durationMinutes = 1440;
          break;
        case "week":
          durationMinutes = 10080;
          break;
        case "month":
          durationMinutes = 14400;
          break;
        // 10 days
        default:
          durationMinutes = 60;
          break;
      }
      const storage = getStorage();
      const points = await storage.getTelemetryHistory(id, durationMinutes);
      const formatted = points.map((p) => ({
        time: new Date(p.t).toISOString(),
        cpu: p.c,
        ram: p.r,
        gpu: p.g,
        hashrate: p.h,
        temp: p.temp
      }));
      return reply.send({ success: true, data: { period, points: formatted } });
    }
  );
}

// src/routes/logs.ts
async function logRoutes(app) {
  app.get(
    "/audit",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const limit = parseInt(request.query?.limit || "100", 10);
      const userId = request.query?.userId;
      const storage = getStorage();
      const logs = await storage.listAuditLogs(limit, userId);
      return reply.send({ success: true, data: { logs } });
    }
  );
  app.get("/notifications", { preHandler: [requireAuth] }, async (request, reply) => {
    return reply.send({ success: true, data: { notifications: [] } });
  });
}

// src/routes/settings.ts
async function settingsRoutes(app) {
  app.get("/", { preHandler: [requireAuth] }, async (request, reply) => {
    const storage = getStorage();
    const settings = await storage.getSettings();
    return reply.send({ success: true, data: settings });
  });
  app.patch(
    "/",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const storage = getStorage();
      const { electricityPricePerKwh, telemetryRetentionDays, defaultCurrency } = request.body || {};
      await storage.saveSettings({
        electricityPricePerKwh,
        telemetryRetentionDays,
        defaultCurrency
      });
      await auditLog(request, "update_settings", "settings", void 0, request.body);
      return reply.send({ success: true });
    }
  );
}

// src/routes/users.ts
import { randomUUID as randomUUID7 } from "crypto";
async function userRoutes(app) {
  app.get("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const storage = getStorage();
    const users = await storage.listUsers();
    const sanitized = users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      totp_enabled: u.totpEnabled || false,
      created_at: u.createdAt,
      updated_at: u.updatedAt
    }));
    return reply.send({ success: true, data: { users: sanitized } });
  });
  app.post("/", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { email, password, role = "viewer" } = request.body || {};
    const storage = getStorage();
    if (!email || !password) {
      throw new ValidationError("Email and password are required");
    }
    if (!["admin", "viewer"].includes(role)) {
      throw new ValidationError("Role must be admin or viewer");
    }
    if (password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters");
    }
    const existing = await storage.getUserByEmail(email);
    if (existing) {
      throw new ConflictError("A user with this email already exists");
    }
    const passwordHash = await hashPassword(password);
    const id = randomUUID7();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await storage.saveUser({
      id,
      email,
      passwordHash,
      role,
      createdAt: now,
      updatedAt: now
    });
    await auditLog(request, "create_user", "user", id, { email, role });
    return reply.status(201).send({
      success: true,
      data: { id, email, role }
    });
  });
  app.delete("/:id", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const storage = getStorage();
    const deleted = await storage.deleteUser(id);
    if (!deleted) {
      throw new NotFoundError("User");
    }
    await auditLog(request, "delete_user", "user", id);
    return reply.send({ success: true });
  });
}

// src/routes/installer.ts
import { readFileSync, existsSync } from "fs";
import { join } from "path";
var logger9 = createChildLogger("installer-routes");
async function installerRoutes(app) {
  const config = loadConfig();
  const findFile = (relPaths) => {
    for (const rel of relPaths) {
      const p = join(process.cwd(), rel);
      if (existsSync(p)) return p;
    }
    return null;
  };
  app.get("/install.ps1", async (request, reply) => {
    const { token = "", controller = "" } = request.query;
    const effectiveController = controller || config.controllerUrl || `${request.protocol}://${request.hostname}`;
    const scriptPath = findFile(["installer/install.ps1", "../../installer/install.ps1"]);
    let script = "";
    if (scriptPath) {
      script = readFileSync(scriptPath, "utf-8");
    } else {
      script = `# MineFleet Windows Installer fallback
Write-Host "MineFleet Installer";`;
    }
    if (token || effectiveController) {
      let injectedDefaults = "";
      if (token) {
        injectedDefaults += `
if (-not $Token) { $Token = "${token}" }`;
      }
      if (effectiveController) {
        injectedDefaults += `
if (-not $Controller) { $Controller = "${effectiveController}" }`;
      }
      script = script.replace(/param\s*\([\s\S]*?\)/i, (match) => `${match}${injectedDefaults}`);
    }
    return reply.header("Content-Type", "text/plain; charset=utf-8").header("Cache-Control", "no-cache").send(script);
  });
  app.get("/install.sh", async (request, reply) => {
    const { token = "", controller = "" } = request.query;
    const effectiveController = controller || config.controllerUrl || `${request.protocol}://${request.hostname}`;
    const scriptPath = findFile(["installer/install.sh", "../../installer/install.sh"]);
    let script = "";
    if (scriptPath) {
      script = readFileSync(scriptPath, "utf-8");
    } else {
      script = `#!/usr/bin/env bash
echo "MineFleet Installer"`;
    }
    if (token || effectiveController) {
      let injected = "\n# Server-injected parameters\n";
      if (token) injected += `[ -z "$TOKEN" ] && TOKEN="${token}"
`;
      if (effectiveController) injected += `[ -z "$CONTROLLER_URL" ] && CONTROLLER_URL="${effectiveController}"
`;
      script = script.replace("# Parse arguments", `${injected}
# Parse arguments`);
    }
    return reply.header("Content-Type", "text/x-shellscript; charset=utf-8").header("Cache-Control", "no-cache").send(script);
  });
  app.get("/api/agent/bundle", async (request, reply) => {
    const bundlePath = findFile([
      "apps/agent/dist/index.js",
      "../agent/dist/index.js",
      "../../apps/agent/dist/index.js"
    ]);
    if (!bundlePath) {
      return reply.status(404).send({ success: false, error: { code: "NOT_FOUND", message: "Agent bundle not found. Run pnpm build first." } });
    }
    const content = readFileSync(bundlePath, "utf-8");
    return reply.header("Content-Type", "application/javascript; charset=utf-8").header("Content-Disposition", 'attachment; filename="minefleet-agent.js"').send(content);
  });
  app.get("/api/agent/download", async (request, reply) => {
    const { os = "windows", arch = "x86_64" } = request.query;
    const binaryExt = os === "windows" ? ".exe" : "";
    const binPath = findFile([
      `apps/agent/dist/minefleet-agent${binaryExt}`,
      `../agent/dist/minefleet-agent${binaryExt}`,
      `../../apps/agent/dist/minefleet-agent${binaryExt}`
    ]);
    if (binPath) {
      const buffer = readFileSync(binPath);
      return reply.header("Content-Type", "application/octet-stream").header("Content-Disposition", `attachment; filename="minefleet-agent${binaryExt}"`).send(buffer);
    }
    return reply.redirect("/api/agent/bundle");
  });
}

// src/app.ts
async function buildApp(config) {
  const app = Fastify({
    logger: false
    // We use our own pino logger
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      });
    }
    if (error.validation) {
      return reply.status(400).send({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          details: error.validation
        }
      });
    }
    logger.error({ err: error, url: request.url }, "Unhandled error");
    return reply.status(500).send({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal server error occurred"
      }
    });
  });
  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Route ${request.method} ${request.url} not found`
      }
    });
  });
  await app.register(cors, {
    origin: true,
    credentials: true
  });
  await app.register(helmet, {
    contentSecurityPolicy: false
    // Dashboard served separately
  });
  await app.register(cookie, {
    secret: config.jwt.secret
  });
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute"
  });
  app.decorate("config", config);
  app.get("/", async () => {
    return { status: "ok", name: "MineFleet Controller API", version: "0.2.0" };
  });
  const registerDomainRoutes = async (instance) => {
    instance.get("/health", async () => {
      return { status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() };
    });
    await instance.register(authRoutes, { prefix: "/auth" });
    await instance.register(userRoutes, { prefix: "/users" });
    await instance.register(enrollmentRoutes, { prefix: "/enrollment-tokens" });
    await instance.register(machineRoutes, { prefix: "/machines" });
    await instance.register(machineRoutes, { prefix: "/agent" });
    await instance.register(groupRoutes, { prefix: "/groups" });
    await instance.register(scheduleRoutes, { prefix: "/schedules" });
    await instance.register(statsRoutes, { prefix: "/stats" });
    await instance.register(logRoutes, { prefix: "/logs" });
    await instance.register(settingsRoutes, { prefix: "/settings" });
  };
  await app.register(registerDomainRoutes, { prefix: "/api" });
  await app.register(registerDomainRoutes);
  await app.register(installerRoutes);
  return app;
}

// src/index.ts
var appInstance = null;
var initPromise = null;
async function getApp() {
  if (appInstance) return appInstance;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const config = loadConfig();
    const storage = getStorage();
    try {
      await storage.init();
    } catch (err) {
      logger.error({ err }, "Storage init error (continuing with memory fallback)");
    }
    const app = await buildApp(config);
    await app.ready();
    appInstance = app;
    return app;
  })();
  return initPromise;
}
async function handler(req, res) {
  try {
    const app = await getApp();
    const matchedPath = req.headers?.["x-matched-path"] || req.headers?.["x-vercel-matched-path"];
    let targetUrl = req.url || "/";
    if (matchedPath && typeof matchedPath === "string" && matchedPath !== "/api/index" && matchedPath !== "/api") {
      const queryIdx = targetUrl.indexOf("?");
      const query = queryIdx !== -1 ? targetUrl.substring(queryIdx) : "";
      targetUrl = matchedPath + query;
    }
    const method = req.method || "GET";
    const headers = req.headers || {};
    let payload = void 0;
    if (req.body !== void 0 && req.body !== null) {
      payload = typeof req.body === "object" ? JSON.stringify(req.body) : req.body;
      if (typeof req.body === "object" && !headers["content-type"]) {
        headers["content-type"] = "application/json";
      }
    }
    const response = await app.inject({
      method,
      url: targetUrl,
      headers,
      payload
    });
    res.statusCode = response.statusCode;
    for (const [key, value] of Object.entries(response.headers)) {
      if (value !== void 0) {
        res.setHeader(key, value);
      }
    }
    res.end(response.rawPayload);
  } catch (err) {
    logger.error({ err: err?.message || err }, "Serverless handler error");
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        success: false,
        error: { code: "INTERNAL_ERROR", message: err?.message || "Internal server error" }
      }));
    }
  }
}
async function main() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return;
  }
  const config = loadConfig();
  logger.info({ env: config.nodeEnv }, "Starting MineFleet Controller standalone server");
  const app = await getApp();
  const shutdown = async (signal) => {
    logger.info({ signal }, "Shutting down...");
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  try {
    await app.listen({ host: config.host, port: config.port });
    logger.info({ host: config.host, port: config.port }, "MineFleet Controller is running");
  } catch (err) {
    logger.fatal({ err }, "Failed to start server");
    process.exit(1);
  }
}
if (process.argv[1] && (process.argv[1].endsWith("dist/index.js") || process.argv[1].endsWith("src/index.ts"))) {
  main();
}
export {
  handler as default,
  getApp
};
