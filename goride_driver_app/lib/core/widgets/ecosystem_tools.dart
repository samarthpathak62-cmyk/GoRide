import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import '../../injection_container.dart' as di;

class TripTools extends StatelessWidget {
  final String rideId;
  const TripTools({super.key, required this.rideId});
  Future<void> _action(BuildContext context, String action) async {
    if (action == 'support') { Navigator.push(context, MaterialPageRoute(builder: (_) => EcosystemSupportPage(rideId: rideId))); return; }
    if (action == '112') { final ok = await launchUrl(Uri.parse('tel:112')); if (!ok && context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Open your phone dialler and call 112.'))); return; }
    if (action == 'share' || action == 'alert') {
      final ok = await showDialog<bool>(context: context, builder: (c) => AlertDialog(title: Text(action == 'share' ? 'Share private trip?' : 'Record safety alert?'), content: Text(action == 'share' ? 'Anyone with this link can view pickup, destination, vehicle and status for 30 minutes or until the trip ends. A new link revokes the old one.' : 'This records an alert in GoRide operations. It does NOT contact police and is not guaranteed to be monitored. Call 112 immediately if in danger.'), actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Continue'))]));
      if (ok != true || !context.mounted) return;
    }
    try {
      final api = di.sl<ApiService>();
      final dynamic r;
      if (action == 'receipt') r = await api.get('/rides/$rideId/receipt');
      else if (action == 'cash') r = await api.get('/drivers/cash-ledger');
      else r = await api.post('/rides/$rideId/${action == 'alert' ? 'safety-alert' : action == 'revoke' ? 'share/revoke' : 'share'}', {});
      if (!context.mounted) return;
      if (action == 'share') { await Clipboard.setData(ClipboardData(text: r['data']['url'])); if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Private trip link copied. Share only with someone you trust.'))); return; }
      String message = r['message']?.toString() ?? '';
      if (action == 'receipt') { final d=r['data']; message='Trip ${d['rideId']}\n${d['category']} · INR ${d['fare']}\n${d['pickup']} → ${d['drop']}\n${d['paymentMethod']} · ${d['paymentStatus']}\n${d['completedAt']}\n\n${d['notice']}'; }
      if (action == 'cash') { final rows=r['data'] as List; message='${r['notice']}\n\n${rows.map((d) => "${d['created_at']} · Cash INR ${d['cash_received']} · commission due INR ${d['commission_due']}").join('\n')}'; }
      if (context.mounted) await showDialog<void>(context: context, builder: (c) => AlertDialog(title: Text(action == 'receipt' ? 'Trip receipt' : action == 'cash' ? 'Cash ledger' : 'GoRide'), content: SingleChildScrollView(child: SelectableText(message)), actions: [TextButton(onPressed: () => Navigator.pop(c), child: const Text('Close'))]));
    } catch (e) { if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()))); }
  }
  @override
  Widget build(BuildContext context) => Wrap(alignment: WrapAlignment.spaceBetween, children: [
    TextButton.icon(onPressed: () => _action(context, '112'), icon: const Icon(Icons.emergency, color: Colors.redAccent), label: const Text('Emergency: 112')),
    PopupMenuButton<String>(tooltip: 'Trip help, sharing and receipt', onSelected: (v) => _action(context, v), itemBuilder: (_) => const [
      PopupMenuItem(value: 'support', child: Text('Help / refund request')), PopupMenuItem(value: 'share', child: Text('Copy private trip link')), PopupMenuItem(value: 'revoke', child: Text('Revoke my share link')), PopupMenuItem(value: 'alert', child: Text('Record safety alert')), PopupMenuItem(value: 'receipt', child: Text('View completed-trip receipt')),
    ]),
  ]);
}
class CashLedgerButton extends StatelessWidget {
  const CashLedgerButton({super.key});
  @override
  Widget build(BuildContext context) => TextButton(onPressed: () => const TripTools(rideId: '')._action(context, 'cash'), child: const Text('Cash ledger'));
}
class EcosystemSupportPage extends StatefulWidget {
  final String? rideId;
  const EcosystemSupportPage({super.key, this.rideId});
  @override
  State<EcosystemSupportPage> createState() => _EcosystemSupportPageState();
}
class _EcosystemSupportPageState extends State<EcosystemSupportPage> {
  final _message=TextEditingController(); String _category='trip'; List<dynamic> _tickets=[]; String? _error; bool _busy=false;
  @override void initState(){ super.initState(); _load(); }
  @override void dispose(){ _message.dispose(); super.dispose(); }
  Future<void> _load() async { try { final r=await di.sl<ApiService>().get('/support/tickets'); if(mounted) setState((){_tickets=r['data'];_error=null;}); } catch(e){if(mounted)setState(()=>_error=e.toString());} }
  Future<void> _send() async { if(_message.text.trim().length<12){setState(()=>_error='Describe the issue in at least 12 characters.');return;} setState((){_busy=true;_error=null;});try{final r=await di.sl<ApiService>().post('/support/tickets',{'category':_category,'message':_message.text.trim(),if(widget.rideId!=null)'rideId':widget.rideId});_message.clear();await _load();if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(r['message'])));}catch(e){if(mounted)setState(()=>_error=e.toString());}finally{if(mounted)setState(()=>_busy=false);} }
  @override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:const Text('GoRide help & requests'),actions:[IconButton(onPressed:_load,icon:const Icon(Icons.refresh))]),body:ListView(padding:const EdgeInsets.all(20),children:[
    const Text('For emergencies call 112. Tickets are not guaranteed to be monitored immediately. A refund request does not transfer money.'),
    DropdownButtonFormField<String>(initialValue:_category,items:const ['trip','payment','refund_request','safety','account'].map((s)=>DropdownMenuItem(value:s,child:Text(s.replaceAll('_',' ')))).toList(),onChanged:(s)=>setState(()=>_category=s!)),
    TextField(controller:_message,maxLength:2000,maxLines:4,decoration:const InputDecoration(labelText:'Describe the issue (no passwords, PINs or bank secrets)')),
    if(_error!=null)Text(_error!,style:const TextStyle(color:Colors.orangeAccent)),FilledButton(onPressed:_busy?null:_send,child:Text(_busy?'Sending…':'Submit request')),
    const SizedBox(height:20), const Text('Your latest requests'),..._tickets.map((t)=>Card(child:Padding(padding:const EdgeInsets.all(12),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text("${t['category']} · ${t['status']}"),Text(t['message']),if(t['reply']!=null)Text("GoRide: ${t['reply']}"),Text(t['created_at'])])))),
  ]));
}


