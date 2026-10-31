const crypto = require("node:crypto");
const { getServiceClient } = require("../config/serviceClient");
const { uuid, RIDE_SELECT } = require("./ridePolicy");
const { rideMember } = require("./rideAccess");
const AppError = require("../utils/AppError");
function key(purpose) {
  const root =
    process.env.TRIP_PIN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!root || root.length < 32)
    throw new AppError(
      "Trip security is not configured. Contact support.",
      503,
    );
  return Buffer.from(
    crypto.hkdfSync("sha256", root, "GoRide trip PIN", purpose, 32),
  );
}
function digest(ride, pin) {
  return crypto
    .createHmac("sha256", key("verify-v1"))
    .update(`${ride.toLowerCase()}:${pin}`)
    .digest("hex");
}
function seal(pin, aad) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key("seal-v1"), iv);
  cipher.setAAD(Buffer.from(aad));
  const value = Buffer.concat([cipher.update(pin, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    value.toString("base64url"),
  ].join(".");
}
function open(value, aad) {
  try {
    const [v, iv, tag, body] = value.split(".");
    if (v !== "v1") throw Error();
    const d = crypto.createDecipheriv(
      "aes-256-gcm",
      key("seal-v1"),
      Buffer.from(iv, "base64url"),
    );
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      d.update(Buffer.from(body, "base64url")),
      d.final(),
    ]).toString("utf8");
  } catch (_) {
    throw new AppError(
      "PIN cannot be recovered after a security-key change. Request a new PIN.",
      409,
    );
  }
}
const messages = {
  ACCESS_DENIED:
    "Only the trip passenger/assigned captain can use this action.",
  TRIP_NOT_READY:
    "PIN is available after confirmation; start is allowed only after captain arrival.",
  PIN_REQUIRED: "Ask the passenger to open their trip PIN.",
  PIN_INVALID:
    "Incorrect trip PIN. Ask the passenger to check the current code.",
  PIN_LOCKED: "Five incorrect attempts. Passenger must request a new PIN.",
  PIN_EXPIRED: "PIN expired. Passenger must request a new PIN.",
  PIN_COOLDOWN: "Wait 60 seconds before requesting another PIN.",
  PIN_GENERATION_LIMIT:
    "PIN replacement limit reached. Cancel and rebook, or contact support.",
};
function check(result, error) {
  if (error)
    throw new AppError(
      "Trip PIN service unavailable. Check the database migration and server configuration.",
      503,
    );
  if (result?.code) {
    const e = new AppError(
      (messages[result.code] || "Trip verification failed.") +
        (result.code === "PIN_INVALID"
          ? ` ${result.attemptsRemaining} attempts remaining.`
          : ""),
      result.code === "ACCESS_DENIED" ? 403 : 409,
    );
    e.code = result.code;
    throw e;
  }
  if (!result) throw new AppError("Trip verification returned no result.", 503);
}
async function issue(rideId, actor, rotate = false) {
  const id = uuid(rideId).toLowerCase();
  const ride = await rideMember(id, actor);
  if (ride.user_id !== actor)
    throw new AppError("Only the passenger can view the trip PIN.", 403);
  const pin = crypto.randomInt(0, 10000).toString().padStart(4, "0");
  const { data, error } = await getServiceClient().rpc("issue_trip_pin", {
    p_ride: id,
    p_actor: actor,
    p_digest: digest(id, pin),
    p_sealed: seal(pin, `${id}:${actor}:${ride.driver_id}`),
    p_rotate: rotate,
  });
  check(data, error);
  return {
    pin: open(data.sealed, `${id}:${actor}:${data.driverId}`),
    expiresAt: data.expiresAt,
    attemptsRemaining: data.attemptsRemaining,
  };
}
async function start(rideId, actor, pin) {
  const id = uuid(rideId).toLowerCase();
  if (typeof pin !== "string" || !/^\d{4}$/.test(pin))
    throw new AppError(
      "Enter the four-digit PIN shown on the passenger’s trip screen.",
      400,
    );
  const { data: captain, error: captainError } = await getServiceClient()
    .from("drivers")
    .select("*")
    .eq("user_id", actor)
    .maybeSingle();
  if (captainError)
    throw new AppError("Could not verify captain eligibility.", 503);
  if (!require("./onboardingValidation").canOperate(captain))
    throw new AppError(
      "Captain approval and valid documents are required to start a trip.",
      403,
    );
  const { data, error } = await getServiceClient().rpc("start_trip_with_pin", {
    p_ride: id,
    p_actor: actor,
    p_digest: digest(id, pin),
  });
  check(data, error);
  const { data: ride, error: readError } = await getServiceClient()
    .from("rides")
    .select(RIDE_SELECT)
    .eq("id", id)
    .single();
  if (readError)
    throw new AppError(
      "Start saved. Reload the active trip to refresh its status.",
      503,
    );
  return ride;
}
module.exports = { issue, start, digest, seal, open };
