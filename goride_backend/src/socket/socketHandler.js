const {getScopedClient}=require('../config/supabase');
const {rideMember,peers}=require('../services/rideAccess');
const {coordinates,uuid}=require('../services/ridePolicy');
const notificationService=require('../services/notificationService');
const messageService=require('../services/messageService');
const room=id=>`user_${id}`;
function initSocket(io){
 io.use(async(socket,next)=>{
  try{
   const token=socket.handshake.auth?.token;
   if(typeof token!=='string'||token.length>8192)throw Error();
   const client=await getScopedClient(token);
   const {data,error}=await client.auth.getUser(token);
   if(error||!data.user?.email_confirmed_at)throw Error();
   const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
   if(!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now())throw Error();
   socket.userId=data.user.id;socket.expiresAt=claims.exp*1000;next();
  }catch(_){next(new Error('Sign in again to connect securely.'));}
 });
 io.on('connection',socket=>{
  socket.join(room(socket.userId));
  const expiry=setTimeout(()=>socket.disconnect(true),Math.min(socket.expiresAt-Date.now(),2147483647));expiry.unref?.();
  socket.on('disconnect',()=>clearTimeout(expiry));
  let eventWindow=Date.now(),eventCount=0;
  const on=(event,handler)=>socket.on(event,async(data,ack)=>{
   try{if(Date.now()-eventWindow>60000){eventWindow=Date.now();eventCount=0;}if(++eventCount>120)throw Error('Too many events.');if(Date.now()>=socket.expiresAt)throw Error('Session expired. Sign in again.');await handler(data||{},ack);}
   catch(err){const message=err.statusCode&&err.statusCode<500?err.message:'Action unavailable. Check your session and trip.';if(typeof ack==='function')ack({success:false,error:message});else socket.emit('action_error',{event,message});}
  });
  on('register',async data=>{if(data.userId!==socket.userId)throw Error();await socket.join(room(socket.userId));});
  on('driver_join',async id=>{
   if(id!==socket.userId)throw Error();
   const {data,error}=await require('../config/serviceClient').getServiceClient().from('drivers').select('id').eq('user_id',socket.userId).maybeSingle();
   if(error||!data)throw Error();await socket.join(`driver_${socket.userId}`);
  });
  on('join_ride',async id=>{await rideMember(id,socket.userId);await socket.join(id);});
  on('update_location',async data=>{
   if(!coordinates(data.lat,data.lng))throw Error();
   const ride=await rideMember(data.rideId,socket.userId,true);
   if(!['accepted','driver_arrived','started'].includes(ride.status))throw Error();
   io.to(data.rideId).emit('driver_location_update',{lat:data.lat,lng:data.lng});
  });
  on('send_message',async(data,ack)=>{
   await peers(socket.userId,data.receiverId);
   if(typeof data.text!=='string'||data.text.length>4000||(!data.text.trim()&&!data.imageUrl))throw Error();
   if(data.imageUrl&&(typeof data.imageUrl!=='string'||data.imageUrl.length>2000||!data.imageUrl.startsWith('https://')))throw Error();
   const saved=await messageService.saveMessage(socket.userId,data.receiverId,data.text,data.imageUrl||null);
   const message={_id:saved.id,senderId:socket.userId,receiverId:data.receiverId,text:saved.text,imageUrl:saved.image_url,createdAt:saved.created_at};
   io.to(room(socket.userId)).to(room(data.receiverId)).emit('message',message);
   notificationService.sendToUser(data.receiverId,{title:'New trip message',body:'Open GoRide to read your message.'},{senderId:socket.userId,type:'chat_message'});
   if(typeof ack==='function')ack({success:true,message});
  });
  on('typing',async data=>{await peers(socket.userId,data.receiverId);io.to(room(data.receiverId)).emit('typing',{senderId:socket.userId,isTyping:data.isTyping===true});});
  for(const [event,outbound,recipient,identity]of[
   ['call:start','call:incoming','receiverId','callerId'],['call:accept','call:accepted','callerId','receiverId'],
   ['call:offer','call:offer','receiverId','callerId'],['call:answer','call:answer','callerId','receiverId'],['call:ice','call:ice','receiverId',null]
  ])on(event,async data=>{await peers(socket.userId,data[recipient]);if(data[identity]&&data[identity]!==socket.userId)throw Error();io.to(room(data[recipient])).emit(outbound,{...data,...(identity?{[identity]:socket.userId}:{})});});
  on('call:end',async data=>{const other=data.callerId===socket.userId?data.receiverId:data.callerId;await peers(socket.userId,other);io.to(room(other)).to(room(socket.userId)).emit('call:end');});
 });
}
module.exports={initSocket};
