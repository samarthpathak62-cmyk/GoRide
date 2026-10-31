const { getServiceClient }=require('../config/serviceClient');
const { getDistance } = require('geolib');
const fareService = require('./fareService');
const AppError = require('../utils/AppError');
const { canOperate, categoryVehicle } = require('./onboardingValidation');

class RideService {
  async requestRide(rideData) {
    const {
      userId, pickupLocation, dropLocation, category,
      pickupLatitude, pickupLongitude, dropLatitude, dropLongitude
    } = rideData;

    if (![pickupLatitude, pickupLongitude, dropLatitude, dropLongitude].every(v => typeof v === 'number' && Number.isFinite(v)) ||
        Math.abs(pickupLatitude) > 90 || Math.abs(dropLatitude) > 90 || Math.abs(pickupLongitude) > 180 || Math.abs(dropLongitude) > 180) {
      throw new AppError('Choose valid pickup and destination locations.', 400);
    }
    if (!['Bike','Auto','Car','Ride'].includes(category)) throw new AppError('Choose Bike, Auto or Car.',400);
    const distance = getDistance(
      { latitude: pickupLatitude, longitude: pickupLongitude },
      { latitude: dropLatitude, longitude: dropLongitude }
    );

    const calculatedFare = fareService.calculateFare(distance, category);

    if (![pickupLocation,dropLocation].every(v=>typeof v==='string'&&v.trim().length>=2&&v.length<=500)) throw new AppError('Choose pickup and destination addresses.',400);
    if (distance<100) throw new AppError('Pickup and destination must be at least 100 metres apart.',400);
    const {data,error}=await require('../config/serviceClient').getServiceClient().rpc('request_ride_secure',{
      p_actor:userId,p_payload:{pickupLocation,dropLocation,category,fare:calculatedFare,pickupLatitude,pickupLongitude,dropLatitude,dropLongitude,
      pickupCoords:`POINT(${pickupLongitude} ${pickupLatitude})`,dropCoords:`POINT(${dropLongitude} ${dropLatitude})`}});
    if(error) throw new AppError(error.code==='PGRST202'?'Ride database upgrade required. Contact support.':'Could not book: an active ride already exists or wallet balance is insufficient.',error.code==='PGRST202'?503:409);
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
  async completeRide(id,actor){return this.action(id,actor,'complete');}
}
module.exports = new RideService();
