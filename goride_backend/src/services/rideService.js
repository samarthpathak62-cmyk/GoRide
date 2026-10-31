const { getServiceClient }=require('../config/serviceClient');
const { getDistance } = require('geolib');
const fareService = require('./fareService');
const AppError = require('../utils/AppError');
const { canOperate, categoryVehicle } = require('./onboardingValidation');

class RideService {
  async requestRide(rideData) {
    const {uuid}=require('./ridePolicy');uuid(rideData.quoteId,'fare quote');
    const method=rideData.paymentMethod||'wallet';
    if(!['cash','wallet'].includes(method))throw new AppError('Choose cash or wallet.',400);
    await require('./dispatchService').expire(rideData.userId);
    const {data,error}=await getServiceClient().rpc('book_quoted_ride',{p_actor:rideData.userId,p_quote:rideData.quoteId,p_method:method});
    if(error)throw new AppError(error.code==='42501'?'This quote does not belong to your account.':'Quote expired, a trip is already active, or wallet funds are insufficient. Refresh the fare or choose cash.',error.code==='42501'?403:409);
    return data;
  }

  async getNearbyDrivers(lat, lang, category = null) {
    const { data, error } = await getServiceClient().rpc('get_nearby_drivers', {
      user_lat: lat,
      user_lng: lang,
      radius_meters: 5000
    });
    if (error) {
      console.error("RPC Error:", error);
      return [];
    }
    
    let eligible = data || [];
    if (eligible.length) {
      const { getServiceClient } = require('../config/serviceClient');
      const {data: verified, error: verifyError} = await getServiceClient().from('drivers').select('*').in('id',eligible.map(d=>d.id));
      if (verifyError) throw new AppError('Could not validate available captains.',503);
      const allowed = new Set((verified||[]).filter(d=>canOperate(d) && d.is_online && (!category || d.vehicle_type===categoryVehicle(category))).map(d=>d.id));
      eligible = eligible.filter(d=>allowed.has(d.id));
    }
    if (eligible.length > 0) {
      const userIds = eligible.map(d => d.user_id);
      const { data: profiles } = await getServiceClient()
        .from('profiles')
        .select('id, profile_pic')
        .in('id', userIds);
        
      if (profiles) {
        eligible.forEach(driver => {
          const profile = profiles.find(p => p.id === driver.user_id);
          if (profile) {
            driver.profile_pic = profile.profile_pic;
          }
        });
      }
    } 
    
    return eligible.map(d=>({id:d.id,user_id:d.user_id,full_name:d.full_name,vehicle_type:d.vehicle_type,lat:d.lat,lng:d.lng,profile_pic:d.profile_pic}));
  }

  async action(rideId,actorId,action) {
    const {uuid}=require('./ridePolicy');uuid(rideId);uuid(actorId,'account');
    const db=require('../config/serviceClient').getServiceClient();
    if(action==='accept'){
      const {data:driver,error}=await db.from('drivers').select('*').eq('user_id',actorId).maybeSingle();
      if(error)throw new AppError('Could not validate captain eligibility.',503);
      if(!canOperate(driver)||!driver.is_online)throw new AppError('Captain approval, valid documents and online status are required.',403);
    }
    const {data,error}=await db.rpc('ride_action_secure',{p_ride:rideId,p_actor:actorId,p_action:action});
    if(error)throw new AppError(error.code==='42501'?'You are not authorised for this ride action.':error.code==='PGRST202'?'Ride database upgrade required. Contact support.':'Ride changed, action is out of order, or settlement balance is insufficient. Refresh before retrying.',error.code==='42501'?403:error.code==='PGRST202'?503:409);
    if(action==='complete')return data;
    const {data:ride,error:readError}=await db.from('rides').select(require('./ridePolicy').RIDE_SELECT).eq('id',rideId).single();
    if(readError)throw new AppError('Action saved but ride could not be refreshed. Reload your active trip.',503);
    await require('./rideAccess').reconcileRoom(global.io,ride);
    return ride;
  }
  async acceptRide(id,actor){return this.action(id,actor,'accept');}
  async confirmRide(id,actor){return this.action(id,actor,'confirm');}
  async rejectDriver(id,actor){return this.action(id,actor,'reject');}
  async cancelRide(id,actor){return this.action(id,actor,'cancel');}
  async driverArrived(id,actor){return this.action(id,actor,'arrive');}
  async startRide(id,actor,pin){return require('./tripPinService').start(id,actor,pin);}
  async completeRide(id,actor,cashCollected=false){
    require('./ridePolicy').uuid(id);
    const {data,error}=await getServiceClient().rpc('settle_ride_v2',{p_actor:actor,p_ride:id,p_cash_collected:cashCollected===true});
    if(error)throw new AppError(error.code==='42501'?'Only the assigned captain can complete this trip.':'Trip must be started. Cash must be explicitly confirmed collected; wallet trips need sufficient funds.',error.code==='42501'?403:409);
    return data;
  }
}
module.exports = new RideService();
