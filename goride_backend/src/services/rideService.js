const { supabase } = require('../config/supabase');
const { getDistance } = require('geolib');
const fareService = require('./fareService');
const AppError = require('../utils/AppError');

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

  async getNearbyDrivers(lat, lang) {
    const { data, error } = await supabase.rpc('get_nearby_drivers', {
      user_lat: lat,
      user_lng: lang,
      radius_meters: 5000
    });
    if (error) {
      console.error("RPC Error:", error);
      return [];
    }
    
    if (data && data.length > 0) {
      const userIds = data.map(d => d.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, profile_pic')
        .in('id', userIds);
        
      if (profiles) {
        data.forEach(driver => {
          const profile = profiles.find(p => p.id === driver.user_id);
          if (profile) {
            driver.profile_pic = profile.profile_pic;
          }
        });
      }
    } 
    
    return data || [];
  }

  async acceptRide(rideId, driverId) {
    const { data, error } = await supabase
      .from('rides')
      .update({
        driver_id: driverId,
        status: 'driver_assigned'
      })
      .eq('id', rideId)
      .select();

    if (error) throw error;
    return data[0];
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
