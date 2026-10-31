const crypto = require("node:crypto");
const { getServiceClient } = require("../config/serviceClient");
const { rideMember } = require("../services/rideAccess");
const { uuid, RIDE_SELECT } = require("../services/ridePolicy");
const AppError = require("../utils/AppError");
const wrap = require("../utils/catchAsync");
const active = ["driver_assigned", "accepted", "driver_arrived", "started"];
function text(v, min, max) {
  return typeof v === "string" && v.trim().length >= min && v.length <= max;
}
exports.quote = wrap(async (req, res) =>
  res.json({
    data: await require("../services/quoteService").quote(
      req.user.id,
      req.body,
    ),
  }),
);
exports.receipt = wrap(async (req, res) => {
  const r = await rideMember(req.params.rideId, req.user.id);
  if (r.status !== "completed")
    throw new AppError("Receipt is available after trip completion.", 409);
  let pricing = null;
  if (r.quote_id) {
    const { data } = await getServiceClient()
      .from("fare_quotes")
      .select("payload")
      .eq("id", r.quote_id)
      .maybeSingle();
    if (data)
      pricing = {
        baseFare: data.payload.baseFare,
        distanceFare: data.payload.distanceFare,
        distanceMeters: data.payload.distanceMeters,
        routeSource: data.payload.routeSource,
      };
  }
  res
    .set("Cache-Control", "no-store")
    .json({
      data: {
        rideId: r.id,
        category: r.category,
        pickup: r.pickup_location,
        drop: r.drop_location,
        fare: r.fare,
        currency: "INR",
        paymentMethod: r.payment_method,
        paymentStatus: r.payment_status,
        completedAt: r.completed_at,
        pricing,
        notice:
          "Trip receipt, not a GST tax invoice. Cash collection is captain-confirmed, not bank-verified.",
      },
    });
});
exports.offers = wrap(async (req, res) => {
  const db = getServiceClient();
  const { data: driver, error } = await db
    .from("drivers")
    .select("*")
    .eq("user_id", req.user.id)
    .maybeSingle();
  if (error) throw new AppError("Could not read captain status.", 503);
  if (
    !require("../services/onboardingValidation").canOperate(driver) ||
    !driver.is_online
  )
    return res.json({ data: [] });
  const { data, error: e } = await db
    .from("ride_dispatch_offers")
    .select("expires_at,ride:rides(*)")
    .eq("driver_id", driver.id)
    .gt("expires_at", new Date().toISOString())
    .order("created_at")
    .limit(10);
  if (e) throw new AppError("Could not read pending offers.", 503);
  res.json({
    data: (data || [])
      .filter(
        (o) =>
          o.ride?.status === "pending" &&
          new Date(o.ride.matching_expires_at) > new Date(),
      )
      .map((o) =>
        require("../services/dispatchService").offerPayload(
          o.ride,
          null,
          o.expires_at,
        ),
      ),
  });
});
exports.cashSummary = wrap(async (req, res) => {
  const { data, error } = await getServiceClient()
    .from("captain_cash_ledger")
    .select("ride_id,cash_received,commission_due,captain_net,created_at")
    .eq("captain_user_id", req.user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new AppError("Cash ledger is not ready.", 503);
  res.json({
    data,
    currency: "INR",
    notice:
      "Cash is already held by you. Commission shown is owed to GoRide; no bank transfer or wallet credit occurred. Latest 100 cash trips.",
  });
});
exports.tickets = wrap(async (req, res) => {
  const { data, error } = await getServiceClient()
    .from("support_tickets")
    .select("id,ride_id,category,message,status,reply,created_at,updated_at")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new AppError("Support queue unavailable.", 503);
  res.json({ data });
});
exports.createTicket = wrap(async (req, res) => {
  const b = req.body || {};
  if (
    !["trip", "payment", "refund_request", "safety", "account"].includes(
      b.category,
    ) ||
    !text(b.message, 12, 2000)
  )
    throw new AppError(
      "Choose a category and describe the issue in 12–2000 characters.",
      400,
    );
  if (b.rideId) await rideMember(uuid(b.rideId), req.user.id);
  const { data, error } = await getServiceClient()
    .from("support_tickets")
    .insert({
      user_id: req.user.id,
      ride_id: b.rideId || null,
      category: b.category,
      message: b.message.trim(),
    })
    .select("id,status")
    .single();
  if (error) throw new AppError("Could not submit ticket. Please retry.", 503);
  res
    .status(201)
    .json({
      data,
      message:
        "Request recorded. Refund requests are not automatic refunds. For an emergency call 112; do not wait for a ticket reply.",
    });
});
exports.alert = wrap(async (req, res) => {
  const r = await rideMember(req.params.rideId, req.user.id);
  if (!active.includes(r.status))
    throw new AppError(
      "Safety alert requires an active assigned trip. For emergencies call 112.",
      409,
    );
  const db = getServiceClient();
  const { data: existing, error: e } = await db
    .from("safety_alerts")
    .select("id")
    .eq("ride_id", r.id)
    .eq("user_id", req.user.id)
    .eq("status", "open")
    .limit(1);
  if (e)
    throw new AppError("Could not record alert. Call 112 if in danger.", 503);
  if (existing?.length)
    return res.json({
      data: existing[0],
      message:
        "Existing alert remains open. Call 112 if you need immediate assistance.",
    });
  const { data, error } = await db
    .from("safety_alerts")
    .insert({ ride_id: r.id, user_id: req.user.id })
    .select("id,status")
    .single();
  if (error)
    throw new AppError("Could not record alert. Call 112 if in danger.", 503);
  res
    .status(201)
    .json({
      data,
      message:
        "Alert recorded for GoRide operations. This queue is not a guaranteed monitored emergency service and does not contact police. Call 112 now if in danger.",
    });
});
exports.share = wrap(async (req, res) => {
  const r = await rideMember(req.params.rideId, req.user.id);
  if (!active.includes(r.status))
    throw new AppError("Only active assigned trips can be shared.", 409);
  const token = crypto.randomBytes(32).toString("base64url"),
    hash = crypto.createHash("sha256").update(token).digest("hex");
  const { data, error } = await getServiceClient()
    .from("trip_share_links")
    .upsert(
      {
        token_hash: hash,
        ride_id: r.id,
        user_id: req.user.id,
        expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
      },
      { onConflict: "ride_id,user_id" },
    )
    .select("expires_at")
    .single();
  if (error) throw new AppError("Could not create private share link.", 503);
  res
    .set("Cache-Control", "no-store")
    .json({
      data: {
        url: `${(process.env.PUBLIC_APP_ORIGIN || "https://goride-phjs.onrender.com").replace(/\/$/, "")}/s/${token}`,
        expiresAt: data.expires_at,
      },
      message:
        "Anyone with this private link can see trip locations for 30 minutes or until the trip ends. Creating a new link revokes the old one.",
    });
});
exports.revoke = wrap(async (req, res) => {
  await rideMember(req.params.rideId, req.user.id);
  const { error } = await getServiceClient()
    .from("trip_share_links")
    .delete()
    .eq("ride_id", req.params.rideId)
    .eq("user_id", req.user.id);
  if (error) throw new AppError("Could not revoke link.", 503);
  res.json({ message: "Your share link is revoked." });
});
exports.publicShare = wrap(async (req, res) => {
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
  });
  const token = req.params.token;
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new AppError("Link unavailable or expired.", 404);
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const { data: link, error } = await getServiceClient()
    .from("trip_share_links")
    .select("ride_id,expires_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error) throw new AppError("Share service unavailable.", 503);
  if (!link || new Date(link.expires_at) <= new Date())
    throw new AppError("Link unavailable or expired.", 404);
  const { data: r, error: e } = await getServiceClient()
    .from("rides")
    .select(RIDE_SELECT)
    .eq("id", link.ride_id)
    .maybeSingle();
  if (e) throw new AppError("Share service unavailable.", 503);
  if (!r || !active.includes(r.status))
    throw new AppError("Trip ended or link expired.", 404);
  res.json({
    data: {
      category: r.category,
      status: r.status,
      pickup: r.pickup_location,
      drop: r.drop_location,
      vehicle: r.driver?.vehicle_model || null,
      expiresAt: link.expires_at,
    },
    notice:
      "Trip status, not a staffed emergency tracker. For an emergency in India dial 112.",
  });
});
exports.adminQueue = wrap(async (_req, res) => {
  const db = getServiceClient();
  const results = await Promise.all([
    db
      .from("support_tickets")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("safety_alerts")
      .select("*")
      .in("status", ["open", "acknowledged"])
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("captain_cash_ledger")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  if (results.some((r) => r.error))
    throw new AppError("Operations support/cash migration not ready.", 503);
  res.json({
    tickets: results[0].data,
    alerts: results[1].data,
    cash: results[2].data,
  });
});
exports.reply = wrap(async (req, res) => {
  const { status, reply } = req.body || {};
  if (
    !["open", "in_progress", "resolved"].includes(status) ||
    !text(reply, 5, 2000)
  )
    throw new AppError(
      "Choose status and write a 5–2000 character reply.",
      400,
    );
  const { data, error } = await getServiceClient()
    .from("support_tickets")
    .update({
      status,
      reply: reply.trim(),
      responded_by: req.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", uuid(req.params.id, "ticket ID"))
    .select("id,status")
    .maybeSingle();
  if (error) throw new AppError("Could not update ticket.", 503);
  if (!data) throw new AppError("Ticket not found.", 404);
  res.json({ data });
});
exports.handleAlert = wrap(async (req, res) => {
  if (!["acknowledged", "closed"].includes(req.body?.status))
    throw new AppError("Invalid alert status.", 400);
  const { data, error } = await getServiceClient()
    .from("safety_alerts")
    .update({ status: req.body.status, handled_by: req.user.id })
    .eq("id", uuid(req.params.id, "alert ID"))
    .select("id,status")
    .maybeSingle();
  if (error) throw new AppError("Could not update alert.", 503);
  if (!data) throw new AppError("Alert not found.", 404);
  res.json({ data });
});
