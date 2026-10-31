const messageService = require('../services/messageService');

exports.getChatHistory = async (req, res, next) => {
  try {
    const { otherUserId } = req.params;
    const userId = req.user.id;
    
    await require('../services/rideAccess').peers(userId,otherUserId,{allowHistory:true});
    let canSend=true;try{await require('../services/rideAccess').peers(userId,otherUserId);}catch(e){if(e.statusCode!==403)throw e;canSend=false;}
    const history = await messageService.getChatHistory(userId, otherUserId);
    
    res.status(200).json({
      status: 'success',
      data: history, canSend
    });
  } catch (err) {
    next(err);
  }
};

exports.getConversations = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const conversations = await messageService.getConversationList(userId);
    
    res.status(200).json({
      status: 'success',
      data: conversations
    });
  } catch (err) {
    next(err);
  }
};

exports.access=async(req,res,next)=>{
 try {
  const {peers}=require('../services/rideAccess');
  await peers(req.user.id,req.params.otherUserId,{allowHistory:true});
  let canSend=true;try{await peers(req.user.id,req.params.otherUserId);}catch(e){if(e.statusCode!==403)throw e;canSend=false;}
  res.json({canSend});
 }catch(e){next(e);}
};
