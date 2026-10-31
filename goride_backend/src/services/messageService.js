const { getServiceClient }=require('../config/serviceClient');
const AppError = require('../utils/AppError');

class MessageService {
  async saveMessage(senderId, receiverId, text, imageUrl = null) {
    const { data, error } = await getServiceClient()
      .from('messages')
      .insert([
        {
          sender_id: senderId,
          receiver_id: receiverId,
          text,
          image_url: imageUrl,
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('Error saving message:', error);
      throw new AppError(error.message, 400);
    }
    return data;
  }

  async getChatHistory(userId, otherUserId) {
    const { data, error } = await getServiceClient()
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${userId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${userId})`)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching chat history:', error);
      throw new AppError(error.message, 400);
    }
    return data;
  }

  async getConversationList(userId) {
    const { data, error } = await getServiceClient().rpc('get_user_conversations', { p_user_id: userId });

    if (error) {
      console.error('Error fetching conversations:', error);
      throw new AppError(error.message, 400);
    }
    const result=[];
    for(const row of (data||[]).slice(0,50)) {
      const other=row.other_user_id;
      try { await require('./rideAccess').peers(userId,other,{allowHistory:true}); }
      catch(e) { if(e.statusCode===403)continue;throw e; }
      let active=true;
      try { await require('./rideAccess').peers(userId,other); }
      catch(e) { if(e.statusCode!==403)throw e;active=false; }
      result.push({...row,other_user_name:row.other_user_name?.trim()||'GoRide participant',
        profile_pic:row.other_user_pic||row.profile_pic||null,unread_count:0,is_active:active});
    }
    return result;
  }
}

module.exports = new MessageService();
