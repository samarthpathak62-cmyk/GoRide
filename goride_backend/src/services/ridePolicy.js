const AppError=require('../utils/AppError');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DRIVER_FIELDS='id,user_id,full_name,vehicle_type,vehicle_model,registration_number,lat,lng';
const RIDE_SELECT=`*,driver:drivers(${DRIVER_FIELDS})`;
function uuid(value,label='ride ID') {if(typeof value!=='string'||!UUID.test(value))throw new AppError(`Invalid ${label}.`,400);return value;}
function coordinates(lat,lng){return typeof lat==='number'&&typeof lng==='number'&&Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180;}
function participant(ride,userId,driver){return ride?.user_id===userId||!!(driver?.id&&ride?.driver_id===driver.id);}
module.exports={uuid,coordinates,participant,RIDE_SELECT};
