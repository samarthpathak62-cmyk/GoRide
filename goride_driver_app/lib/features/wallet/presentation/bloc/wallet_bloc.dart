import 'package:shared_preferences/shared_preferences.dart';
import '../../../../core/config/backend_config.dart';
import 'dart:convert';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:http/http.dart' as http;
import 'wallet_event.dart';
import 'wallet_state.dart';
import '../../data/models/transaction_model.dart';

class WalletBloc extends Bloc<WalletEvent, WalletState> {
  final String baseUrl = '${BackendConfig.apiUrl}/wallet';

  Future<Map<String, String>> _headers() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('auth_token');
    return {'Content-Type': 'application/json', if (token != null) 'Authorization': 'Bearer $token'};
  }

  WalletBloc() : super(WalletInitial()) {
    on<FetchWalletData>(_onFetchWalletData);
    on<RequestPayout>(_onRequestPayout);
  }

  Future<void> _onFetchWalletData(
    FetchWalletData event,
    Emitter<WalletState> emit,
  ) async {
    emit(WalletLoading());
    try {
      final balanceRes = await http.get(
        Uri.parse("$baseUrl/balance"), headers: await _headers(),
      ).timeout(const Duration(seconds: 30));
      final historyRes = await http.get(
        Uri.parse("$baseUrl/history"), headers: await _headers(),
      ).timeout(const Duration(seconds: 30));

      if (balanceRes.statusCode == 200 && historyRes.statusCode == 200) {
        final balanceData = jsonDecode(balanceRes.body);
        final historyData = jsonDecode(historyRes.body) as List;

        final transactions = historyData
            .map((item) => TransactionModel.fromJson(item))
            .toList();

        emit(WalletLoaded(
          balance: (balanceData['wallet_balance'] as num).toDouble(),
          transactions: transactions,
        ));
      } else {
        emit(const WalletError("Failed to fetch wallet data"));
      }
    } catch (e) {
      emit(WalletError(e.toString()));
    }
  }

  Future<void> _onRequestPayout(
    RequestPayout event,
    Emitter<WalletState> emit,
  ) async {
    try {
      final response = await http.post(
        Uri.parse("$baseUrl/payout"),
        headers: await _headers(),
        body: jsonEncode({
          "userId": event.userId,
          "amount": event.amount,
        }),
      ).timeout(const Duration(seconds: 30));

      final data = jsonDecode(response.body);
      if (response.statusCode == 200) {
        emit(PayoutSuccess(data['message']));
        add(FetchWalletData(event.userId));
      } else {
        emit(WalletError(data['message'] ?? "Payout failed"));
      }
    } catch (e) {
      emit(WalletError(e.toString()));
    }
  }
}
