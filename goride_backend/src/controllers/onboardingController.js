const crypto = require('node:crypto');
const { getServiceClient } = require('../config/serviceClient');
const { requirements, validateApplication } = require('../services/onboardingValidation');
const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync');
exports.requirements = (_req, res) => res.json({ data: requirements });
exports.getDraft = catchAsync(async (req, res) => {
  const { data, error } = await req.supabase.from('driver_application_drafts').select('payload').eq('user_id', req.user.id).maybeSingle();
  if (error) throw new AppError('Could not load onboarding draft.', 503);
  res.json({ data: data?.payload || {} });
});
exports.saveDraft = catchAsync(async (req, res) => {
  // Store only applicant-entered fields, never client-supplied approval/admin flags.
  const fields = ['fullName','dateOfBirth','vehicleModel','vehicleType','city','postalCode','registrationNumber','documents','consent'];
  const payload = Object.fromEntries(fields.filter(k => req.body[k] !== undefined).map(k => [k, req.body[k]]));
  if (JSON.stringify(payload).length > 20000) throw new AppError('Draft too large.', 400);
  const { error } = await req.supabase.from('driver_application_drafts').upsert({ user_id: req.user.id, payload, updated_at: new Date().toISOString() });
  if (error) throw new AppError('Could not save draft.', 503);
  res.json({ saved: true });
});
exports.upload = catchAsync(async (req, res) => {
  const type = req.body.docType;
  if (typeof type !== 'string' || !Object.hasOwn(requirements.documents,type) || !req.file) throw new AppError('Select a supported document.', 400);
  const bytes = req.file.buffer;
  let mime, ext;
  if (bytes.subarray(0,3).equals(Buffer.from([255,216,255]))) { mime = 'image/jpeg'; ext = 'jpg'; }
  else if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) { mime = 'image/png'; ext = 'png'; }
  else if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') { mime = 'image/webp'; ext = 'webp'; }
  else throw new AppError('Upload a JPEG, PNG or WebP image, maximum 5 MB.', 400);
  const path = `${req.user.id}/${type}/${crypto.randomUUID()}.${ext}`;
  const { error } = await req.supabase.storage.from('captain-documents').upload(path, bytes, { contentType: mime, upsert: false });
  if (error) throw new AppError('Document upload failed. Please try again.', 503);
  res.json({ data: { path } });
});
exports.submit = catchAsync(async (req, res) => {
  if (req.user.user_metadata?.user_type !== 'driver') throw new AppError('Captain account required.', 403);
  const docs = validateApplication(req.user.id, req.body);
  // Validate storage ownership AND existence; knowing another applicant's URL is not proof.
  for (const [key, doc] of Object.entries(docs)) {
    const folder = `${req.user.id}/${key}`; const name = doc.path.slice(folder.length + 1);
    const { data, error } = await req.supabase.storage.from('captain-documents').list(folder, { search: name, limit: 10 });
    if (error || !data?.some(f => f.name === name)) throw new AppError(`Upload ${key} again; file not found.`, 400);
  }
  const db = getServiceClient();
  const { data, error } = await db.rpc('submit_captain_application', {
    p_user_id: req.user.id,
    p_application: { full_name: req.body.fullName.trim(), date_of_birth: req.body.dateOfBirth,
      vehicle_model: req.body.vehicleModel.trim(), vehicle_type: req.body.vehicleType,
      city: req.body.city.trim(), postal_code: req.body.postalCode,
      registration_number: req.body.registrationNumber.trim().toUpperCase(), documents: docs },
  });
  if (error) throw new AppError('Application could not be submitted. Pending/approved applications cannot be replaced.', 409);
  await db.from('driver_application_drafts').delete().eq('user_id', req.user.id);
  res.json({ data });
});
