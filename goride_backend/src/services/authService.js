const { createAuthClient, getScopedClient } = require("../config/supabase");
const { getServiceClient } = require("../config/serviceClient");
const AppError = require("../utils/AppError");
const crypto = require("node:crypto");
function input(email, password) {
  if (
    typeof email !== "string" ||
    email.length > 254 ||
    !/^\S+@\S+\.\S+$/.test(email.trim()) ||
    typeof password !== "string" ||
    !password.length ||
    password.length > 256
  )
    throw new AppError("Enter a valid email and password.", 400);
  return { email: email.trim().toLowerCase(), password };
}
async function actorClient(token, id) {
  const client = await getScopedClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user || (id && data.user.id !== id))
    throw new AppError("Session expired. Sign in again.", 401);
  return { client, user: data.user };
}
async function enrich(user, client) {
  const { data } = await client
    .from("profiles")
    .select("full_name,profile_pic")
    .eq("id", user.id)
    .maybeSingle();
  return {
    ...user,
    user_metadata: {
      ...user.user_metadata,
      ...(data?.full_name ? { full_name: data.full_name } : {}),
      ...(data?.profile_pic ? { profile_pic: data.profile_pic } : {}),
    },
  };
}
class AuthService {
  async signup(email, password, fullName, userType = "rider") {
    const credentials = input(email, password);
    if (
      !["rider", "driver"].includes(userType) ||
      typeof fullName !== "string" ||
      !fullName.trim() ||
      fullName.length > 100
    )
      throw new AppError("Enter your name and select Rider or Captain.", 400);
    const { data, error } = await createAuthClient().auth.signUp({
      ...credentials,
      options: {
        emailRedirectTo: "https://goride-phjs.onrender.com/",
        data: { full_name: fullName.trim(), user_type: userType },
      },
    });
    if (error) throw new AppError(error.message, 400);
    return data;
  }
  async login(email, password, requiredUserType) {
    if (!["rider", "driver"].includes(requiredUserType))
      throw new AppError("Select the correct GoRide app.", 400);
    const client = createAuthClient();
    const { data, error } = await client.auth.signInWithPassword(
      input(email, password),
    );
    if (error || !data?.session || !data.user?.email_confirmed_at)
      throw new AppError(
        "Email/password incorrect or email not verified.",
        401,
      );
    const userType = data.user.user_metadata?.user_type;
    if (
      (requiredUserType === "driver" && userType !== "driver") ||
      (requiredUserType === "rider" && userType === "driver")
    ) {
      await client.auth.signOut({ scope: "local" });
      throw new AppError("Use the GoRide app matching your account type.", 403);
    }
    const { data: factors, error: factorError } =
      await client.auth.mfa.listFactors();
    if (factorError)
      throw new AppError("Could not check account security. Try again.", 503);
    const factor = factors?.all?.find((f) => f.status === "verified");
    const user = await enrich(data.user, client);
    return {
      mfaRequired: !!factor,
      ...(factor ? { factorId: factor.id } : {}),
      user,
      session: data.session,
    };
  }
  async enrollMfa(token) {
    const { client } = await actorClient(token);
    const { data: factors, error: readError } =
      await client.auth.mfa.listFactors();
    if (readError) throw new AppError("Could not check security factors.", 503);
    for (const f of factors?.all || [])
      if (f.status === "unverified") {
        const { error } = await client.auth.mfa.unenroll({ factorId: f.id });
        if (error) throw new AppError("Could not reset incomplete setup.", 400);
      }
    const { data, error } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "GoRide Authenticator",
    });
    if (error) throw new AppError("Could not enroll authenticator.", 400);
    return data;
  }
  async challengeMfa(token, factorId) {
    const { client } = await actorClient(token);
    const { data, error } = await client.auth.mfa.challenge({ factorId });
    if (error) throw new AppError("Could not create security challenge.", 400);
    return data;
  }
  async verifyMfa(token, factorId, challengeId, code) {
    if (typeof code !== "string" || !/^\d{6}$/.test(code))
      throw new AppError("Enter the six-digit authenticator code.", 400);
    const { client, user } = await actorClient(token);
    const { data, error } = await client.auth.mfa.verify({
      factorId,
      challengeId,
      code,
    });
    if (error)
      throw new AppError("Authenticator code is invalid or expired.", 400);
    return { ...data, user: await enrich(user, client) };
  }
  async listMfaFactors(token) {
    const { client } = await actorClient(token);
    const { data, error } = await client.auth.mfa.listFactors();
    if (error) throw new AppError("Could not load security factors.", 400);
    return data;
  }
  async unenrollMfa(token, factorId) {
    const { client } = await actorClient(token);
    const { data, error } = await client.auth.mfa.unenroll({ factorId });
    if (error)
      throw new AppError(
        "Could not remove authenticator. Verify your security session first.",
        400,
      );
    return data;
  }
  async updateFcmToken(token, userId, fcmToken) {
    if (
      typeof fcmToken !== "string" ||
      !fcmToken.trim() ||
      fcmToken.length > 4096
    )
      throw new AppError("Invalid device notification token.", 400);
    const { client } = await actorClient(token, userId);
    const { error } = await client
      .from("profiles")
      .update({ fcm_token: fcmToken })
      .eq("id", userId);
    if (error) throw new AppError("Could not register this device.", 503);
    return { updated: true };
  }
  async updateProfile(token, userId, fullName, profilePicBase64) {
    const { client, user } = await actorClient(token, userId);
    const fields = {};
    if (fullName !== undefined) {
      if (
        typeof fullName !== "string" ||
        !fullName.trim() ||
        fullName.length > 100
      )
        throw new AppError("Enter a name of 1–100 characters.", 400);
      fields.full_name = fullName.trim();
    }
    if (profilePicBase64) {
      if (
        typeof profilePicBase64 !== "string" ||
        profilePicBase64.length > 2800000
      )
        throw new AppError("Profile image must be at most 2 MB.", 413);
      const buffer = Buffer.from(
        profilePicBase64.replace(/^data:image\/[\w+.-]+;base64,/, ""),
        "base64",
      );
      const jpg = buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
        png = buffer
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      if (!buffer.length || buffer.length > 2097152 || (!jpg && !png))
        throw new AppError(
          "Choose a JPEG or PNG profile photo, at most 2 MB.",
          400,
        );
      const path = `${userId}/${crypto.randomUUID()}.${jpg ? "jpg" : "png"}`;
      const { error } = await client.storage
        .from("profile-photos")
        .upload(path, buffer, {
          contentType: jpg ? "image/jpeg" : "image/png",
          upsert: false,
        });
      if (error)
        throw new AppError(
          "Could not upload profile photo. Check the profile-storage migration.",
          503,
        );
      fields.profile_pic = client.storage
        .from("profile-photos")
        .getPublicUrl(path).data.publicUrl;
    }
    if (Object.keys(fields).length) {
      const { error } = await client
        .from("profiles")
        .update(fields)
        .eq("id", userId);
      if (error) throw new AppError("Could not save profile changes.", 503);
    }
    return enrich(user, client);
  }
  async logout(token, userId) {
    const { client } = await actorClient(token, userId);
    const { error } = await client
      .from("profiles")
      .update({ fcm_token: null })
      .eq("id", userId);
    if (error)
      throw new AppError("Could not unregister device notifications.", 503);
    const { error: logoutError } = await getServiceClient().auth.admin.signOut(
      token,
      "local",
    );
    if (logoutError)
      throw new AppError(
        "Could not revoke the refresh session. Clear local login and try again.",
        503,
      );
    return {
      message:
        "Logged out. Existing access tokens expire at their configured expiry.",
    };
  }
}
module.exports = new AuthService();
