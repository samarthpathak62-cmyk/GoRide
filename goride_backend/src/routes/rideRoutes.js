const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');

const { protect } = require('../middlewares/authMiddleware');

router.use(protect);
const pinLimiter=require('express-rate-limit').rateLimit({windowMs:60000,limit:15,standardHeaders:'draft-7',legacyHeaders:false,message:{message:'Too many PIN requests. Wait a minute and try again.'}});
router.get('/explore/data', rideController.getExploreData);
router.post('/rides/request', rideController.requestRide);
router.post('/rides/accept', rideController.acceptRide);
router.post('/rides/confirm', rideController.confirmRide);
router.post('/rides/reject', rideController.rejectDriver);
router.post('/rides/cancel', rideController.cancelRide);
router.post('/rides/arrive', rideController.notifyArrived);
router.post('/rides/:rideId/start-pin',pinLimiter,rideController.getTripPin);
router.post('/rides/start', pinLimiter, rideController.startRide);
router.post('/rides/complete', rideController.completeRide);
router.get('/rides/active', rideController.getActiveRide);
router.get('/rides/history', rideController.getRideHistory);


module.exports = router;
