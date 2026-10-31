import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../../core/services/api_service.dart';
import '../../../../../injection_container.dart' as di;

class TripPinCard extends StatefulWidget {
  final String rideId;
  const TripPinCard({super.key, required this.rideId});
  @override
  State<TripPinCard> createState() => _TripPinCardState();
}
class _TripPinCardState extends State<TripPinCard> {
  String? _pin, _error;
  DateTime? _expires;
  bool _busy = false;
  Timer? _timer;
  @override
  void initState() { super.initState(); _load(); _timer = Timer.periodic(const Duration(seconds: 15), (_) { if (mounted) setState(() {}); }); }
  @override
  void dispose() { _timer?.cancel(); _pin = null; super.dispose(); }
  Future<void> _load({bool rotate = false}) async {
    if (_busy) return;
    setState(() { _busy = true; _error = null; if (rotate) _pin = null; });
    try {
      final response = await di.sl<ApiService>().post('/rides/${Uri.encodeComponent(widget.rideId)}/start-pin', {'rotate': rotate});
      if (!mounted) return;
      final data = response['data'];
      setState(() { _pin = data['pin'] as String; _expires = DateTime.tryParse(data['expiresAt'] as String); });
    } catch (e) { if (mounted) setState(() { _pin = null; _error = e.toString().replaceFirst('Exception: ', ''); }); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  @override
  Widget build(BuildContext context) {
    final localExpiry = _expires?.toLocal();
    final expired = _expires != null && !_expires!.isAfter(DateTime.now());
    return Container(
      width: double.infinity, padding: const EdgeInsets.all(12), margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(color: const Color(0xff252525), borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text('YOUR TRIP PIN', style: TextStyle(color: Color(0xff76eb07), fontWeight: FontWeight.bold)),
        if (_busy) const LinearProgressIndicator()
        else if (_pin != null && !expired) Text(_pin!, style: const TextStyle(color: Colors.white, fontSize: 30, letterSpacing: 10, fontWeight: FontWeight.bold)),
        if (_pin != null && !expired && localExpiry != null) Text('Valid until ${localExpiry.hour.toString().padLeft(2, '0')}:${localExpiry.minute.toString().padLeft(2, '0')}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
        Text(expired ? 'PIN expired. Request a new PIN below.' : 'Share only after checking the captain and vehicle at pickup. Not a login OTP.', style: const TextStyle(color: Colors.white70, fontSize: 12)),
        if (_error != null) Text(_error!, style: const TextStyle(color: Colors.orangeAccent)),
        TextButton(onPressed: _busy ? null : () async {

          final replace = await showDialog<bool>(context: context, builder: (c) => AlertDialog(
            title: const Text('Replace trip PIN?'), content: const Text('The old PIN will stop working. Tell the captain only the new code.'),
            actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Keep current')),
              TextButton(onPressed: () => Navigator.pop(c, true), child: const Text('New PIN'))]));
          if (replace == true && mounted) await _load(rotate: true);
        }, child: const Text('Request new PIN')),
        TextButton(onPressed: _busy ? null : () => _load(), child: const Text('Refresh / retry')),
      ]),
    );
  }
}
