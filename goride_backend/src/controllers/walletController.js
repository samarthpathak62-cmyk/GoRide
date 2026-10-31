
class WalletController {
  async getBalance(req, res, next) {
    try {
      const userId = req.user.id;
      const { data, error } = await req.supabase
        .from('profiles')
        .select('wallet_balance')
        .eq('id', userId)
        .single();

      if (error) throw error;
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  async getTransactionHistory(req, res, next) {
    try {
      const userId = req.user.id;
      const { data, error } = await req.supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  async topup(req, res, next) {
    try {
      const data = await require('../config/payments').createLink(req.user.id, req.body.amount);
      res.status(201).json(data);
    } catch (error) { next(error); }
  }

  async payout(req, res, next) {
    // A ledger debit is not a bank transfer. Do not pretend that it is.
    res.status(503).json({ message: 'Bank payouts are not configured yet. Your balance has not been deducted.' });
  }
}

module.exports = new WalletController();
