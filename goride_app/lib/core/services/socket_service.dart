import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:socket_io_client/socket_io_client.dart';

class SocketService {
  static final SocketService _instance = SocketService._internal();
  factory SocketService() => _instance;
  SocketService._internal();

  Socket? _socket;
  Future<void>? _connecting;
  final Set<String> _rideRooms = {};
  String? _userId;

  String? get userId => _userId;

  
  final Map<String, List<Function(dynamic)>> _listeners = {};

  Future<void> connect(String url) {
    return _connecting ??= _connect(url).whenComplete(() => _connecting = null);
  }
  Future<void> _connect(String url) async {
    if (_socket != null && _socket!.connected) return;

    print(" Connecting to Socket.io: $url");
    final prefs = await SharedPreferences.getInstance();
    String? token = prefs.getString('auth_token');
    if (token == null) {
      try { token = (jsonDecode(prefs.getString('CACHED_USER') ?? '{}') as Map)['token'] as String?; } catch (_) {}
    }
    if (token == null || token.isEmpty) return;
    _socket?.dispose();
    _socket = io(url, <String, dynamic>{
      'transports': ['websocket'],
      'autoConnect': false,
      'auth': {'token': token},
    });

    _socket!.onConnect((_) {
      for (final id in _rideRooms) { _socket!.emit('join_ride', id); }
      print(' Connected to Socket.io: ${_socket!.id}');
      _listeners.forEach((event, callbacks) {
        _socket!.off(event); 
        for (var cb in callbacks) {
          _socket!.on(event, cb);
        }
      });

      if (_userId != null) {
        print(" Re-registering user in socket on connect: $_userId");
        _socket!.emit('register', {'userId': _userId});
      }
    });

    _socket!.onDisconnect((_) => print('Disconnected from Socket.io'));
    _socket!.onConnectError((data) => print('Socket Connect Error: $data'));
    _socket!.onError((data) => print('Socket Error: $data'));

    _socket!.connect();
  }

  void _setSingleListener(String event, Function(dynamic) callback) {
    _listeners[event] = [callback]; 
    if (_socket != null) {
      _socket!.off(event);
      _socket!.on(event, callback);
    }
  }


  void joinRide(String rideId) {
    if (rideId.isNotEmpty) _rideRooms.add(rideId);
    print("Joining ride room: $rideId");
    _socket?.emit('join_ride', rideId);
  }

  Future<void> emit(String event, dynamic data) async {
    if (_socket == null) return;
    
    if (_socket!.connected) {
      _socket!.emit(event, data);
    } else {
      print("Socket not connected, queuing emit for $event");
      _socket!.once('connect', (_) {
        _socket!.emit(event, data);
      });
      _socket!.connect();
    }
  }

  void registerUser(String userId) {
    print("Registering user in socket: $userId");
    _userId = userId;
    emit('register', {'userId': userId});
  }


  void sendMessage(String receiverId, String text, {String? imageUrl}) {
    emit('send_message', {
      'senderId': _userId, 
      'receiverId': receiverId,
      'text': text,
      'imageUrl': imageUrl ?? "",
    });
  }

  void onMessage(Function(Map<String, dynamic>) callback) {
    _setSingleListener('message', (data) {
      callback(Map<String, dynamic>.from(data as Map));
    });
  }

  void setTyping(String receiverId, bool isTyping) {
    _socket?.emit('typing', {
      'receiverId': receiverId,
      'isTyping': isTyping,
    });
  }

  void onTyping(Function(Map<String, dynamic>) callback) {
    _setSingleListener('typing', (data) {
      callback(Map<String, dynamic>.from(data as Map));
    });
  }

  void emitCallEvent(String event, Map<String, dynamic> data) {
    _socket?.emit('call:$event', data);
  }

  void onCallEvent(String event, Function(Map<String, dynamic>) callback) {
    _setSingleListener('call:$event', (data) {
      callback(Map<String, dynamic>.from(data as Map));
    });
  }

  void onRideAccepted(Function(Map<String, dynamic>?) callback) {
    _setSingleListener('ride_accepted', (data) {
      if (data == null) {
        callback(null);
      } else {
        callback(Map<String, dynamic>.from(data as Map));
      }
    });
  }

  void onDriverLocationUpdate(Function(Map<String, dynamic>?) callback) {
    _setSingleListener('driver_location_update', (data) {
      if (data == null) {
        callback(null);
      } else {
        callback(Map<String, dynamic>.from(data as Map));
      }
    });
  }

  void onDriverArrived(Function(Map<String, dynamic>?) callback) {
    _setSingleListener('driver_arrived', (data) {
      if (data == null) {
        callback(null);
      } else {
        callback(Map<String, dynamic>.from(data as Map));
      }
    });
  }

  void onRideCancelled(Function(Map<String, dynamic>?) callback) {
    _setSingleListener('ride_cancelled', (data) {
      if (data == null) {
        callback(null);
      } else {
        callback(Map<String, dynamic>.from(data as Map));
      }
    });
  }

  void onRideConfirmed(Function(Map<String, dynamic>?) callback) {
    _setSingleListener('ride_confirmed', (data) {
      if (data == null) {
        callback(null);
      } else {
        callback(Map<String, dynamic>.from(data as Map));
      }
    });
  }

  void onRideStarted(Function(Map<String, dynamic>?) callback) {
    _setSingleListener('ride_started', (data) {
      if (data == null) {
        callback(null);
      } else {
        callback(Map<String, dynamic>.from(data as Map));
      }
    });
  }

  void onRideCompleted(Function(Map<String, dynamic>?) callback) {
    _setSingleListener('ride_completed', (data) {
      if (data == null) {
        callback(null);
      } else {
        callback(Map<String, dynamic>.from(data as Map));
      }
    });
  }

  void stopListener(String event) {
    _socket?.off(event);
    _listeners.remove(event);
  }

  void stopConfirmationListener() {
    _socket?.off('ride_confirmed');
    _listeners.remove('ride_confirmed');
  }

  void stopCancellationListener() {
    _socket?.off('ride_cancelled');
    _listeners.remove('ride_cancelled');
  }

  void stopLocationUpdates() {
    _socket?.off('driver_location_update');
    _listeners.remove('driver_location_update');
  }

  void stopArrivalListener() {
    _socket?.off('driver_arrived');
    _listeners.remove('driver_arrived');
  }

  void stopRideStartedListener() {
    _socket?.off('ride_started');
    _listeners.remove('ride_started');
  }

  void stopRideCompletedListener() {
    _socket?.off('ride_completed');
    _listeners.remove('ride_completed');
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
    _userId = null;
    _rideRooms.clear();
    _listeners.clear();
  }
}
