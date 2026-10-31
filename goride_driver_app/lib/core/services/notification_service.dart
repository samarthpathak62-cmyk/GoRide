import 'dart:typed_data';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'api_service.dart';

class NotificationService {
  final ApiService apiService;
  NotificationService(this.apiService);
  final _local=FlutterLocalNotificationsPlugin();
  Future<void>? _initializing;
  final Map<String,DateTime> _seen={};
  static const channelId='incoming_trips_v2';
  Future<void> init()=>_initializing??=_init();
  Future<void> _init() async {
    await _local.initialize(const InitializationSettings(android:AndroidInitializationSettings('@mipmap/ic_launcher')));
    final android=_local.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    await android?.requestNotificationsPermission();
    await android?.createNotificationChannel(const AndroidNotificationChannel(channelId,'Trip offers & updates',description:'Incoming GoRide trips and trip updates',importance:Importance.max,playSound:true,sound:RawResourceAndroidNotificationSound('incoming_trip'),enableVibration:true));
    if(Firebase.apps.isEmpty)return;
    await FirebaseMessaging.instance.requestPermission(alert:true,badge:true,sound:true);
    FirebaseMessaging.onMessage.listen((m){
      if(m.data['type']=='ride_request') {showRideOffer({'rideId':m.data['rideId'],'title':m.notification?.title,'body':m.notification?.body});}
      else {_show(m.messageId??DateTime.now().toIso8601String(),m.notification?.title??'GoRide',m.notification?.body??'You have a trip update.');}
    });
    FirebaseMessaging.instance.onTokenRefresh.listen((token){apiService.post('/auth/update-fcm-token',{'fcmToken':token}).catchError((_)=><String,dynamic>{});});
  }
  Future<void> showRideOffer(Map<String,dynamic> offer) async {
    final id=offer['rideId']?.toString()??offer['id']?.toString();
    if(id==null||id.isEmpty)return;
    final expires=DateTime.tryParse(offer['expiresAt']?.toString()??'');
    if(expires!=null&&expires.isBefore(DateTime.now()))return;
    _seen.removeWhere((_,at)=>DateTime.now().difference(at).inMinutes>5);
    if(_seen.containsKey(id))return;
    _seen[id]=DateTime.now();
    try {await init();await _show(id,offer['title']?.toString()??'New GoRide trip',offer['body']?.toString()??'Open GoRide to review this offer before it expires.');}
    catch(_) {await SystemSound.play(SystemSoundType.alert);HapticFeedback.heavyImpact();}
  }
  Future<void> _show(String id,String title,String body) async {
    await _local.show(id.hashCode&0x7fffffff,title,body,NotificationDetails(android:AndroidNotificationDetails(channelId,'Trip offers & updates',importance:Importance.max,priority:Priority.high,playSound:true,sound:const RawResourceAndroidNotificationSound('incoming_trip'),enableVibration:true,vibrationPattern:Int64List.fromList([0,300,180,300]),timeoutAfter:30000)),payload:id);
  }
  Future<String?> getToken() async {try {if(Firebase.apps.isEmpty||kIsWeb)return null;return await FirebaseMessaging.instance.getToken();}catch(_){return null;}}
  Future<void> updateTokenOnServer(String userId) async {final token=await getToken();if(token==null)return;try{await apiService.post('/auth/update-fcm-token',{'fcmToken':token});}catch(_){}}
}