/// Account-scoped captain history; the server derives captain identity from JWT.
class CaptainTripHistoryPage extends StatefulWidget {
  const CaptainTripHistoryPage({super.key});
  @override State<CaptainTripHistoryPage> createState() => _CaptainTripHistoryPageState();
}
class _CaptainTripHistoryPageState extends State<CaptainTripHistoryPage> {
  List<dynamic> _trips=[];
  String? _error;
  bool _loading=true;
  @override void initState(){super.initState();_load();}
  Future<void> _load() async {
    setState((){_loading=true;_error=null;});
    try {
      final r=await di.sl<ApiService>().get('/rides/history?driverId=me');
      if(mounted)setState(()=>_trips=r['data'] as List);
    } catch(e){if(mounted)setState(()=>_error=e.toString());}
    finally {if(mounted)setState(()=>_loading=false);}
  }
  @override Widget build(BuildContext context)=>Scaffold(
    appBar:AppBar(title:const Text('Your latest trips'),actions:[IconButton(onPressed:_loading?null:_load,icon:const Icon(Icons.refresh))]),
    body:_loading?const Center(child:CircularProgressIndicator()):ListView(padding:const EdgeInsets.all(16),children:[
      if(_error!=null)Text(_error!),
      if(_trips.isEmpty&&_error==null)const Text('No captain trips yet.'),
      ..._trips.map((t)=>Card(child:Padding(padding:const EdgeInsets.all(12),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Text("${t['category']} · ${t['status']} · INR ${t['fare']}"),
        Text("${t['pickup_address']} → ${t['drop_address']}"),
        Text("${t['payment_method']??'wallet'} · ${t['payment_status']??'unpaid'}"),
        Text(t['created_at'].toString()),TripTools(rideId:t['id'].toString()),
      ])))),
      const Text('Latest 100 trips. Receipts are available for completed paid trips only.'),
    ]),
  );
}
