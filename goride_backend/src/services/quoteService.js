const { getDistance } = require("geolib");
const { coordinates } = require("./ridePolicy");
const { getServiceClient } = require("../config/serviceClient");
const AppError = require("../utils/AppError");
const prices = {
  Bike: { base: 20, km: 10 },
  Auto: { base: 35, km: 15 },
  Car: { base: 50, km: 25 },
};
async function quote(actor, input, fetcher = fetch) {
  const {
    pickupLatitude: lat,
    pickupLongitude: lng,
    dropLatitude: dlat,
    dropLongitude: dlng,
  } = input || {};
  if (
    !coordinates(lat, lng) ||
    !coordinates(dlat, dlng) ||
    ![input.pickupLocation, input.dropLocation].every(
      (s) => typeof s === "string" && s.trim().length >= 2 && s.length <= 500,
    )
  )
    throw new AppError("Select valid pickup and destination addresses.", 400);
  if (
    ![lat, dlat].every((v) => v >= 27.8 && v <= 29.5) ||
    ![lng, dlng].every((v) => v >= 76.5 && v <= 78.1)
  )
    throw new AppError(
      "Pickup and destination must be inside the current Delhi/NCR operating area.",
      400,
    );
  const direct = getDistance(
    { latitude: lat, longitude: lng },
    { latitude: dlat, longitude: dlng },
  );
  if (direct < 100 || direct > 150000)
    throw new AppError(
      "Choose a local trip between 100 metres and 150 kilometres.",
      400,
    );
  let distance = direct,
    source = "straight_line_estimate",
    durationSeconds = null;
  if (process.env.ROUTING_BASE_URL) {
    const origin = new URL(process.env.ROUTING_BASE_URL);
    if (origin.protocol !== "https:" || origin.username || origin.password)
      throw new AppError("Routing configuration is invalid.", 503);
    const url = new URL(
      `${origin.pathname.replace(/\/$/, "")}/route/v1/driving/${lng},${lat};${dlng},${dlat}`,
      origin,
    );
    url.searchParams.set("overview", "false");
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (!response.ok) throw Error();
      const body = await response.text();
      if (body.length > 256000) throw Error();
      const route = JSON.parse(body).routes?.[0];
      if (
        !route ||
        !Number.isFinite(route.distance) ||
        route.distance < direct * 0.8 ||
        route.distance > direct * 6 ||
        !Number.isFinite(route.duration) ||
        route.duration <= 0
      )
        throw Error();
      distance = Math.round(route.distance);
      durationSeconds = Math.round(route.duration);
      source = "road_route";
    } catch (_) {
      throw new AppError(
        "Road routing is temporarily unavailable. Retry instead of accepting an invented ETA.",
        503,
      );
    }
  }
  const categories = input.category
    ? [input.category === "Ride" ? "Car" : input.category]
    : Object.keys(prices);
  if (categories.some((c) => !prices[c]))
    throw new AppError("Choose Bike, Auto or Car.", 400);
  const payloads = categories.map((category) => {
    const p = prices[category],
      distanceFare = Math.round((distance / 1000) * p.km);
    return {
      pickupLocation: input.pickupLocation.trim(),
      dropLocation: input.dropLocation.trim(),
      pickupLatitude: lat,
      pickupLongitude: lng,
      dropLatitude: dlat,
      dropLongitude: dlng,
      category,
      fare: p.base + distanceFare,
      baseFare: p.base,
      distanceFare,
      distanceMeters: distance,
      durationSeconds,
      routeSource: source,
      pricingVersion: "delhi-v1",
      currency: "INR",
    };
  });
  const { data, error } = await getServiceClient()
    .from("fare_quotes")
    .insert(payloads.map((payload) => ({ user_id: actor, payload })))
    .select("id,payload,expires_at");
  if (error)
    throw new AppError(
      "Could not save fare quotes. Check the booking migration.",
      503,
    );
  return data.map((q) => ({
    quoteId: q.id,
    ...q.payload,
    expiresAt: q.expires_at,
  }));
}
module.exports = { quote, prices };
