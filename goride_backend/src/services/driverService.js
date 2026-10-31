const { supabase } = require('../config/supabase');
const AppError = require('../utils/AppError');

class DriverService {
  async getDriverByUserId(userId, client = supabase) {
    const { data, error } = await client
      .from('drivers')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw new AppError(error.message, 400);
    return data;
  }

  async updateOnlineStatus(userId, isOnline, lat, lng, client = supabase) {
    if (typeof isOnline !== 'boolean') throw new AppError('Online status must be true or false.',400);
    const { getServiceClient } = require('../config/serviceClient');
    const db = getServiceClient();
    const { data: applicant, error: readError } = await db.from('drivers').select('*').eq('user_id',userId).maybeSingle();
    if (readError || !applicant) throw new AppError('Submit a captain application first.',403);
    if (isOnline && !require('./onboardingValidation').canOperate(applicant)) {
      throw new AppError('Valid documents, human approval and operating permissions are required before going online.',403);
    }
    const updateData = { 
      is_online: isOnline, 
      last_updated: new Date() 
    };

    if (lat !== undefined && lng !== undefined && lat !== null && lng !== null) {
      const point = `POINT(${lng} ${lat})`;
      updateData.current_location = point;
      updateData.location = point;
      updateData.lat = lat;
      updateData.lng = lng;
    }

    const { data, error } = await db
      .from('drivers')
      .update(updateData)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw new AppError(error.message, 400);
    return data;
  }
}

module.exports = new DriverService();
