import 'package:equatable/equatable.dart';

abstract class HomeEvent extends Equatable {
  @override
  List<Object?> get props => [];
}

class ToggleOnlineEvent extends HomeEvent {
  final bool isOnline;
  final double? lat;
  final double? lng;
  ToggleOnlineEvent({required this.isOnline, this.lat, this.lng});

  @override
  List<Object?> get props => [isOnline, lat, lng];
}

class FetchDriverStatusEvent extends HomeEvent {}

class InitSocketEvent extends HomeEvent {}

class NewRideRequestReceivedEvent extends HomeEvent {
  final Map<String, dynamic> rideData;
  NewRideRequestReceivedEvent({required this.rideData});

  @override
  List<Object?> get props => [rideData];
}

class AcceptRideEvent extends HomeEvent {
  final String rideId;
  AcceptRideEvent({required this.rideId});

  @override
  List<Object?> get props => [rideId];
}

class CheckActiveRideEvent extends HomeEvent {}

class HomeRideCancelledEvent extends HomeEvent {
  final Map<String, dynamic> rideData;
  HomeRideCancelledEvent({required this.rideData});

  @override
  List<Object?> get props => [rideData];
}

class RideConfirmedByPassengerEvent extends HomeEvent {
  final Map<String, dynamic> rideData;
  RideConfirmedByPassengerEvent({required this.rideData});

  @override
  List<Object?> get props => [rideData];
}

class PollRideOffersEvent extends HomeEvent {}
