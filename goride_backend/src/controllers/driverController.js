const AppError = require('../utils/AppError');
const driverService = require('../services/driverService');
const catchAsync = require('../utils/catchAsync');

exports.getDriverStatus = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const driver = await driverService.getDriverByUserId(userId, req.supabase);
  res.status(200).json({
    status: 'success',
    data: driver || { status: 'not_submitted', is_online: false }
  });
});

exports.toggleOnline = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { isOnline, latitude, longitude } = req.body;
  if (isOnline && (![latitude,longitude].every(v=>typeof v==='number' && Number.isFinite(v)) || Math.abs(latitude)>90 || Math.abs(longitude)>180)) {
    throw new AppError('Allow location access before going online.',400);
  }
  const driver = await driverService.updateOnlineStatus(userId, isOnline, latitude, longitude, req.supabase);
  res.status(200).json({
    status: 'success',
    data: driver
  });
});
