import 'package:url_launcher/url_launcher.dart';
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
    on<TopUpWallet>(_onTopUpWallet);
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

  Future<void> _onTopUpWallet(
    TopUpWallet event,
    Emitter<WalletState> emit,
  ) async {
    try {
      final response = await http.post(
        Uri.parse("$baseUrl/payment-link"),
        headers: await _headers(),
        body: jsonEncode({
          "userId": event.userId,
          "amount": event.amount,
        }),
      ).timeout(const Duration(seconds: 30));

      final data = jsonDecode(response.body);
      if (response.statusCode == 201) {
        final checkout = Uri.parse(data['checkoutUrl'] as String);
        if (checkout.scheme != 'https' || !['rzp.io', 'rzp.pay', 'razorpay.com'].any((h) => checkout.host == h || checkout.host.endsWith('.$h'))) {
          throw Exception('Invalid checkout URL');
        }
        if (!await launchUrl(checkout, mode: LaunchMode.externalApplication)) {
          throw Exception('Could not open payment checkout');
        }
        emit(const PaymentCheckoutOpened());
      } else {
        emit(WalletError(data['message'] ?? "Top-up failed"));
      }
    } catch (e) {
      emit(WalletError(e.toString()));
    }
  }
}
