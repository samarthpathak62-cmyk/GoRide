const requirements = require('../config/driverRequirements.json');
const AppError = require('../utils/AppError');
function vehicleSpec(type) {
  const spec = requirements.vehicles.find(v => v.id === type);
  if (!spec) throw new AppError('Select Bike, Auto or Car.', 400);
  return spec;
}
function ownedPath(path, userId, key) {
  return typeof path === 'string' && path.length <= 256 && path.startsWith(`${userId}/${key}/`) &&
    !path.includes('..') && !path.includes('://') && /^[a-zA-Z0-9_./-]+$/.test(path);
}
function validateApplication(userId, input, now = new Date()) {
  const spec = vehicleSpec(input.vehicleType);
  for (const key of ['fullName','vehicleModel','city','registrationNumber']) {
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 120) throw new AppError(`${key} is required (maximum 120 characters).`, 400);
  }
  if (!['delhi','new delhi','noida','greater noida','gurugram','gurgaon','ghaziabad','faridabad'].includes(input.city.trim().toLowerCase())) throw new AppError('This release supports Delhi/NCR onboarding only.',400);
  if (!/^[A-Z0-9 -]{6,20}$/i.test(input.registrationNumber.trim())) throw new AppError('Enter a valid vehicle registration number.',400);
  if (!/^\d{6}$/.test(input.postalCode || '')) throw new AppError('Enter a six-digit PIN code.', 400);
  const dob = new Date(input.dateOfBirth);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth || '') || !Number.isFinite(dob.getTime()) || dob.toISOString().slice(0,10) !== input.dateOfBirth) throw new AppError('Use a valid date of birth.', 400);
  const adultDate = new Date(now); adultDate.setUTCFullYear(adultDate.getUTCFullYear() - 18);
  if (dob > adultDate || dob.getUTCFullYear() < 1900) throw new AppError('Captain must be at least 18 years old.', 400);
  if (input.consent !== true) throw new AppError('Consent to verification is required.', 400);
  const docs = {};
  for (const key of spec.documents) {
    const doc = input.documents?.[key];
    if (!ownedPath(doc?.path, userId, key)) throw new AppError(`Upload your own ${requirements.documents[key].label}.`, 400);
    if (requirements.documents[key].expires) {
      const expiry = new Date(doc.expiresOn);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.expiresOn || '') || !Number.isFinite(expiry.getTime()) || expiry.toISOString().slice(0,10) !== doc.expiresOn || doc.expiresOn <= now.toISOString().slice(0,10)) {
        throw new AppError(`Enter a future expiry date for ${requirements.documents[key].label}.`, 400);
      }
    }
    docs[key] = { path: doc.path, ...(requirements.documents[key].expires ? { expiresOn: doc.expiresOn } : {}) };
  }
  return docs;
}
function canOperate(driver, now = new Date()) {
  if (!driver || driver.status !== 'approved' || driver.operationally_enabled !== true) return false;
  try {
    validateApplication(driver.user_id, {fullName:driver.full_name,dateOfBirth:driver.date_of_birth,
      vehicleModel:driver.vehicle_model,vehicleType:driver.vehicle_type,city:driver.city,
      postalCode:driver.postal_code,registrationNumber:driver.registration_number,
      documents:driver.documents,consent:true}, now);
    return true;
  } catch (_) { return false; }
}
function categoryVehicle(category) { return category === 'Ride' ? 'Car' : category; }
module.exports = { requirements, vehicleSpec, ownedPath, validateApplication, canOperate, categoryVehicle };
