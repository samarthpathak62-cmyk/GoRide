const router=require('express').Router();
const {rateLimit}=require('express-rate-limit');
const {protect}=require('../middlewares/authMiddleware');
const {requireAdmin}=require('../middlewares/adminAuth');
const admin=require('../controllers/adminController');
const accounts=require('../controllers/adminAccountController');
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.post('/session',rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false}),admin.login);
router.post('/register-owner',rateLimit({windowMs:60*60*1000,limit:5,standardHeaders:'draft-8',legacyHeaders:false}),accounts.registerOwner);
router.post('/activate',protect,rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false}),accounts.activate);
router.post('/mfa/verify',protect,rateLimit({windowMs:15*60*1000,limit:10,standardHeaders:'draft-8',legacyHeaders:false}),admin.verifyEnrollment);
router.use(protect,requireAdmin);
router.get('/payments/status', (_req,res)=>{
 const env=process.env;
 let checkoutReady=true;
 try {require('../config/payments').requireConfig();} catch (_) {checkoutReady=false;}
 res.json({checkoutReady,provider:'Razorpay hosted checkout',currency:'INR',
  checks:{serverServiceKey:!!env.SUPABASE_SERVICE_ROLE_KEY,liveGatewayKey:!!env.RAZORPAY_KEY_ID?.startsWith('rzp_live_'),gatewaySecret:!!env.RAZORPAY_KEY_SECRET,webhookSecret:!!env.RAZORPAY_WEBHOOK_SECRET,explicitlyEnabled:env.PAYMENTS_ENABLED==='true'},
  methods:['UPI','Debit / credit cards','Netbanking'],bankPayoutsReady:false,cashRideImplemented:true,cashRideReady:false,
  notice:'Configuration checks are not a successful transaction or merchant-approval check. Provider eligibility, KYC, webhook delivery and real-money testing remain required. Do not enable until the security review is complete.'});
});
router.get('/operations/rides',require('../controllers/operationsController').rides);
router.get('/operations/rides/:rideId/events',require('../controllers/operationsController').events);
router.get('/operations/support',require('../controllers/ecosystemController').adminQueue);
router.post('/operations/tickets/:id/reply',require('../controllers/ecosystemController').reply);
router.post('/operations/alerts/:id',require('../controllers/ecosystemController').handleAlert);
router.get('/accounts',accounts.list);
router.post('/accounts',accounts.create);
router.get('/applications',admin.list);
router.get('/applications/:userId',admin.detail);
router.post('/applications/:userId/review',admin.review);
module.exports=router;
