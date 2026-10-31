const { getServiceClient } = require("../config/serviceClient");
const { reconcileRoom } = require("./rideAccess");
const AppError = require("../utils/AppError");
async function expire(actor = null) {
  const { data, error } = await getServiceClient().rpc("expire_ride_searches", {
    p_actor: actor,
  });
  if (error) throw new AppError("Could not refresh matching state.", 503);
  for (const r of data || []) {
    const { data: ride } = await getServiceClient()
      .from("rides")
      .select(require("./ridePolicy").RIDE_SELECT)
      .eq("id", r.id)
      .single();
    if (ride) await reconcileRoom(global.io, ride);
    if (global.io) {
      if (r.status === "cancelled")
        global.io
          .to(r.id)
          .emit("ride_cancelled", {
            rideId: r.id,
            message:
              "No captain confirmed within the matching window. No fare was deducted.",
          });
      else
        global.io
          .to(r.id)
          .emit("matching_resumed", {
            rideId: r.id,
            message:
              "Captain confirmation expired. Looking for another captain.",
          });
      if (r.previousDriverId) {
        const { data: d } = await getServiceClient()
          .from("drivers")
          .select("user_id")
          .eq("id", r.previousDriverId)
          .maybeSingle();
        if (d)
          global.io
            .to(`driver_${d.user_id}`)
            .emit("ride_cancelled", {
              rideId: r.id,
              message: "This captain offer expired.",
            });
      }
    }
  }
  return data;
}
async function dispatch(ride) {
  if (ride.status !== "pending") return [];
  const service = require("./rideService");
  const eligible = await service.getNearbyDrivers(
    ride.pickup_latitude,
    ride.pickup_longitude,
    ride.category,
  );
  if (!eligible.length) return [];
  const { data, error } = await getServiceClient().rpc("claim_ride_offers", {
    p_ride: ride.id,
    p_drivers: eligible.map((d) => d.id),
  });
  if (error) throw new AppError("Could not claim dispatch offers.", 503);
  const { data: profile } = await getServiceClient()
    .from("profiles")
    .select("full_name,profile_pic")
    .eq("id", ride.user_id)
    .maybeSingle();
  const recipients = [];
  for (const offer of data || []) {
    recipients.push(offer.userId);
    global.io
      ?.to(`driver_${offer.userId}`)
      .emit("ride_request", offerPayload(ride, profile, offer.expiresAt));
  }
  if (recipients.length)
    require("./notificationService").sendToMultipleUsers(
      recipients,
      {
        title: "New trip offer",
        body: `${ride.category} · INR ${ride.fare} · ${ride.payment_method}`,
      },
      { rideId: ride.id, type: "ride_request" },
    );
  return eligible;
}
function offerPayload(r, p, expiresAt) {
  return {
    rideId: r.id,
    pickup: r.pickup_location,
    drop: r.drop_location,
    fare: r.fare,
    pickupLat: r.pickup_latitude,
    pickupLng: r.pickup_longitude,
    dropLat: r.drop_latitude,
    dropLng: r.drop_longitude,
    passengerName: p?.full_name || "Passenger",
    passengerProfilePic: p?.profile_pic || null,
    payment_method: r.payment_method,
    expiresAt,
  };
}
let running = false;
async function tick() {
  if (running || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  running = true;
  try {
    await expire();
    const { data, error } = await getServiceClient()
      .from("rides")
      .select("*")
      .eq("status", "pending")
      .not("quote_id", "is", null)
      .gt("matching_expires_at", new Date().toISOString())
      .order("created_at")
      .limit(30);
    if (error) throw error;
    for (const r of data || []) await dispatch(r);
  } catch (_) {
    console.error(
      "Dispatch refresh failed; persisted matching deadlines remain authoritative.",
    );
  } finally {
    running = false;
  }
}
function start() {
  const timer = setInterval(tick, 10000);
  timer.unref();
  return timer;
}
module.exports = { expire, dispatch, start, tick, offerPayload };
