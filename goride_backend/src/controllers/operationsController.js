const {getServiceClient}=require('../config/serviceClient');
const {uuid}=require('../services/ridePolicy');
const AppError=require('../utils/AppError');
const catchAsync=require('../utils/catchAsync');
exports.rides=catchAsync(async(req,res)=>{
 const statuses=['pending','driver_assigned','accepted','driver_arrived','started','completed','cancelled'];
 let query=getServiceClient().from('rides').select('id,user_id,driver_id,category,fare,status,created_at,completed_at').order('created_at',{ascending:false}).limit(50);
 if(req.query.status){if(!statuses.includes(req.query.status))throw new AppError('Invalid trip status.',400);query=query.eq('status',req.query.status);}
 const {data,error}=await query;if(error)throw new AppError('Could not load operations trips.',503);
 res.json({data,currency:'INR',limit:50});
});
exports.events=catchAsync(async(req,res)=>{
 uuid(req.params.rideId);
 const {data,error}=await getServiceClient().from('ride_events').select('id,actor_id,action,from_status,to_status,created_at').eq('ride_id',req.params.rideId).order('created_at',{ascending:true}).limit(100);
 if(error)throw new AppError('Trip event database is not ready.',503);
 res.json({data});
});
