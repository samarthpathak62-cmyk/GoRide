import 'package:flutter/material.dart';
import '../../../../core/services/api_service.dart';
import '../../../../injection_container.dart' as di;
class FareConfirmation extends StatefulWidget {
  final Map<String,dynamic> request;
  const FareConfirmation({super.key,required this.request});
  @override State<FareConfirmation> createState()=>_FareConfirmationState();
}
class _FareConfirmationState extends State<FareConfirmation>{
  Map<String,dynamic>? _quote; String _method='cash'; String? _error; bool _busy=false;
  @override void initState(){super.initState();_load();}
  Future<void> _load() async{setState((){_busy=true;_error=null;_quote=null;});try{final r=await di.sl<ApiService>().post('/rides/quote',widget.request);if(mounted)setState(()=>_quote=Map<String,dynamic>.from((r['data'] as List).first));}catch(e){if(mounted)setState(()=>_error=e.toString());}finally{if(mounted)setState(()=>_busy=false);}}
  @override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:const Text('Review fare & payment')),body:ListView(padding:const EdgeInsets.all(24),children:[
    Text('${widget.request['pickupLocation']} → ${widget.request['dropLocation']}'), const SizedBox(height:20),
    if(_busy)const LinearProgressIndicator(),if(_error!=null)Text(_error!,style:const TextStyle(color:Colors.orangeAccent)),
    if(_quote!=null)...[Text("${_quote!['category']} · INR ${_quote!['fare']}",style:const TextStyle(fontSize:30,fontWeight:FontWeight.bold)),Text("Base INR ${_quote!['baseFare']} + distance INR ${_quote!['distanceFare']}"),Text("${((_quote!['distanceMeters'] as num)/1000).toStringAsFixed(1)} km · ${_quote!['routeSource']=='road_route'?'Road-route estimate':'Straight-line estimate — road routing not configured'}"),const Text('Fare quote expires after 2 minutes. Matching ends after 3 minutes if no captain confirms. No fake ETA or discount is included.'),
      RadioListTile<String>(value:'cash',groupValue:_method,onChanged:(v)=>setState(()=>_method=v!),title:const Text('Cash to captain after trip')),
      RadioListTile<String>(value:'wallet',groupValue:_method,onChanged:(v)=>setState(()=>_method=v!),title:const Text('GoRide wallet (sufficient balance required)')),
      FilledButton(onPressed:()=>Navigator.pop(context,{'quoteId':_quote!['quoteId'],'paymentMethod':_method,'fare':_quote!['fare']}),child:const Text('Confirm fare & find captain')),
    ],TextButton(onPressed:_busy?null:_load,child:const Text('Refresh fare')),
  ]));
}
