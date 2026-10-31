import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:latlong2/latlong.dart';
import '../../../../core/services/api_service.dart';
import '../../../../injection_container.dart' as di;
import '../bloc/explore_bloc.dart';
import '../bloc/explore_event.dart';
import '../bloc/explore_models.dart';
class NearbyDriversPage extends StatefulWidget {
 final List<DriverModel> drivers;final LatLng pickupLocation;final String? rideId;
 const NearbyDriversPage({super.key,required this.drivers,required this.pickupLocation,this.rideId});
 @override State<NearbyDriversPage> createState()=>_NearbyDriversPageState();
}
class _NearbyDriversPageState extends State<NearbyDriversPage>{
 Timer? _timer;bool _busy=false;String? _error,_lastProposal;
 @override void initState(){super.initState();_timer=Timer.periodic(const Duration(seconds:8),(_)=>_poll());}
 @override void dispose(){_timer?.cancel();super.dispose();}
 Future<void> _poll()async{if(_busy)return;_busy=true;try{final r=await di.sl<ApiService>().get('/rides/active');if(!mounted)return;final d=r['data'];if(d==null){Navigator.of(context).popUntil((r)=>r.isFirst);ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Search ended or expired. No fare was deducted.')));return;}if(d['id']==widget.rideId&&d['status']!='pending'){final marker="${d['status']}:${d['driver_id']}";if(marker!=_lastProposal){_lastProposal=marker;context.read<ExploreBloc>().add(const CheckActiveRideEvent());}}setState(()=>_error=null);}catch(e){if(mounted)setState(()=>_error=e.toString());}finally{_busy=false;}}
 Future<void> _cancel()async{try{if(widget.rideId!=null)await di.sl<ApiService>().post('/rides/cancel',{'rideId':widget.rideId});if(mounted)Navigator.of(context).popUntil((r)=>r.isFirst);}catch(e){if(mounted)setState(()=>_error=e.toString());}}
 @override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:const Text('Finding your captain'),automaticallyImplyLeading:false),body:ListView(padding:const EdgeInsets.all(24),children:[const LinearProgressIndicator(),const SizedBox(height:24),const Text('Matching nearby approved captains',style:TextStyle(fontSize:24,fontWeight:FontWeight.bold)),const Text('A captain must accept, then you confirm. The server ends an unconfirmed search after 3 minutes. No fare is deducted while searching.'),if(_error!=null)Text(_error!,style:const TextStyle(color:Colors.orangeAccent)),...widget.drivers.map((d)=>ListTile(leading:const Icon(Icons.two_wheeler),title:Text(d.name),subtitle:Text('${d.vehicle} · availability is not a confirmed assignment'))),TextButton(onPressed:_poll,child:const Text('Refresh matching status')),OutlinedButton(onPressed:_cancel,child:const Text('Cancel request'))]));
}
