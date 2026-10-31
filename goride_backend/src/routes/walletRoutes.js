const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');

router.use(require('../middlewares/authMiddleware').protect);

router.get('/methods', async(req,res,next) => {
 try {
 const mode=require('../config/payments').mode;
 let sandboxBalance=0;
 if(mode==='test'){const {data,error}=await require('../config/serviceClient').getServiceClient().from('sandbox_payment_credits').select('amount_paise').eq('user_id',req.user.id);if(error)throw error;sandboxBalance=(data||[]).reduce((n,r)=>n+Number(r.amount_paise),0)/100;}
 let available=true;
 try { require('../config/payments').requireConfig(); } catch (_) { available=false; }
 res.json({currency:'INR',onlineCheckoutAvailable:available,mode,sandboxBalance,
  checkoutMethods:['UPI','Cards','Netbanking'],
  notice:mode==='test'?'TEST MODE: provider test payments only. Sandbox balance is not spendable or withdrawable.':'Methods offered depend on your merchant account and provider eligibility. No direct card details are stored by GoRide.',
  bankPayoutAvailable:false,cashRideAvailable:false,refundAutomationAvailable:false});
 }catch(e){next(e);}
});
router.get('/balance', walletController.getBalance);
router.get('/history', walletController.getTransactionHistory);
router.post('/topup', (req, res) => res.status(410).json({ message: 'Direct top-ups are disabled. Update the app and use verified checkout.' }));
router.post('/payment-link', walletController.topup);
router.post('/payout', walletController.payout);

module.exports = router;
