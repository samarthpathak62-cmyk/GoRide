import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../core/services/api_service.dart';
import '../../../../injection_container.dart' as di;
import '../../../auth/presentation/bloc/auth_bloc.dart';
import '../../../auth/presentation/bloc/auth_event.dart';
import '../../../auth/presentation/bloc/auth_state.dart';
import '../../../home/presentation/bloc/home_bloc.dart';
import '../../../home/presentation/bloc/home_event.dart';

class DocumentSubmissionPage extends StatefulWidget {
  const DocumentSubmissionPage({super.key});
  @override
  State<DocumentSubmissionPage> createState() => _DocumentSubmissionPageState();
}

class _DocumentSubmissionPageState extends State<DocumentSubmissionPage> {
  static const neon = Color(0xff76eb07);
  final ApiService _api = di.sl<ApiService>();
  final _form = GlobalKey<FormState>();
  final Map<String, TextEditingController> _fields = {
    for (final key in ['fullName','dateOfBirth','vehicleModel','city','postalCode','registrationNumber'])
      key: TextEditingController(),
  };
  Map<String, dynamic>? _requirements;
  Map<String, dynamic> _documents = {};
  String _vehicle = 'Bike', _status = 'not_submitted', _reason = '';
  String? _error;
  bool _loading = true, _busy = false, _consent = false;
  Timer? _timer;
  Future<void> _saveQueue = Future.value();
  bool get _locked => _status == 'pending' || _status == 'approved';
  List<String> get _requiredDocs {
    final vehicles = (_requirements?['vehicles'] as List?) ?? [];
    final spec = vehicles.cast<Map>().where((v) => v['id'] == _vehicle).firstOrNull;
    return List<String>.from(spec?['documents'] ?? []);
  }
  Map<String, dynamic> _payload() => {
    for (final entry in _fields.entries) entry.key: entry.value.text.trim(),
    'vehicleType': _vehicle, 'documents': _documents, 'consent': _consent,
  };
  @override
  void initState() { super.initState(); _load(); }
  @override
  void dispose() { _timer?.cancel(); for (final field in _fields.values) { field.dispose(); } super.dispose(); }
  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final responses = await Future.wait([
        _api.get('/drivers/requirements'), _api.get('/drivers/draft'), _api.get('/drivers/status'),
      ]);
      if (!mounted) return;
      final current = Map<String, dynamic>.from(responses[2]['data'] ?? {});
      final draft = Map<String, dynamic>.from(responses[1]['data'] ?? {});
      final useCurrent = current['status'] == 'pending' || current['status'] == 'approved' || draft.isEmpty;
      final data = useCurrent && current['documents'] is Map && (current['documents'] as Map).isNotEmpty
        ? <String, dynamic>{
            'fullName': current['full_name'], 'dateOfBirth': current['date_of_birth'],
            'vehicleModel': current['vehicle_model'], 'city': current['city'],
            'postalCode': current['postal_code'], 'registrationNumber': current['registration_number'],
            'vehicleType': current['vehicle_type'], 'documents': current['documents'], 'consent': true,
          } : draft;
      for (final entry in _fields.entries) { entry.value.text = data[entry.key]?.toString() ?? ''; }
      setState(() {
        _requirements = Map<String, dynamic>.from(responses[0]['data']);
        _vehicle = ['Bike','Auto','Car'].contains(data['vehicleType']) ? data['vehicleType'] : 'Bike';
        _documents = Map<String, dynamic>.from(data['documents'] ?? {});
        _consent = data['consent'] == true;
        _status = current['status']?.toString() ?? 'not_submitted';
        _reason = current['review_reason']?.toString() ?? '';
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() { _loading = false; _error = 'Could not load captain onboarding. Check your connection and ensure the updated backend is deployed.'; });
    }
  }
  Future<void> _saveDraft() {
    final payload = _payload();
    _saveQueue = _saveQueue.catchError((_) {}).then((_) async { await _api.post('/drivers/draft', payload); });
    return _saveQueue;
  }
  void _changed() {
    _timer?.cancel();
    _timer = Timer(const Duration(seconds: 1), () async {
      try { await _saveDraft(); } catch (_) { if (mounted) _show('Draft could not be saved. Tap Save draft before leaving.'); }
    });
  }
  void _show(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }
  Future<void> _upload(String key) async {
    if (_busy || _locked) return;
    XFile? file;
    try {
      file = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 80, maxWidth: 2400);
    } catch (_) { if (mounted) _show('Could not open photos. Check photo permissions.'); return; }
    if (file == null || !mounted) return;
    setState(() => _busy = true);
    try {
      final response = await _api.multipart('/drivers/upload-document', {'docType': key}, {'document': file.path});
      if (!mounted) return;
      setState(() { _documents[key] = {...Map<String,dynamic>.from(_documents[key] ?? {}), 'path': response['data']['path']}; });
      await _saveDraft();
      if (mounted) _show('Document uploaded privately and draft saved.');
    } catch (e) { if (mounted) _show('Upload/save failed: $e'); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  Future<void> _pickDate({String? key}) async {
    final now = DateTime.now();
    final picked = await showDatePicker(context: context,
      initialDate: key == null ? DateTime(now.year - 20, 1, 1) : now.add(const Duration(days: 365)),
      firstDate: key == null ? DateTime(1900) : now.add(const Duration(days: 1)),
      lastDate: key == null ? DateTime(now.year - 18, now.month, now.day) : DateTime(now.year + 30),
    );
    if (picked == null || !mounted) return;
    final iso = '${picked.year.toString().padLeft(4,'0')}-${picked.month.toString().padLeft(2,'0')}-${picked.day.toString().padLeft(2,'0')}';
    setState(() {
      if (key == null) { _fields['dateOfBirth']!.text = iso; }
      else { _documents[key] = {...Map<String,dynamic>.from(_documents[key] ?? {}), 'expiresOn': iso}; }
    });
    _changed();
  }
  Future<void> _submit() async {
    if (!_form.currentState!.validate() || !_consent) { _show('Complete the form and consent to verification.'); return; }
    for (final key in _requiredDocs) {
      final doc = _documents[key];
      final spec = _requirements!['documents'][key];
      if (doc?['path'] == null || (spec['expires'] == true && doc?['expiresOn'] == null)) {
        _show('Upload ${spec['label']} and add its expiry date where required.'); return;
      }
    }
    setState(() => _busy = true); _timer?.cancel();
    try {
      await _saveDraft();
      await _api.post('/drivers/submit-verification', _payload());
      if (!mounted) return;
      context.read<HomeBloc>().add(FetchDriverStatusEvent());
      await _load();
      if (mounted) _show('Submitted for human review. This is not an approval.');
    } catch (e) { if (mounted) _show('Submission failed: $e'); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  Widget _field(String key, String label, {bool date = false, bool numeric = false}) => Padding(
    padding: const EdgeInsets.only(bottom: 14),
    child: TextFormField(controller: _fields[key], readOnly: date,
      onTap: date ? () => _pickDate() : null, onChanged: (_) => _changed(),
      keyboardType: numeric ? TextInputType.number : TextInputType.text,
      style: const TextStyle(color: Colors.white),
      validator: (v) {
        if (v == null || v.trim().isEmpty) return 'Required';
        if (key == 'postalCode' && !RegExp(r'^\d{6}$').hasMatch(v)) return 'Enter a six-digit PIN';
        return null;
      },
      decoration: InputDecoration(labelText: label, labelStyle: const TextStyle(color: Colors.white70),
        filled: true, fillColor: const Color(0xff1a1a1a), border: OutlineInputBorder(borderRadius: BorderRadius.circular(14))),
    ),
  );
  @override
  Widget build(BuildContext context) {
    return BlocListener<AuthBloc, AuthState>(
      listener: (context, state) {
        if (state is AuthUnauthenticated) Navigator.of(context).popUntil((route) => route.isFirst);
      },
      child: Scaffold(backgroundColor: const Color(0xff0a0a0a),
      appBar: AppBar(backgroundColor: const Color(0xff0a0a0a), foregroundColor: Colors.white,
        title: const Text('Captain onboarding'), actions: [
          IconButton(onPressed: _busy ? null : _load, icon: const Icon(Icons.refresh)),
          IconButton(onPressed: () => context.read<AuthBloc>().add(LogoutEvent()), icon: const Icon(Icons.logout)),
        ]),
      body: _loading ? const Center(child: CircularProgressIndicator(color: neon))
      : _error != null ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(_error!, style: const TextStyle(color: Colors.white)), TextButton(onPressed: _load, child: const Text('Retry')),
        ])))
      : Form(key: _form, child: ListView(padding: const EdgeInsets.all(22), children: [
          Text('Your vehicle. Your next chapter.', style: const TextStyle(color: Colors.white,fontSize: 28,fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          Text('Status: ${_status.replaceAll('_',' ')}', style: const TextStyle(color: neon,fontSize: 17)),
          if (_reason.isNotEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 12),child: Text('Reviewer: $_reason',style: const TextStyle(color: Colors.amber))),
          if (_locked) const Padding(padding: EdgeInsets.symmetric(vertical: 14),child: Text('Application submitted. Use Refresh to check the review. Changes require a new review.',style: TextStyle(color: Colors.white70))),
          const SizedBox(height: 18),
          AbsorbPointer(absorbing: _locked || _busy, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch,children: [
            SegmentedButton<String>(segments: const [
              ButtonSegment(value: 'Bike',label: Text('Bike'),icon: Icon(Icons.two_wheeler)),
              ButtonSegment(value: 'Auto',label: Text('Auto'),icon: Icon(Icons.electric_rickshaw)),
              ButtonSegment(value: 'Car',label: Text('Car'),icon: Icon(Icons.directions_car)),
            ],selected: {_vehicle},onSelectionChanged: (s) { setState(() => _vehicle = s.first); _changed(); }),
            const SizedBox(height: 24),
            _field('fullName','Legal full name'),_field('dateOfBirth','Date of birth (18+)',date: true),
            _field('vehicleModel','Vehicle make and model'),_field('registrationNumber','Vehicle registration number'),
            _field('city','Operating city'),_field('postalCode','PIN code',numeric: true),
            const SizedBox(height: 12),
            const Text('VERIFICATION DOCUMENTS',style: TextStyle(color: Colors.white,fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            const Text('Private uploads • JPEG / PNG / WebP • Up to 5 MB each',style: TextStyle(color: Colors.white54)),
            for (final key in _requiredDocs) Card(color: const Color(0xff1a1a1a),margin: const EdgeInsets.symmetric(vertical: 8),child: Padding(padding: const EdgeInsets.all(14),child: Column(crossAxisAlignment: CrossAxisAlignment.start,children: [
              Text(_requirements!['documents'][key]['label'],style: const TextStyle(color: Colors.white,fontWeight: FontWeight.bold)),
              TextButton.icon(onPressed: () => _upload(key),icon: Icon(_documents[key]?['path'] != null ? Icons.check_circle : Icons.upload_file,color: neon),
                label: Text(_documents[key]?['path'] != null ? 'Uploaded — replace' : 'Upload image')),
              if (_requirements!['documents'][key]['expires'] == true) TextButton.icon(onPressed: () => _pickDate(key: key),icon: const Icon(Icons.event),
                label: Text('Expiry: ${_documents[key]?['expiresOn'] ?? 'select date'}')),
            ]))),
            const SizedBox(height: 12),
            Text(_requirements!['notice'],style: const TextStyle(color: Colors.white60,fontSize: 12)),
            CheckboxListTile(value: _consent,onChanged: (v) { setState(() => _consent = v ?? false); _changed(); },activeColor: neon,
              title: const Text('I confirm these documents are mine and consent to verification for captain onboarding.',style: TextStyle(color: Colors.white,fontSize: 13))),
          ])),
          if (_busy) const LinearProgressIndicator(color: neon),
          const SizedBox(height: 16),
          OutlinedButton(onPressed: _locked || _busy ? null : () async {
            try { await _saveDraft(); if (mounted) _show('Draft saved. You can continue after reopening the app.'); }
            catch (_) { if (mounted) _show('Draft save failed. Please retry.'); }
          },child: const Text('Save draft')),
          FilledButton(onPressed: _locked || _busy ? null : _submit,style: FilledButton.styleFrom(backgroundColor: neon,foregroundColor: Colors.black,padding: const EdgeInsets.all(18)),child: const Text('Submit for review')),
          const SizedBox(height: 30),
        ])),
    ));
  }
}
