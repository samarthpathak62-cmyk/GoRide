const {getServiceClient}=require('../config/serviceClient');
const {uuid,RIDE_SELECT}=require('./ridePolicy');
const AppError=require('../utils/AppError');
async function rideMember(id,userId,driverOnly=false){
 uuid(id);const {data:r,error}=await getServiceClient().from('rides').select(RIDE_SELECT).eq('id',id).maybeSingle();
 if(error)throw new AppError('Could not validate trip access.',503);
 if(!r||!(r.driver?.user_id===userId||(!driverOnly&&r.user_id===userId)))throw new AppError('Trip access denied.',403);
 return r;
}
async function peers(actor,other,{allowHistory=false}={}){
 uuid(actor,'sender');uuid(other,'recipient');if(actor===other)throw new AppError('Choose a trip participant.',400);
 const db=getServiceClient();
 const {data:drivers,error}=await db.from('drivers').select('id,user_id').in('user_id',[actor,other]);
 if(error)throw new AppError('Could not validate conversation.',503);
 if(!drivers?.length)throw new AppError('A shared trip is required.',403);
 const {data:rides,error:rideError}=await db.from('rides').select('user_id,driver_id').in('user_id',[actor,other]).in('driver_id',drivers.map(d=>d.id)).in('status',allowHistory?['driver_assigned','accepted','driver_arrived','started','completed','cancelled']:['driver_assigned','accepted','driver_arrived','started']).limit(100);
 if(rideError)throw new AppError('Could not validate conversation.',503);
 if(!rides?.some(r=>{const d=drivers.find(d=>d.id===r.driver_id);return r.user_id===actor&&d.user_id===other||r.user_id===other&&d.user_id===actor;}))throw new AppError('Chat and calls are available only during an active shared trip.',403);
}

async function reconcileRoom(io,ride){
 if(!io)return;
 const allowed=new Set([ride.user_id,ride.driver?.user_id]);
 for(const socket of await io.in(ride.id).fetchSockets())if(!allowed.has(socket.userId))await socket.leave(ride.id);
}
module.exports={rideMember,peers,reconcileRoom};
