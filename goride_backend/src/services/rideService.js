const { supabase } = require('../config/supabase');
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

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('wallet_balance')
      .eq('id', userId)
      .single();

    if (profileError) throw profileError;
    if (profile.wallet_balance < calculatedFare) {
      throw new AppError(`Wallet balance INR ${Number(profile.wallet_balance).toFixed(2)} is below this ride fare INR ${calculatedFare.toFixed(2)}. Please add the difference after online payments are enabled.`, 400);
    }

    const { data, error } = await supabase
      .from('rides')
      .insert([{
        user_id: userId,
        pickup_location: pickupLocation,
        drop_location: dropLocation,
        category,
        fare: calculatedFare,
        pickup_latitude: pickupLatitude,
        pickup_longitude: pickupLongitude,
        drop_latitude: dropLatitude,
        drop_longitude: dropLongitude,
        pickup_coords: `POINT(${pickupLongitude} ${pickupLatitude})`,
        drop_coords: `POINT(${dropLongitude} ${dropLatitude})`
      }])
      .select();

    if (error) throw error;
    return data[0];
  }

  async getNearbyDrivers(lat, lang, category = null) {
    const { data, error } = await supabase.rpc('get_nearby_drivers', {
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
      const allowed = new Set((verified||[]).filter(d=>canOperate(d) && (!category || d.vehicle_type===categoryVehicle(category))).map(d=>d.id));
      eligible = eligible.filter(d=>allowed.has(d.id));
    }
    if (eligible.length > 0) {
      const userIds = eligible.map(d => d.user_id);
      const { data: profiles } = await supabase
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
    
    return eligible;
  }

  async acceptRide(rideId, driverId) {
    const db = require('../config/serviceClient').getServiceClient();
    const {data:driver,error:driverError}=await db.from('drivers').select('*').eq('id',driverId).single();
    if(driverError || !canOperate(driver) || !driver.is_online) throw new AppError('Captain is not eligible to accept rides.',403);
    const categories=driver.vehicle_type==='Car'?['Car','Ride']:[driver.vehicle_type];
    // Compare-and-set prevents two captains from claiming one pending request.
    const {data,error}=await db.from('rides').update({driver_id:driverId,status:'driver_assigned'})
      .eq('id',rideId).eq('status','pending').is('driver_id',null).in('category',categories).select().maybeSingle();
    if(error || !data) throw new AppError('Ride unavailable or vehicle category does not match.',409);
    return data;
  }

  async confirmRide(rideId) {
    const { data, error } = await supabase
      .from('rides')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString()
      })
      .eq('id', rideId)
      .select('*, driver:drivers(*)');

    if (error) throw error;
    return data[0];
  }

  async rejectDriver(rideId) {
    const { data, error } = await supabase
      .from('rides')
      .update({
        status: 'pending',
        driver_id: null
      })
      .eq('id', rideId)
      .select();

    if (error) throw error;
    return data[0];
  }

  async cancelRide(rideId) {
    const { data, error } = await supabase
      .from('rides')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString()
      })
      .eq('id', rideId)
      .select('*, driver:drivers(*)');

    if (error) throw error;
    return data[0];
  }

  async driverArrived(rideId) {
    const { data, error } = await supabase
      .from('rides')
      .update({
        status: 'driver_arrived',
        arrived_at: new Date().toISOString()
      })
      .eq('id', rideId)
      .select();

    if (error) throw error;
    return data[0];
  }

  async startRide(rideId) {
    const { data, error } = await supabase
      .from('rides')
      .update({
        status: 'started',
        started_at: new Date().toISOString()
      })
      .eq('id', rideId)
      .select();

    if (error) throw error;
    return data[0];
  }

  async completeRide(rideId) {
    const { data, error } = await supabase.rpc('complete_ride_transaction', {
      p_ride_id: rideId
    });

    if (error) throw error;
    return data;
  }
}

module.exports = new RideService();
